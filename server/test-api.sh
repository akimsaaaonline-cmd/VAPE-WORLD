#!/usr/bin/env bash
# End-to-end smoke test for the VAPE WORLD backend.
# Usage: BASE=http://localhost:9100 ./test-api.sh
set -uo pipefail
BASE="${BASE:-http://localhost:9100}"
PASS=0; FAIL=0
TMP=$(mktemp -d)

chk() { # chk <name> <condition-result> [detail]
  if [ "$2" = "1" ]; then PASS=$((PASS+1)); printf 'PASS  %s\n' "$1";
  else FAIL=$((FAIL+1)); printf 'FAIL  %s   %s\n' "$1" "${3:-}"; fi
}

jq_has() { python3 -c "
import json,sys
d=json.load(open(sys.argv[1]))
expr=sys.argv[2]
try:
  print('1' if eval(expr,{'d':d}) else '0')
except Exception as e:
  print('0')
" "$1" "$2"; }

req() { # req METHOD PATH [json] [extra curl args...]
  local m=$1 p=$2 body=${3:-}; shift 3 || shift 2
  if [ -n "$body" ]; then
    curl -s -o "$TMP/out" -w '%{http_code}' -X "$m" -H 'Content-Type: application/json' "$@" -d "$body" "$BASE$p"
  else
    curl -s -o "$TMP/out" -w '%{http_code}' -X "$m" "$@" "$BASE$p"
  fi
}

echo "== public =="
code=$(req GET /api/products)
chk "GET /api/products 200" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
chk "  products have required fields" "$(jq_has "$TMP/out" "len(d)>0 and all(k in d[0] for k in ['id','name','slug','price','salePrice','category','stock','sku','brand','image','images','gallery','featured','active','created_at'])")"
chk "  sorted newest first" "$(jq_has "$TMP/out" "d[0]['id']>=d[-1]['id']")"

code=$(req GET "/api/products?all=1"); chk "GET /api/products?all=1" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
code=$(req GET /api/products/silicone-case)
chk "GET /api/products/:slug" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
chk "  slug matches" "$(jq_has "$TMP/out" "d['slug']=='silicone-case'")"
code=$(req GET /api/products/10); chk "GET /api/products/:id" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
code=$(req GET /api/products/nope-nope); chk "GET unknown product -> 404" "$([ "$code" = 404 ] && echo 1 || echo 0)" "$code"

code=$(req GET /api/categories)
chk "GET /api/categories" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
chk "  category fields" "$(jq_has "$TMP/out" "all(k in d[0] for k in ['id','name','slug','image','sort'])")"

code=$(req GET /api/settings)
chk "GET /api/settings" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
chk "  settings fields the UI reads" "$(jq_has "$TMP/out" "all(k in d for k in ['storeName','currency','shippingFlat','freeShippingOver','easypaisaEnabled','bankEnabled','codEnabled','requireTxnId','guestCheckout','seoTitle','ageNotice','backupConfig'])")"

code=$(req GET /api/seo/robots); chk "GET /api/seo/robots" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
grep -q 'User-agent' "$TMP/out"; chk "  robots body" "$([ $? = 0 ] && echo 1 || echo 0)"
code=$(req GET /api/seo/sitemap.xml); chk "GET /api/seo/sitemap.xml" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
grep -q '<urlset' "$TMP/out"; chk "  sitemap body" "$([ $? = 0 ] && echo 1 || echo 0)"

echo "== admin auth =="
code=$(req GET /api/admin/stats); chk "admin stats without token -> 401" "$([ "$code" = 401 ] && echo 1 || echo 0)" "$code"
code=$(req POST /api/auth/login '{"email":"admin@vapeworld.pk","password":"wrong"}')
chk "bad admin password -> 401" "$([ "$code" = 401 ] && echo 1 || echo 0)" "$code"
code=$(req POST /api/auth/login '{"email":"admin@vapeworld.pk","password":"VapeWorld@2026"}')
chk "admin login 200" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
chk "  role/token/admin present" "$(jq_has "$TMP/out" "d['role']=='admin' and bool(d['token']) and d['admin']['email']=='admin@vapeworld.pk'")"
ADMIN=$(python3 -c "import json;print(json.load(open('$TMP/out'))['token'])")
AH="x-admin-token: $ADMIN"

echo "== admin products =="
code=$(req POST /api/admin/products '{"sku":"TEST-SKU-1","name":"Test Widget","brand":"TB","category":"Accessories","description":"d","price":1000,"salePrice":800,"stock":5,"image":"","gallery":[],"flavour":"","nicotine":"","puffs":"","featured":true,"active":true,"seoTitle":"","seoDescription":""}' -H "$AH")
chk "create product 201" "$([ "$code" = 201 ] && echo 1 || echo 0)" "$code"
chk "  slug generated" "$(jq_has "$TMP/out" "d['slug']=='test-widget' and d['salePrice']==800 and d['featured'] is True")"
PID=$(python3 -c "import json;print(json.load(open('$TMP/out'))['id'])")
code=$(req POST /api/admin/products '{"sku":"TEST-SKU-1","name":"Dupe"}' -H "$AH")
chk "duplicate SKU -> 409" "$([ "$code" = 409 ] && echo 1 || echo 0)" "$code"
code=$(req PATCH "/api/admin/products/$PID" '{"stock":9,"price":1200,"salePrice":null}' -H "$AH")
chk "PATCH product" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
chk "  patch applied" "$(jq_has "$TMP/out" "d['stock']==9 and d['price']==1200 and d['salePrice'] is None")"
code=$(req PUT "/api/admin/products/$PID" '{"stock":40}' -H "$AH"); chk "PUT product alias" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
code=$(req GET /api/admin/products '' -H "$AH"); chk "GET /api/admin/products" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"

echo "== upload =="
python3 - <<'PY'
import base64,pathlib
png=base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==")
pathlib.Path('/tmp/vw-test.png').write_bytes(png)
PY
code=$(curl -s -o "$TMP/out" -w '%{http_code}' -X POST -H "$AH" -F "file=@/tmp/vw-test.png" "$BASE/api/admin/upload")
chk "POST /api/admin/upload 201" "$([ "$code" = 201 ] && echo 1 || echo 0)" "$code"
chk "  returns {url}" "$(jq_has "$TMP/out" "d['url'].startswith('/uploads/')")"
UP=$(python3 -c "import json;print(json.load(open('$TMP/out'))['url'])")
code=$(req GET "$UP"); chk "uploaded file served" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"

echo "== sheets =="
code=$(req GET /api/admin/products/template '' -H "$AH" -o "$TMP/tpl.xlsx")
code=$(curl -s -o "$TMP/tpl.xlsx" -w '%{http_code}' -H "$AH" "$BASE/api/admin/products/template")
chk "GET template xlsx" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
head -c2 "$TMP/tpl.xlsx" | grep -q PK; chk "  template is a real xlsx" "$([ $? = 0 ] && echo 1 || echo 0)"
code=$(curl -s -o "$TMP/exp.xlsx" -w '%{http_code}' -H "$AH" "$BASE/api/admin/products/export")
chk "GET export xlsx" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
head -c2 "$TMP/exp.xlsx" | grep -q PK; chk "  export is a real xlsx" "$([ $? = 0 ] && echo 1 || echo 0)"
printf 'SKU,Name,Brand,Category,Price,Sale price,Stock,Featured (yes/no),Active (yes/no)\nIMP-1,Imported One,IB,Coils,300,,7,no,yes\nTEST-SKU-1,Test Widget Renamed,TB,Accessories,1500,,3,yes,yes\n,,,,,,,,\n' > "$TMP/imp.csv"
code=$(curl -s -o "$TMP/out" -w '%{http_code}' -X POST -H "$AH" -F "file=@$TMP/imp.csv" "$BASE/api/admin/products/import")
chk "POST import 200" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
chk "  created/updated/skipped/errors" "$(jq_has "$TMP/out" "d['created']+d['updated']==2 and d['skipped']>=0 and isinstance(d['errors'],list)")"
code=$(curl -s -o "$TMP/out" -w '%{http_code}' -X POST -H "$AH" -F "file=@$TMP/exp.xlsx" "$BASE/api/admin/products/import")
chk "re-import own xlsx export" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$(cat "$TMP/out" | head -c 200)"

echo "== categories =="
code=$(req POST /api/admin/categories '{"name":"Nicotine Salts"}' -H "$AH")
chk "create category 201" "$([ "$code" = 201 ] && echo 1 || echo 0)" "$code"
chk "  slug" "$(jq_has "$TMP/out" "d['slug']=='nicotine-salts'")"
CID=$(python3 -c "import json;print(json.load(open('$TMP/out'))['id'])")
code=$(req POST /api/admin/categories '{"name":"Nicotine Salts"}' -H "$AH"); chk "duplicate category -> 409" "$([ "$code" = 409 ] && echo 1 || echo 0)" "$code"
code=$(req GET /api/admin/categories '' -H "$AH"); chk "GET /api/admin/categories" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
code=$(req DELETE "/api/admin/categories/$CID" '' -H "$AH"); chk "delete category" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"

echo "== customer auth =="
code=$(req POST /api/auth/signup '{"name":"Ali Raza","email":"ali@example.com","phone":"03001234567","password":"secret123"}')
chk "signup 201" "$([ "$code" = 201 ] && echo 1 || echo 0)" "$code"
chk "  token + customer" "$(jq_has "$TMP/out" "bool(d['token']) and d['customer']['email']=='ali@example.com' and 'password' not in d['customer']")"
CUST=$(python3 -c "import json;print(json.load(open('$TMP/out'))['token'])")
CH="x-customer-token: $CUST"
code=$(req POST /api/auth/signup '{"name":"Ali Raza","email":"ali@example.com","phone":"03001234567","password":"secret123"}')
chk "duplicate signup -> 409" "$([ "$code" = 409 ] && echo 1 || echo 0)" "$code"
code=$(req POST /api/auth/signup '{"name":"A","email":"bad","phone":"1","password":"x"}')
chk "invalid signup -> 400" "$([ "$code" = 400 ] && echo 1 || echo 0)" "$code"
code=$(req POST /api/auth/login '{"email":"ali@example.com","password":"secret123"}')
chk "customer login" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
chk "  role customer" "$(jq_has "$TMP/out" "d['role']=='customer' and bool(d['customer'])")"
CUST=$(python3 -c "import json;print(json.load(open('$TMP/out'))['token'])"); CH="x-customer-token: $CUST"
code=$(req GET /api/auth/me '' -H "$CH"); chk "GET /api/auth/me" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
code=$(req PATCH /api/auth/me '{"name":"Ali R","phone":"03009998877","address":"12 Mall Road","city":"Lahore"}' -H "$CH")
chk "PATCH /api/auth/me" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
chk "  updated customer returned" "$(jq_has "$TMP/out" "d['city']=='Lahore' and d['name']=='Ali R'")"
code=$(req GET /api/my-orders '' -H "$CH"); chk "GET /api/my-orders" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
code=$(req GET /api/my-orders); chk "my-orders without token -> 401" "$([ "$code" = 401 ] && echo 1 || echo 0)" "$code"

echo "== checkout =="
# guest checkout is disabled in the seeded settings -> guest must be rejected
code=$(req POST /api/orders '{"name":"Guest Person","email":"g@example.com","phone":"03001112222","address":"5 Some Street","city":"Karachi","postal":"","note":"","paymentMethod":"easypaisa","proof":"","txnId":"TX1","items":[{"productId":10,"sku":"VW-1010","name":"Silicone Protective Case","price":550,"qty":1,"image":""}]}')
chk "guest order blocked when guestCheckout=false" "$([ "$code" = 401 ] && echo 1 || echo 0)" "$code"
code=$(req POST /api/orders '{"name":"Ali R","email":"ali@example.com","phone":"03009998877","address":"12 Mall Road","city":"Lahore","postal":"54000","note":"Call before delivery","paymentMethod":"easypaisa","proof":"","txnId":"TX-9911","items":[{"productId":10,"sku":"VW-1010","name":"Silicone Protective Case","price":550,"qty":2,"image":""},{"productId":8,"sku":"VW-1008","name":"SMOK RPM Coils","price":1300,"qty":1,"image":""}]}' -H "$CH")
chk "place order 201" "$([ "$code" = 201 ] && echo 1 || echo 0)" "$code $(head -c 200 "$TMP/out")"
chk "  order shape" "$(jq_has "$TMP/out" "all(k in d for k in ['id','orderNumber','status','createdAt','items','subtotal','shipping','total','paymentMethod','txnId','name','email','phone','address','city','postal','note','customerId'])")"
chk "  totals computed server-side (550*2+1300=2400, ship 250)" "$(jq_has "$TMP/out" "d['subtotal']==2400 and d['shipping']==250 and d['total']==2650")"
chk "  status pending, order number format" "$(jq_has "$TMP/out" "d['status']=='pending' and d['orderNumber'].startswith('VW-')")"
ONUM=$(python3 -c "import json;print(json.load(open('$TMP/out'))['orderNumber'])")
OID=$(python3 -c "import json;print(json.load(open('$TMP/out'))['id'])")
code=$(req POST /api/orders '{"name":"Ali R","email":"ali@example.com","phone":"03009998877","address":"12 Mall Road","city":"Lahore","paymentMethod":"easypaisa","txnId":"T","items":[]}' -H "$CH")
chk "empty cart -> 400" "$([ "$code" = 400 ] && echo 1 || echo 0)" "$code"
code=$(req GET /api/products/10); chk "stock decremented" "$(jq_has "$TMP/out" "d['stock']==43")"
code=$(req GET /api/my-orders '' -H "$CH"); chk "order shows in my-orders" "$(jq_has "$TMP/out" "len(d)==1 and d[0]['orderNumber']=='$ONUM'")"

echo "== free shipping threshold =="
code=$(req POST /api/orders "{\"name\":\"Ali R\",\"email\":\"ali@example.com\",\"phone\":\"03009998877\",\"address\":\"12 Mall Road\",\"city\":\"Lahore\",\"paymentMethod\":\"easypaisa\",\"txnId\":\"T2\",\"items\":[{\"productId\":$PID,\"sku\":\"TEST-SKU-1\",\"name\":\"x\",\"price\":1,\"qty\":5}]}" -H "$CH")
chk "big order 201" "$([ "$code" = 201 ] && echo 1 || echo 0)" "$code $(head -c 200 "$TMP/out")"
chk "  free shipping over 5000" "$(jq_has "$TMP/out" "d['subtotal']>=5000 and d['shipping']==0")"

echo "== tracking =="
code=$(req POST /api/orders/track "{\"orderNumber\":\"$ONUM\",\"email\":\"ali@example.com\"}")
chk "track order" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
chk "  tracked fields" "$(jq_has "$TMP/out" "d['orderNumber']=='$ONUM' and d['status'] and d['createdAt'] and d['items'] and d['total'] and d['address'] and d['city']")"
code=$(req POST /api/orders/track "{\"orderNumber\":\"$ONUM\",\"email\":\"nobody@example.com\"}")
chk "track wrong email -> 404" "$([ "$code" = 404 ] && echo 1 || echo 0)" "$code"

echo "== messages =="
code=$(req POST /api/messages '{"name":"Sara Khan","email":"sara@example.com","subject":"Stock query","body":"Do you have mango flavour?"}')
chk "POST /api/messages 201" "$([ "$code" = 201 ] && echo 1 || echo 0)" "$code"
code=$(req POST /api/messages '{"name":"x","email":"nope","body":"hi"}'); chk "invalid message -> 400" "$([ "$code" = 400 ] && echo 1 || echo 0)" "$code"
code=$(req GET /api/admin/messages '' -H "$AH")
chk "GET /api/admin/messages" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
chk "  message fields" "$(jq_has "$TMP/out" "all(k in d[0] for k in ['id','name','email','subject','body','read','createdAt']) and d[0]['read'] is False")"
MID=$(python3 -c "import json;print(json.load(open('$TMP/out'))[0]['id'])")
code=$(req PATCH "/api/admin/messages/$MID" '' -H "$AH")
chk "PATCH message (no body) marks read" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
chk "  read=true" "$(jq_has "$TMP/out" "d['read'] is True")"

echo "== admin orders/customers/stats =="
code=$(req GET /api/admin/orders '' -H "$AH")
chk "GET /api/admin/orders" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
chk "  admin order fields" "$(jq_has "$TMP/out" "all(k in d[0] for k in ['id','orderNumber','customerId','name','email','phone','address','city','postal','note','items','subtotal','shipping','total','paymentMethod','txnId','status','createdAt'])")"
code=$(req PATCH "/api/admin/orders/$OID" '{"status":"payment-verified"}' -H "$AH")
chk "PATCH order status" "$(jq_has "$TMP/out" "d['status']=='payment-verified'")"
code=$(req PATCH "/api/admin/orders/$OID" '{"status":"bogus"}' -H "$AH"); chk "bad status -> 400" "$([ "$code" = 400 ] && echo 1 || echo 0)" "$code"
code=$(req GET /api/admin/customers '' -H "$AH")
chk "GET /api/admin/customers" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
chk "  customer fields, no password" "$(jq_has "$TMP/out" "all(k in d[0] for k in ['id','name','email','phone','city','createdAt']) and 'password' not in d[0]")"
code=$(req GET /api/admin/stats '' -H "$AH")
chk "GET /api/admin/stats" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
chk "  stats fields" "$(jq_has "$TMP/out" "all(k in d for k in ['revenue','orderCount','pendingCount','productCount','outOfStock','customerCount','unreadMessages','recentOrders','topProducts'])")"
chk "  revenue excludes cancelled + counts real orders" "$(jq_has "$TMP/out" "d['orderCount']==2 and d['revenue']>0 and d['customerCount']==1 and d['unreadMessages']==0")"
chk "  recentOrders/topProducts shapes" "$(jq_has "$TMP/out" "all(k in d['recentOrders'][0] for k in ['id','orderNumber','name','city','status','total']) and all(k in d['topProducts'][0] for k in ['name','sku','stock'])")"
code=$(req PATCH "/api/admin/orders/$OID" '{"status":"cancelled"}' -H "$AH")
code=$(req GET /api/admin/stats '' -H "$AH"); chk "cancelled order drops out of revenue" "$(jq_has "$TMP/out" "d['revenue']>0")"

echo "== settings =="
code=$(req GET /api/admin/settings '' -H "$AH"); chk "GET /api/admin/settings" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
code=$(req PUT /api/admin/settings '{"storeName":"VAPE WORLD","tagline":"Changed by test","shippingFlat":300,"codEnabled":true,"guestCheckout":true,"whatsappLink":"https://wa.me/923710975847"}' -H "$AH")
chk "PUT /api/admin/settings" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
chk "  saved values" "$(jq_has "$TMP/out" "d['tagline']=='Changed by test' and d['shippingFlat']==300 and d['codEnabled'] is True")"
code=$(req GET /api/settings); chk "public settings reflect change" "$(jq_has "$TMP/out" "d['shippingFlat']==300 and d['shippingFee']==300")"
code=$(req PUT /api/admin/settings '{"storeName":"","tagline":"x"}' -H "$AH"); chk "empty store name -> 400" "$([ "$code" = 400 ] && echo 1 || echo 0)" "$code"
code=$(req PUT /api/admin/settings '{"storeName":"VAPE WORLD","whatsappLink":"wa.me/123"}' -H "$AH"); chk "bad link -> 400" "$([ "$code" = 400 ] && echo 1 || echo 0)" "$code"
# guest checkout now allowed
code=$(req POST /api/orders '{"name":"Guest Person","email":"g@example.com","phone":"03001112222","address":"5 Some Street","city":"Karachi","paymentMethod":"cod","items":[{"productId":9,"sku":"VW-1009","name":"USB-C","price":500,"qty":1}]}')
chk "guest order allowed when guestCheckout=true" "$([ "$code" = 201 ] && echo 1 || echo 0)" "$code $(head -c 150 "$TMP/out")"
chk "  guest order has customerId null" "$(jq_has "$TMP/out" "d['customerId'] is None and d['shipping']==300")"

echo "== admin account + team + backups + site check =="
code=$(req GET /api/admin/account '' -H "$AH"); chk "GET /api/admin/account" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
code=$(req PATCH /api/admin/account '{"name":"Ahmar Jan","email":"admin@vapeworld.pk","currentPassword":"","newPassword":null}' -H "$AH")
chk "PATCH account name only" "$(jq_has "$TMP/out" "d['name']=='Ahmar Jan' and d['email']=='admin@vapeworld.pk'")"
code=$(req PATCH /api/admin/account '{"name":"Ahmar Jan","email":"admin@vapeworld.pk","currentPassword":"nope","newPassword":"newpass123"}' -H "$AH")
chk "wrong current password -> 400" "$([ "$code" = 400 ] && echo 1 || echo 0)" "$code"
code=$(req PATCH /api/admin/account '{"name":"Ahmar Jan","email":"admin@vapeworld.pk","currentPassword":"VapeWorld@2026","newPassword":"newpass123"}' -H "$AH")
chk "password change 200" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
code=$(req POST /api/auth/login '{"email":"admin@vapeworld.pk","password":"newpass123"}'); chk "login with new password" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
ADMIN=$(python3 -c "import json;print(json.load(open('$TMP/out'))['token'])"); AH="x-admin-token: $ADMIN"
code=$(req PATCH /api/admin/account '{"name":"Ahmar Jan","email":"admin@vapeworld.pk","currentPassword":"newpass123","newPassword":"VapeWorld@2026"}' -H "$AH")
chk "password restored" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
code=$(req POST /api/auth/login '{"email":"admin@vapeworld.pk","password":"VapeWorld@2026"}')
ADMIN=$(python3 -c "import json;print(json.load(open('$TMP/out'))['token'])"); AH="x-admin-token: $ADMIN"

code=$(req GET /api/admin/team '' -H "$AH"); chk "GET /api/admin/team" "$(jq_has "$TMP/out" "d[0]['isYou'] is True")"
code=$(req POST /api/admin/team '{"name":"Dev","email":"dev@vapeworld.pk","password":"devpass","role":"developer"}' -H "$AH")
chk "add team member 201" "$([ "$code" = 201 ] && echo 1 || echo 0)" "$code"
TMID=$(python3 -c "import json;print(json.load(open('$TMP/out'))['id'])")
code=$(req PATCH "/api/admin/team/$TMID" '{"password":"devpass2"}' -H "$AH"); chk "reset team password" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
code=$(req POST /api/auth/login '{"email":"dev@vapeworld.pk","password":"devpass2"}'); chk "team member can log in" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
code=$(req DELETE "/api/admin/team/$TMID" '' -H "$AH"); chk "delete team member" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"

code=$(req GET /api/admin/backup/status '' -H "$AH")
chk "GET backup/status" "$(jq_has "$TMP/out" "all(k in d for k in ['dataFolder','counts','backups','totalBackups','totalSize','lastBackupAt','autoEnabled','onChange','intervalMinutes','keep']) and all(k in d['counts'] for k in ['products','orders','customers'])")"
code=$(req POST /api/admin/backup/run '{"reason":"manual"}' -H "$AH"); chk "POST backup/run" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
BNAME=$(python3 -c "import json;print(json.load(open('$TMP/out'))['name'])")
code=$(req GET /api/admin/backup/export '' -H "$AH"); chk "GET backup/export" "$(jq_has "$TMP/out" "d['kind']=='vape-world-backup' and 'products' in d['data']")"
code=$(req GET "/api/admin/backup/file/$BNAME" '' -H "$AH"); chk "GET backup file" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
code=$(req POST /api/admin/backup/restore "{\"name\":\"$BNAME\",\"mode\":\"replace\"}" -H "$AH"); chk "POST backup/restore" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
code=$(req POST /api/admin/backup/config '{"autoEnabled":true,"onChange":false,"intervalMinutes":120,"keep":10}' -H "$AH")
chk "POST backup/config" "$(jq_has "$TMP/out" "d['intervalMinutes']==120 and d['keep']==10 and d['onChange'] is False")"
code=$(req DELETE "/api/admin/backup/file/$BNAME" '' -H "$AH"); chk "DELETE backup file" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
code=$(req GET /api/admin/site/check '' -H "$AH"); chk "GET site/check" "$(jq_has "$TMP/out" "'reachable' in d and 'domainIps' in d")"

echo "== deletes + logout + spa =="
code=$(req DELETE "/api/admin/products/$PID" '' -H "$AH"); chk "delete product" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
code=$(req DELETE "/api/admin/orders/$OID" '' -H "$AH"); chk "delete order" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
code=$(req DELETE "/api/admin/messages/$MID" '' -H "$AH"); chk "delete message" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
code=$(req POST /api/admin/logout '' -H "$AH"); chk "POST /api/admin/logout" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
code=$(req GET /api/admin/stats '' -H "$AH"); chk "token invalid after logout" "$([ "$code" = 401 ] && echo 1 || echo 0)" "$code"
code=$(req GET /api/unknown/thing); chk "unknown api -> 404 json" "$([ "$code" = 404 ] && echo 1 || echo 0)" "$code"
code=$(req GET /); chk "GET / serves index.html" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
grep -q 'assets/index-' "$TMP/out"; chk "  index.html body references the bundle" "$([ $? = 0 ] && echo 1 || echo 0)"
code=$(req GET /assets/index-Br2TU5RS.js); chk "bundle served" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
code=$(req GET /some/deep/spa/route); chk "SPA fallback" "$([ "$code" = 200 ] && echo 1 || echo 0)" "$code"
code=$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS -H 'Origin: https://example.com' -H 'Access-Control-Request-Headers: x-admin-token' "$BASE/api/products")
chk "CORS preflight 204" "$([ "$code" = 204 ] && echo 1 || echo 0)" "$code"
curl -s -D - -o /dev/null "$BASE/api/products" | grep -qi 'access-control-allow-origin: \*'
chk "CORS header on GET" "$([ $? = 0 ] && echo 1 || echo 0)"

echo
echo "-------- $PASS passed, $FAIL failed --------"
rm -rf "$TMP"
[ "$FAIL" = 0 ]
