# VAPE WORLD — reconstructed backend API notes

Server: `/home/user/workspace/vapeworld/server/index.js` (Express 4 + multer + xlsx, all pure JS —
no native modules, so the same file runs on Render, in Docker and inside an Electron desktop build).

The original server source was lost. This implementation was reconstructed from:

1. the minified frontend bundle `web/assets/index-Br2TU5RS.js` (un-minified with prettier — it embeds
   the compiled drizzle/zod table definitions, which gave exact field names), plus `web/backup.js`,
   `web/console.js`, `web/folder-memory.js`;
2. live GET probes of the still-running original at `https://vapeworlds1.pplx.app/port/9000`
   (`/api/products`, `/api/categories`, `/api/settings`) to confirm the exact wire shapes.

Verified: `test-api.sh` = **122/122 assertions pass**, and the unmodified production frontend bundle
renders storefront + full vendor panel (dashboard, products, categories, orders, customers, messages,
store settings, login details) against this server.

---

## Running it

```bash
cd server
npm install
npm start                     # http://0.0.0.0:9000
```

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `9000` | listen port, always bound to `0.0.0.0` |
| `DATA_DIR` | `./data` | JSON store, uploads and backups live here |
| `WEB_DIR` | `../web` | static frontend served at `/` with SPA fallback (set empty to disable) |
| `ADMIN_EMAIL` | `admin@vapeworld.pk` | seed admin login (only used on first seed) |
| `ADMIN_PASSWORD` | random | vendor password, used only when the shop data is created. Left unset, a random one is generated and written to `DATA_DIR/ADMIN-LOGIN.txt` |
| `SITE_URL` | settings `siteDomain` | base URL used in robots.txt / sitemap.xml |

**Vendor login: `admin@vapeworld.pk` and the password from `DATA_DIR/ADMIN-LOGIN.txt`** (or whatever `ADMIN_PASSWORD` was set to on the first run) — sign in from the normal
storefront sign-in form (`/#/signin`); an admin login redirects to `/#/admin`. There is no separate
admin login page, exactly as the bundle expects. Change them from *Vendor panel → Login details*
(`PATCH /api/admin/account`).

### Storage layout

```
$DATA_DIR/store.json        # everything: products, categories, orders, customers,
                            # messages, settings, admins/team, sessions, counters
$DATA_DIR/uploads/          # uploaded images, served at /uploads/<file>
$DATA_DIR/backups/          # JSON snapshots created by the backup endpoints
```

Writes are atomic (write to `.tmp` + `rename`) and queued, so concurrent requests cannot corrupt the
file. On first run the store is seeded from `server/data/seed-products.json`,
`seed-categories.json`, `seed-settings.json` (11 products, 5 categories) and the admin account is
created. Passwords are hashed with `node:crypto` scrypt, stored as `scrypt$<saltHex>$<keyHex>`.
Sessions are persisted in `store.json`, so tokens survive a restart (confirmed by test).

---

## Auth

Token auth via request headers — no cookies. The bundle sends both headers on every request when the
values exist in `localStorage`:

| Header | localStorage key | Issued by |
|---|---|---|
| `x-admin-token` | `vw_admin` | `POST /api/auth/login` when the email belongs to an admin/team user |
| `x-customer-token` | `vw_customer` | `POST /api/auth/login` or `POST /api/auth/signup` for a customer |

`POST /api/auth/login` `{email, password}` returns:

```json
{ "role": "admin",    "token": "<hex>", "admin":    { "id":1, "name":"…", "email":"…", "role":"owner" } }
{ "role": "customer", "token": "<hex>", "customer": { "id":1, "name":"…", "email":"…", "phone":"…", "address":"…", "city":"…" } }
```

Errors always return JSON `{"message": "..."}` with a 4xx/5xx status — the UI displays `message`
verbatim. 401 = missing/invalid token, 403 = wrong kind of token.

---

## Endpoints

### Public

| Method | Path | Notes |
|---|---|---|
| GET | `/api/products` | active products, `id` DESC. `?all=1` also returns inactive ones (the panel uses this). Filtering/search/sorting is done client-side by the bundle, so no other query params are needed |
| GET | `/api/products/:idOrSlug` | single product; the frontend builds this from `["/api/products", slug]` |
| GET | `/api/categories` | `[{id,name,slug,image,sort,sortOrder}]` |
| GET | `/api/settings` | full flat settings object (see below) |
| GET | `/api/seo/robots`, `/api/seo/robots.txt`, `/robots.txt` | `text/plain` |
| GET | `/api/seo/sitemap`, `/api/seo/sitemap.xml`, `/sitemap.xml` | `application/xml`, includes every active product |
| GET | `/api/health` | `{ok, products, orders}` (not in the bundle; convenience/uptime probe) |
| POST | `/api/orders` | place order (below) |
| POST | `/api/orders/track` | `{orderNumber, email\|phone}` → the order, or 404 `{message}` |
| POST | `/api/messages` | contact form `{name,email,phone,subject,message}` |
| POST | `/api/auth/signup` | `{name,email,password,phone,address,city}` → customer + token |
| POST | `/api/auth/login` | see Auth |
| POST | `/api/auth/logout` | invalidates the customer token |
| GET | `/api/auth/me` | current customer (falls back to the admin when only an admin token is sent) |
| PATCH | `/api/auth/me` | update own `{name,phone,address,city}` |
| GET | `/api/my-orders` | orders of the signed-in customer, newest first |

**`POST /api/orders` body** (exactly what the checkout sends):

```json
{ "name","email","phone","address","city","postal","note",
  "paymentMethod": "easypaisa|bank|cod", "txnId","proof",
  "items": [{ "productId", "sku", "name", "price", "qty", "image" }] }
```

The server **recomputes** `subtotal` from current product prices (sale price wins), applies
`shippingFlat` unless `subtotal >= freeShippingOver`, computes `total`, decrements stock, honours the
`guestCheckout` and `requireTxnId` settings, and links the order to the customer when a customer
token is present. Response contains `id, orderNumber, status ("pending"), createdAt, items[],
subtotal, shipping, total`, all the address fields, `paymentMethod, txnId, customerId`.

Order statuses used by the panel: `pending, payment-verified, processing, shipped, delivered,
cancelled`.

### Admin (all require `x-admin-token`)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/admin/logout` | invalidates the admin token |
| GET / PATCH | `/api/admin/account` | profile; PATCH `{name,email,currentPassword,newPassword}` |
| GET | `/api/admin/stats` | `{revenue, orderCount, pendingCount, productCount, outOfStock, customerCount, unreadMessages, recentOrders[{id,orderNumber,name,city,status,total}], topProducts[{name,sku,stock}]}` |
| GET / POST | `/api/admin/products` | list (incl. inactive) / create |
| PATCH · PUT · DELETE | `/api/admin/products/:id` | update / delete (the bundle uses PATCH; PUT accepted too) |
| GET | `/api/admin/products/export` | real `.xlsx` of all products |
| GET | `/api/admin/products/template` | `.xlsx` with sheets `Products` (headers) + `Example` (one filled row, ignored on import) |
| POST | `/api/admin/products/import` | multipart `file` (.xlsx/.csv) → `{created, updated, skipped, errors[]}`; rows are matched on SKU |
| GET / POST | `/api/admin/categories` | list / create `{name}` (slug auto-generated) |
| PATCH · PUT · DELETE | `/api/admin/categories/:id` | |
| GET | `/api/admin/orders` | all orders with items, newest first |
| GET | `/api/admin/orders/:id` | single order |
| PATCH · PUT | `/api/admin/orders/:id` | `{status}` |
| DELETE | `/api/admin/orders/:id` | |
| GET | `/api/admin/customers` | `[{id,name,email,phone,address,city,createdAt,orderCount}]` |
| DELETE | `/api/admin/customers/:id` | |
| GET | `/api/admin/messages` | `[{id,name,email,phone,subject,message,read,createdAt}]` |
| PATCH · PUT | `/api/admin/messages/:id` | empty body = mark read; `{read:false}` to unread |
| DELETE | `/api/admin/messages/:id` | |
| GET | `/api/admin/settings` | same object as `/api/settings` |
| PUT · PATCH | `/api/admin/settings` | partial merge, returns the merged settings |
| POST | `/api/admin/upload` | multipart `file` (JPG/PNG/WEBP/GIF/AVIF/SVG, ≤ 20 MB) → `{url: "/uploads/<name>", path, name, size}` |

### Admin extras used by `web/backup.js`, `web/console.js`

`GET /api/admin/backup/status`, `POST /api/admin/backup/config`, `POST /api/admin/backup/run`,
`GET /api/admin/backup/export`, `POST /api/admin/backup/import`, `POST /api/admin/backup/restore`,
`GET|DELETE /api/admin/backup/file/:name`, `POST /api/admin/backup/pick-folder`,
`POST /api/admin/backup/open-folder`, `GET|POST /api/admin/team`, `PATCH|DELETE /api/admin/team/:id`,
`GET /api/admin/site/check`.

Backups are JSON snapshots in `$DATA_DIR/backups`, pruned to `settings.backupConfig.keep`, and can be
triggered automatically (`autoEnabled`, `onChange`, `intervalMinutes`).

### CORS / static

- `Access-Control-Allow-Origin: *`, methods `GET,POST,PUT,PATCH,DELETE,OPTIONS`, allowed headers
  include `x-admin-token` and `x-customer-token`; `OPTIONS` → 204.
- `express.static(WEB_DIR)` then an SPA fallback to `index.html`; unknown `/api/*` paths return JSON
  404 (never the HTML shell). `/uploads/*` is served from `$DATA_DIR/uploads`.
- The frontend picks its API base from `window.__VW_API__` (`web/config.js`). Empty string = same
  origin, which is the self-hosted / desktop case; a `port/<n>` value is resolved relative to the
  page path.

---

## Settings object

Flat object, matching the live shop key-for-key:

`storeName, tagline, announcement, currency, aboutText, contactEmail, contactPhone, whatsappLink,
storeAddress, shippingFee` (+ `shippingFlat` alias), `freeShippingOver, easypaisaEnabled,
easypaisaName, easypaisaNumber, bankEnabled, bankName, bankTitle, bankAccount, bankIban, codEnabled,
requireTxnId, guestCheckout, paymentNote, siteDomain, localUrl, extraDomains, googleVerification,
bingVerification, seoTitle, seoDescription, seoKeywords, seoOgImage, seoCanonical, seoRobots, seoGa,
seoFbPixel, shippingPolicy, returnPolicy, ageNotice,
backupConfig{autoEnabled,onChange,intervalMinutes,keep}`.

## Compatibility aliases

The live shop and the compiled schema disagreed in a few places, so both spellings are emitted:
products carry `created_at` **and** `createdAt`, `images` **and** `gallery`; categories `sort` **and**
`sortOrder`; settings `shippingFlat` **and** `shippingFee`. Key-diff against the live API is now
empty in both directions except for these extra aliases.

---

## Could not be reconstructed with certainty

1. **Order-number algorithm** — only the placeholder `VW-XXXXXX00` was visible in the bundle. This
   server generates `VW-` + 6 uppercase hex chars + a 2-digit sequence, which matches the format but
   is not guaranteed to be the original generator.
2. **Excel template layout** — the bundle only revealed the sheet names (`Products`, `Example`). The
   column headers here are a reasonable reconstruction — `SKU, Name, Brand, Category, Description,
   Price, Sale price, Stock, Main image URL, Extra image URLs (comma separated), Flavour, Nicotine,
   Puffs, Featured (yes/no), Active (yes/no), SEO title, SEO description`. Import matches headers
   case- and punctuation-insensitively (and also accepts the raw field names), so a file exported
   from the original server should still import, but the header text may differ.
3. **`GET /api/auth/me`** is never called by the bundle (only `PATCH`), so its exact original
   response is unknown; it returns the customer, or the admin when only an admin token is present.
4. **`/api/admin/site/check`** shape is inferred from what `web/console.js` reads
   (`domainIps[]`, `reachable`, `https`).
5. **`backup/pick-folder` and `backup/open-folder`** were desktop-only (Electron) features; the
   server build answers `{supported:false}` with an explanatory `message`.
6. **Error message wording** — statuses and the `{message}` envelope are right, but the original
   English strings could not be recovered.
7. **Rate limiting / email sending / payment-gateway callbacks** — no trace of any of these in the
   bundle, so none are implemented.
