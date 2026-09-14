/**
 * VAPE WORLD — self-hosted store backend.
 *
 * Rebuilt from the compiled storefront bundle (web/assets/index-*.js) so the
 * existing frontend works unmodified. Plain JSON-file storage: no native
 * modules, so the same file runs on Render, in Electron and on a plain VPS.
 *
 *   node index.js            # PORT=9000, DATA_DIR=./data, WEB_DIR=../web
 *
 * Auth headers used by the frontend:
 *   x-admin-token     -> admin / vendor panel
 *   x-customer-token  -> shopper account
 */

'use strict';

const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;

/* --------------------------------------------------------------- paths ---- */

const PORT = Number(process.env.PORT || 9000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const SEED_DIR = path.join(__dirname, 'data');
const WEB_DIR = path.resolve(process.env.WEB_DIR || path.join(__dirname, '..', 'web'));

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'akimsaaaonline@gmail.com';
// No password is baked into this file. Set ADMIN_PASSWORD before the very first
// run to choose one; otherwise a strong random password is generated on the
// first start and written to ADMIN-LOGIN.txt inside the data folder.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

for (const dir of [DATA_DIR, UPLOAD_DIR, BACKUP_DIR]) fs.mkdirSync(dir, { recursive: true });

/* ------------------------------------------------------------- helpers ---- */

const ORDER_STATUSES = [
  'pending',
  'payment-verified',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
];

function nowStamp(d = new Date()) {
  // "2026-09-14 15:25:19" — the shape the live shop returns.
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

function slugify(value, fallback = 'item') {
  const s = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return s || fallback;
}

function toBool(v, dflt = false) {
  if (v === undefined || v === null || v === '') return dflt;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;
  return dflt;
}

function toNum(v, dflt = 0) {
  if (v === '' || v === null || v === undefined) return dflt;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : dflt;
}

function str(v, dflt = '') {
  if (v === null || v === undefined) return dflt;
  return String(v);
}

function token() {
  return crypto.randomBytes(24).toString('hex');
}

/* password hashing: node:crypto scrypt, no native deps */
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(String(plain), salt, 32).toString('hex');
  return `scrypt$${salt}$${key}`;
}

function verifyPassword(plain, stored) {
  if (!stored) return false;
  const parts = String(stored).split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return String(plain) === String(stored);
  const key = crypto.scryptSync(String(plain), parts[1], 32);
  const want = Buffer.from(parts[2], 'hex');
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}

/* --------------------------------------------------------------- store ---- */

const DEFAULT_SETTINGS = {
  storeName: 'VAPE WORLD',
  tagline: '',
  announcement: '',
  currency: 'PKR',
  aboutText: '',
  contactEmail: '',
  contactPhone: '',
  whatsappLink: '',
  storeAddress: '',
  shippingFee: 0,
  shippingFlat: 0,
  freeShippingOver: 0,
  easypaisaEnabled: true,
  easypaisaName: '',
  easypaisaNumber: '',
  bankEnabled: false,
  bankName: '',
  bankTitle: '',
  bankAccount: '',
  bankIban: '',
  codEnabled: false,
  requireTxnId: false,
  guestCheckout: true,
  paymentNote: '',
  siteDomain: '',
  localUrl: '',
  extraDomains: '',
  googleVerification: '',
  bingVerification: '',
  seoTitle: '',
  seoDescription: '',
  seoKeywords: '',
  seoOgImage: '',
  seoCanonical: '',
  seoRobots: 'index,follow',
  seoGa: '',
  seoFbPixel: '',
  shippingPolicy: '',
  returnPolicy: '',
  ageNotice: 'Products sold on this store are intended for adults 18 years or older.',
  backupConfig: { autoEnabled: true, onChange: true, intervalMinutes: 60, keep: 30 },
};

const EMPTY_DB = {
  version: 1,
  products: [],
  categories: [],
  orders: [],
  customers: [],
  messages: [],
  admins: [],
  settings: { ...DEFAULT_SETTINGS },
  sessions: {},
  counters: { product: 1, category: 1, order: 1, customer: 1, message: 1, admin: 1 },
  meta: { lastBackupAt: null, lastError: '', createdAt: new Date().toISOString() },
};

let db = null;
let writeQueue = Promise.resolve();

function readSeed(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(SEED_DIR, name), 'utf8'));
  } catch {
    return null;
  }
}

function nextId(kind) {
  const n = db.counters[kind] || 1;
  db.counters[kind] = n + 1;
  return n;
}

function loadDb() {
  if (fs.existsSync(STORE_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      db = { ...EMPTY_DB, ...raw };
      db.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
      db.counters = { ...EMPTY_DB.counters, ...(raw.counters || {}) };
      db.meta = { ...EMPTY_DB.meta, ...(raw.meta || {}) };
      db.sessions = raw.sessions || {};
      ensureAdmin();
      return;
    } catch (err) {
      console.error('[store] could not read store.json, re-seeding:', err.message);
    }
  }
  seedDb();
}

function seedDb() {
  db = JSON.parse(JSON.stringify(EMPTY_DB));

  const seedSettings = readSeed('seed-settings.json');
  if (seedSettings) db.settings = { ...DEFAULT_SETTINGS, ...seedSettings };

  const seedCategories = readSeed('seed-categories.json') || [];
  for (const c of seedCategories) {
    const id = Number(c.id) || nextId('category');
    db.counters.category = Math.max(db.counters.category, id + 1);
    db.categories.push({
      id,
      name: str(c.name),
      slug: str(c.slug) || slugify(c.name, `category-${id}`),
      image: str(c.image),
      sort: Number(c.sort ?? c.sortOrder ?? id) || id,
    });
  }

  const seedProducts = readSeed('seed-products.json') || [];
  for (const p of seedProducts) {
    const id = Number(p.id) || nextId('product');
    db.counters.product = Math.max(db.counters.product, id + 1);
    db.products.push(normaliseProduct(p, id));
  }

  ensureAdmin();
  console.log(
    `[store] seeded ${db.products.length} products, ${db.categories.length} categories`,
  );
}

function ensureAdmin() {
  if (!Array.isArray(db.admins)) db.admins = [];
  if (db.admins.length === 0) {
    const id = nextId('admin');
    const generated = !ADMIN_PASSWORD;
    const password = ADMIN_PASSWORD || `vw-${crypto.randomBytes(9).toString('base64url')}`;
    db.admins.push({
      id,
      email: ADMIN_EMAIL.toLowerCase(),
      name: 'Store Vendor',
      role: 'owner',
      password: hashPassword(password),
    });
    if (generated) {
      const note = path.join(DATA_DIR, 'ADMIN-LOGIN.txt');
      const body =
        'VAPE WORLD — vendor panel login (created on first start)\n\n' +
        `email:    ${ADMIN_EMAIL}\n` +
        `password: ${password}\n\n` +
        'Change this password from the panel (Login details tab) and then delete\n' +
        'this file. Anyone who can read it can manage the shop.\n';
      try {
        fs.writeFileSync(note, body, { mode: 0o600 });
      } catch (e) {
        /* the console line below is still shown */
      }
      console.log(`[auth] created vendor account ${ADMIN_EMAIL}`);
      console.log(`[auth] first-time password: ${password}  (also saved in ${note})`);
    } else {
      console.log(`[auth] created vendor account ${ADMIN_EMAIL} with ADMIN_PASSWORD`);
    }
  }
}

function save() {
  const snapshot = JSON.stringify(db, null, 2);
  writeQueue = writeQueue.then(async () => {
    const tmp = `${STORE_FILE}.tmp`;
    await fsp.writeFile(tmp, snapshot, 'utf8');
    await fsp.rename(tmp, STORE_FILE);
  }).catch((err) => console.error('[store] write failed:', err.message));
  maybeBackupOnChange();
  return writeQueue;
}

/* ---------------------------------------------------------- normalisers --- */

function categoryIdFor(name) {
  const hit = db.categories.find(
    (c) => c.name.toLowerCase() === String(name || '').toLowerCase(),
  );
  return hit ? hit.id : null;
}

function normaliseProduct(input, id) {
  const gallery = Array.isArray(input.gallery)
    ? input.gallery.filter(Boolean).map(String)
    : Array.isArray(input.images)
      ? input.images.filter(Boolean).map(String)
      : [];
  const name = str(input.name);
  const sale = input.salePrice === '' || input.salePrice === null || input.salePrice === undefined
    ? null
    : toNum(input.salePrice, 0);
  return {
    id,
    name,
    slug: str(input.slug) || slugify(name, `product-${id}`),
    description: str(input.description),
    price: toNum(input.price, 0),
    salePrice: sale,
    category: str(input.category) || 'Uncategorised',
    categoryId:
      input.categoryId === null || input.categoryId === undefined
        ? categoryIdFor(input.category)
        : Number(input.categoryId) || null,
    stock: Math.max(0, Math.trunc(toNum(input.stock, 0))),
    sku: str(input.sku),
    brand: str(input.brand),
    nicotine: str(input.nicotine),
    flavour: str(input.flavour),
    puffs: str(input.puffs),
    image: str(input.image),
    gallery,
    seoTitle: str(input.seoTitle),
    seoDescription: str(input.seoDescription),
    featured: toBool(input.featured, false),
    active: toBool(input.active, true),
    created_at: str(input.created_at || input.createdAt) || nowStamp(),
  };
}

/** Exact wire shape the storefront bundle reads. */
function productOut(p) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    price: p.price,
    salePrice: p.salePrice === null || p.salePrice === undefined ? null : p.salePrice,
    category: p.category,
    categoryId: p.categoryId ?? null,
    stock: p.stock,
    sku: p.sku,
    brand: p.brand,
    nicotine: p.nicotine,
    flavour: p.flavour,
    puffs: p.puffs,
    image: p.image,
    images: p.gallery || [],
    gallery: p.gallery || [],
    seoTitle: p.seoTitle,
    seoDescription: p.seoDescription,
    featured: !!p.featured,
    active: !!p.active,
    created_at: p.created_at,
    createdAt: p.created_at,
  };
}

function categoryOut(c) {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    image: c.image || '',
    sort: c.sort ?? c.id,
    sortOrder: c.sort ?? c.id,
  };
}

function orderOut(o) {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    customerId: o.customerId ?? null,
    name: o.name,
    email: o.email,
    phone: o.phone,
    address: o.address,
    city: o.city,
    postal: o.postal || '',
    note: o.note || '',
    items: o.items || [],
    subtotal: o.subtotal,
    shipping: o.shipping,
    total: o.total,
    paymentMethod: o.paymentMethod,
    txnId: o.txnId || '',
    proof: o.proof || '',
    status: o.status,
    createdAt: o.createdAt,
    created_at: o.createdAt,
  };
}

function customerOut(c) {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone || '',
    address: c.address || '',
    city: c.city || '',
    createdAt: c.createdAt,
    created_at: c.createdAt,
  };
}

function adminOut(a) {
  return { id: a.id, email: a.email, name: a.name, role: a.role || 'owner' };
}

function messageOut(m) {
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    subject: m.subject || '',
    body: m.body,
    read: !!m.read,
    createdAt: m.createdAt,
    created_at: m.createdAt,
  };
}

function settingsOut() {
  const s = { ...DEFAULT_SETTINGS, ...db.settings };
  // the storefront reads shippingFlat; keep the legacy alias in sync
  s.shippingFee = s.shippingFlat;
  return s;
}

/* ----------------------------------------------------------------- app ---- */

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, x-admin-token, x-customer-token, X-Requested-With',
  );
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

function fail(res, code, message) {
  return res.status(code).json({ message });
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---------------------------------------------------------------- auth ---- */

function sessionFor(rawToken, kind) {
  if (!rawToken) return null;
  const s = db.sessions[rawToken];
  if (!s || s.kind !== kind) return null;
  return s;
}

function currentAdmin(req) {
  const s = sessionFor(req.headers['x-admin-token'], 'admin');
  if (!s) return null;
  return db.admins.find((a) => a.id === s.id) || null;
}

function currentCustomer(req) {
  const s = sessionFor(req.headers['x-customer-token'], 'customer');
  if (!s) return null;
  return db.customers.find((c) => c.id === s.id) || null;
}

function requireAdmin(req, res, next) {
  const admin = currentAdmin(req);
  if (!admin) return fail(res, 401, 'Please sign in as the vendor.');
  req.admin = admin;
  return next();
}

function requireCustomer(req, res, next) {
  const customer = currentCustomer(req);
  if (!customer) return fail(res, 401, 'Please sign in to continue.');
  req.customer = customer;
  return next();
}

function issue(kind, id) {
  const t = token();
  db.sessions[t] = { kind, id, createdAt: new Date().toISOString() };
  return t;
}

/* ------------------------------------------------------- public catalog --- */

app.get('/api/health', (req, res) =>
  res.json({ ok: true, products: db.products.length, orders: db.orders.length }),
);

app.get('/api/products', (req, res) => {
  const all = req.query.all === '1' || req.query.all === 'true';
  const list = db.products
    .filter((p) => all || p.active)
    .slice()
    .sort((a, b) => b.id - a.id);
  res.json(list.map(productOut));
});

app.get('/api/products/:key', (req, res) => {
  const key = String(req.params.key);
  const p =
    db.products.find((x) => x.slug === key) ||
    db.products.find((x) => String(x.id) === key) ||
    db.products.find((x) => x.sku && x.sku.toLowerCase() === key.toLowerCase());
  if (!p) return fail(res, 404, 'Product not found');
  return res.json(productOut(p));
});

app.get('/api/categories', (req, res) => {
  const list = db.categories.slice().sort((a, b) => (a.sort ?? a.id) - (b.sort ?? b.id));
  res.json(list.map(categoryOut));
});

app.get('/api/settings', (req, res) => res.json(settingsOut()));

/* ------------------------------------------------------------------ seo --- */

function siteBase() {
  const s = settingsOut();
  const raw = str(s.seoCanonical) || str(s.siteDomain) || str(s.localUrl) || 'localhost';
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, '');
}

function robotsBody() {
  const s = settingsOut();
  const blocked = /noindex/i.test(str(s.seoRobots));
  return [
    'User-agent: *',
    blocked ? 'Disallow: /' : 'Allow: /',
    `Sitemap: ${siteBase()}/sitemap.xml`,
    '',
  ].join('\n');
}

function sitemapBody() {
  const base = siteBase();
  const urls = [`${base}/`, `${base}/#/shop`, `${base}/#/track`, `${base}/#/contact`];
  for (const p of db.products.filter((x) => x.active)) urls.push(`${base}/#/product/${p.slug}`);
  for (const c of db.categories) urls.push(`${base}/#/c/${c.slug}`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) => `  <url><loc>${u}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
}

for (const route of ['/api/seo/robots', '/api/seo/robots.txt', '/robots.txt']) {
  app.get(route, (req, res) => res.type('text/plain').send(robotsBody()));
}
for (const route of ['/api/seo/sitemap', '/api/seo/sitemap.xml', '/sitemap.xml']) {
  app.get(route, (req, res) => res.type('application/xml').send(sitemapBody()));
}

/* --------------------------------------------------------------- orders --- */

function makeOrderNumber() {
  for (let i = 0; i < 50; i += 1) {
    const body = crypto.randomBytes(3).toString('hex').toUpperCase();
    const tail = String((db.orders.length + 1 + i) % 100).padStart(2, '0');
    const candidate = `VW-${body}${tail}`;
    if (!db.orders.some((o) => o.orderNumber === candidate)) return candidate;
  }
  return `VW-${Date.now().toString(36).toUpperCase()}`;
}

app.post('/api/orders', wrap((req, res) => {
  const b = req.body || {};
  const settings = settingsOut();
  const customer = currentCustomer(req);

  if (!settings.guestCheckout && !customer) {
    return fail(res, 401, 'Please sign in or create an account to place an order.');
  }

  const name = str(b.name).trim();
  const email = str(b.email).trim().toLowerCase();
  const phone = str(b.phone).trim();
  const address = str(b.address).trim();
  const city = str(b.city).trim();
  const paymentMethod = str(b.paymentMethod).trim();

  if (name.length < 2) return fail(res, 400, 'Enter your full name');
  if (!/^\S+@\S+\.\S+$/.test(email)) return fail(res, 400, 'Enter a valid email');
  if (phone.replace(/\D/g, '').length < 7) return fail(res, 400, 'Enter a valid phone number');
  if (address.length < 5) return fail(res, 400, 'Shipping address is required');
  if (city.length < 2) return fail(res, 400, 'City is required');
  if (!['easypaisa', 'bank', 'cod'].includes(paymentMethod)) {
    return fail(res, 400, 'Choose a payment method');
  }
  const txnId = str(b.txnId).trim();
  if (settings.requireTxnId && paymentMethod !== 'cod' && !txnId) {
    return fail(res, 400, 'Enter your payment transaction ID');
  }

  const rawItems = Array.isArray(b.items) ? b.items : [];
  if (rawItems.length === 0) return fail(res, 400, 'Your cart is empty');

  const items = [];
  for (const raw of rawItems) {
    const qty = Math.max(1, Math.trunc(toNum(raw.qty, 1)));
    const product =
      db.products.find((p) => p.id === Number(raw.productId)) ||
      db.products.find((p) => p.sku && p.sku === str(raw.sku));
    if (!product) return fail(res, 400, `"${str(raw.name) || 'A product'}" is no longer available`);
    if (product.stock > 0 && qty > product.stock) {
      return fail(res, 400, `Only ${product.stock} × ${product.name} left in stock`);
    }
    const price = product.salePrice && product.salePrice > 0 ? product.salePrice : product.price;
    items.push({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      price,
      qty,
      image: product.image || str(raw.image),
    });
  }

  const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const shipping =
    settings.freeShippingOver > 0 && subtotal >= settings.freeShippingOver
      ? 0
      : toNum(settings.shippingFlat, 0);
  const total = subtotal + shipping;

  const order = {
    id: nextId('order'),
    orderNumber: makeOrderNumber(),
    customerId: customer ? customer.id : (b.customerId ?? null),
    name,
    email,
    phone,
    address,
    city,
    postal: str(b.postal).trim(),
    note: str(b.note),
    items,
    subtotal,
    shipping,
    total,
    paymentMethod,
    txnId,
    proof: str(b.proof),
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  db.orders.push(order);

  for (const item of items) {
    const p = db.products.find((x) => x.id === item.productId);
    if (p) p.stock = Math.max(0, p.stock - item.qty);
  }

  save();
  return res.status(201).json(orderOut(order));
}));

app.post('/api/orders/track', (req, res) => {
  const num = str(req.body && req.body.orderNumber).trim().toUpperCase();
  const email = str(req.body && req.body.email).trim().toLowerCase();
  if (!num || !email) return fail(res, 400, 'Enter your order number and email');
  const order = db.orders.find(
    (o) => o.orderNumber.toUpperCase() === num && o.email.toLowerCase() === email,
  );
  if (!order) {
    return fail(res, 404, 'We could not find an order with that number and email.');
  }
  return res.json(orderOut(order));
});

/* ------------------------------------------------------------- messages --- */

app.post('/api/messages', (req, res) => {
  const b = req.body || {};
  const name = str(b.name).trim();
  const email = str(b.email).trim().toLowerCase();
  const body = str(b.body).trim();
  if (name.length < 2) return fail(res, 400, 'Your name is required');
  if (!/^\S+@\S+\.\S+$/.test(email)) return fail(res, 400, 'Enter a valid email');
  if (body.length < 5) return fail(res, 400, 'Please write your message');

  const message = {
    id: nextId('message'),
    name,
    email,
    subject: str(b.subject).trim(),
    body,
    read: false,
    createdAt: new Date().toISOString(),
  };
  db.messages.push(message);
  save();
  return res.status(201).json(messageOut(message));
});

/* -------------------------------------------------------- customer auth --- */

app.post('/api/auth/signup', (req, res) => {
  const b = req.body || {};
  const name = str(b.name).trim();
  const email = str(b.email).trim().toLowerCase();
  const phone = str(b.phone).trim();
  const password = str(b.password);
  if (name.length < 2) return fail(res, 400, 'Enter your full name');
  if (!/^\S+@\S+\.\S+$/.test(email)) return fail(res, 400, 'Enter a valid email');
  if (phone.replace(/\D/g, '').length < 7) return fail(res, 400, 'Enter a valid phone number');
  if (password.length < 8) return fail(res, 400, 'At least 8 characters');
  if (db.customers.some((c) => c.email === email)) {
    return fail(res, 409, 'An account already exists for that email. Please sign in.');
  }
  if (db.admins.some((a) => a.email === email)) {
    return fail(res, 409, 'That email is reserved for the store vendor.');
  }

  const customer = {
    id: nextId('customer'),
    name,
    email,
    phone,
    password: hashPassword(password),
    address: str(b.address).trim(),
    city: str(b.city).trim(),
    createdAt: new Date().toISOString(),
  };
  db.customers.push(customer);
  const t = issue('customer', customer.id);
  save();
  return res.status(201).json({ role: 'customer', token: t, customer: customerOut(customer) });
});

app.post('/api/auth/login', (req, res) => {
  const email = str(req.body && req.body.email).trim().toLowerCase();
  const password = str(req.body && req.body.password);
  if (!email || !password) return fail(res, 400, 'Enter your email and password');

  const admin = db.admins.find((a) => a.email === email);
  if (admin && verifyPassword(password, admin.password)) {
    const t = issue('admin', admin.id);
    save();
    return res.json({ role: 'admin', token: t, admin: adminOut(admin) });
  }

  const customer = db.customers.find((c) => c.email === email);
  if (customer && verifyPassword(password, customer.password)) {
    const t = issue('customer', customer.id);
    save();
    return res.json({ role: 'customer', token: t, customer: customerOut(customer) });
  }

  return fail(res, 401, 'Those details do not match an account.');
});

app.get('/api/auth/me', (req, res) => {
  const customer = currentCustomer(req);
  if (customer) return res.json(customerOut(customer));
  const admin = currentAdmin(req);
  if (admin) return res.json({ ...adminOut(admin), role: 'admin' });
  return fail(res, 401, 'Not signed in');
});

const patchMe = (req, res) => {
  const c = req.customer;
  const b = req.body || {};
  if (b.name !== undefined) {
    const name = str(b.name).trim();
    if (name.length < 2) return fail(res, 400, 'Enter your full name');
    c.name = name;
  }
  if (b.phone !== undefined) {
    const phone = str(b.phone).trim();
    if (phone.replace(/\D/g, '').length < 7) return fail(res, 400, 'Enter a valid phone number');
    c.phone = phone;
  }
  if (b.address !== undefined) c.address = str(b.address).slice(0, 500);
  if (b.city !== undefined) c.city = str(b.city).slice(0, 120);
  if (b.password) {
    if (str(b.password).length < 8) return fail(res, 400, 'At least 8 characters');
    c.password = hashPassword(b.password);
  }
  save();
  return res.json(customerOut(c));
};
app.patch('/api/auth/me', requireCustomer, patchMe);
app.put('/api/auth/me', requireCustomer, patchMe);

app.post('/api/auth/logout', (req, res) => {
  const t = req.headers['x-customer-token'];
  if (t && db.sessions[t]) {
    delete db.sessions[t];
    save();
  }
  return res.json({ ok: true });
});

app.get('/api/my-orders', requireCustomer, (req, res) => {
  const mine = db.orders
    .filter(
      (o) =>
        o.customerId === req.customer.id ||
        o.email.toLowerCase() === req.customer.email.toLowerCase(),
    )
    .slice()
    .sort((a, b) => b.id - a.id);
  return res.json(mine.map(orderOut));
});

/* ------------------------------------------------------ admin: session ---- */

app.post('/api/admin/logout', (req, res) => {
  const t = req.headers['x-admin-token'];
  if (t && db.sessions[t]) {
    delete db.sessions[t];
    save();
  }
  return res.json({ ok: true });
});

app.get('/api/admin/account', requireAdmin, (req, res) => res.json(adminOut(req.admin)));

const patchAccount = (req, res) => {
  const b = req.body || {};
  const admin = req.admin;
  const wantsPassword = !!str(b.newPassword);
  const wantsEmail = b.email !== undefined && str(b.email).trim().toLowerCase() !== admin.email;

  if (wantsPassword || wantsEmail) {
    if (!verifyPassword(str(b.currentPassword), admin.password)) {
      return fail(res, 400, 'Your current password is not correct.');
    }
  }
  if (b.name !== undefined && str(b.name).trim()) admin.name = str(b.name).trim();
  if (wantsEmail) {
    const email = str(b.email).trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return fail(res, 400, 'Enter a valid email');
    if (db.admins.some((a) => a.id !== admin.id && a.email === email)) {
      return fail(res, 409, 'Another backend user already uses that email.');
    }
    admin.email = email;
  }
  if (wantsPassword) {
    if (str(b.newPassword).length < 6) return fail(res, 400, 'Use at least 6 characters.');
    admin.password = hashPassword(b.newPassword);
    // sign every other admin session out
    for (const [t, s] of Object.entries(db.sessions)) {
      if (s.kind === 'admin' && s.id === admin.id && t !== req.headers['x-admin-token']) {
        delete db.sessions[t];
      }
    }
  }
  save();
  return res.json(adminOut(admin));
};
app.patch('/api/admin/account', requireAdmin, patchAccount);
app.put('/api/admin/account', requireAdmin, patchAccount);

/* -------------------------------------------------------- admin: stats ---- */

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const orders = db.orders;
  const revenue = orders
    .filter((o) => o.status !== 'cancelled')
    .reduce((sum, o) => sum + toNum(o.total, 0), 0);
  const recentOrders = orders
    .slice()
    .sort((a, b) => b.id - a.id)
    .slice(0, 6)
    .map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      name: o.name,
      city: o.city,
      status: o.status,
      total: o.total,
      createdAt: o.createdAt,
    }));
  const topProducts = db.products
    .slice()
    .sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name))
    .slice(0, 8)
    .map((p) => ({ id: p.id, name: p.name, sku: p.sku, stock: p.stock }));

  res.json({
    revenue,
    orderCount: orders.length,
    pendingCount: orders.filter((o) => o.status === 'pending').length,
    productCount: db.products.length,
    outOfStock: db.products.filter((p) => p.stock <= 0).length,
    customerCount: db.customers.length,
    messageCount: db.messages.length,
    unreadMessages: db.messages.filter((m) => !m.read).length,
    categoryCount: db.categories.length,
    recentOrders,
    topProducts,
  });
});

/* ----------------------------------------------------- admin: products ---- */

function uniqueSlug(name, ignoreId) {
  const base = slugify(name, 'product');
  let candidate = base;
  let n = 2;
  while (db.products.some((p) => p.slug === candidate && p.id !== ignoreId)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

function validateProductBody(b, res, ignoreId) {
  const sku = str(b.sku).trim();
  const name = str(b.name).trim();
  if (!sku) {
    fail(res, 400, 'SKU is required');
    return null;
  }
  if (name.length < 2) {
    fail(res, 400, 'Product name is required');
    return null;
  }
  if (db.products.some((p) => p.sku.toLowerCase() === sku.toLowerCase() && p.id !== ignoreId)) {
    fail(res, 409, `Another product already uses the SKU "${sku}".`);
    return null;
  }
  return { sku, name };
}

app.get('/api/admin/products', requireAdmin, (req, res) => {
  res.json(db.products.slice().sort((a, b) => b.id - a.id).map(productOut));
});

app.post('/api/admin/products', requireAdmin, (req, res) => {
  const b = req.body || {};
  const ok = validateProductBody(b, res, -1);
  if (!ok) return undefined;
  const id = nextId('product');
  const product = normaliseProduct(
    { ...b, sku: ok.sku, name: ok.name, slug: str(b.slug).trim() || uniqueSlug(ok.name, -1) },
    id,
  );
  db.products.push(product);
  save();
  return res.status(201).json(productOut(product));
});

const updateProduct = (req, res) => {
  const product = db.products.find((p) => String(p.id) === String(req.params.id));
  if (!product) return fail(res, 404, 'Product not found');
  const b = req.body || {};
  const ok = validateProductBody({ sku: b.sku ?? product.sku, name: b.name ?? product.name }, res, product.id);
  if (!ok) return undefined;

  const merged = normaliseProduct(
    {
      ...product,
      ...b,
      sku: ok.sku,
      name: ok.name,
      slug:
        str(b.slug).trim() ||
        (ok.name !== product.name ? uniqueSlug(ok.name, product.id) : product.slug),
      gallery: b.gallery ?? b.images ?? product.gallery,
      created_at: product.created_at,
    },
    product.id,
  );
  Object.assign(product, merged);
  save();
  return res.json(productOut(product));
};
app.patch('/api/admin/products/:id', requireAdmin, updateProduct);
app.put('/api/admin/products/:id', requireAdmin, updateProduct);

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  const i = db.products.findIndex((p) => String(p.id) === String(req.params.id));
  if (i === -1) return fail(res, 404, 'Product not found');
  const [removed] = db.products.splice(i, 1);
  save();
  return res.json({ ok: true, id: removed.id });
});

/* --------------------------------------- admin: product sheet workflows --- */

const SHEET_COLUMNS = [
  ['sku', 'SKU'],
  ['name', 'Name'],
  ['brand', 'Brand'],
  ['category', 'Category'],
  ['description', 'Description'],
  ['price', 'Price'],
  ['salePrice', 'Sale price'],
  ['stock', 'Stock'],
  ['image', 'Main image URL'],
  ['gallery', 'Extra image URLs (comma separated)'],
  ['flavour', 'Flavour'],
  ['nicotine', 'Nicotine'],
  ['puffs', 'Puffs'],
  ['featured', 'Featured (yes/no)'],
  ['active', 'Active (yes/no)'],
  ['seoTitle', 'SEO title'],
  ['seoDescription', 'SEO description'],
];

function sheetRowFor(p) {
  return {
    SKU: p.sku,
    Name: p.name,
    Brand: p.brand,
    Category: p.category,
    Description: p.description,
    Price: p.price,
    'Sale price': p.salePrice ?? '',
    Stock: p.stock,
    'Main image URL': p.image,
    'Extra image URLs (comma separated)': (p.gallery || []).join(', '),
    Flavour: p.flavour,
    Nicotine: p.nicotine,
    Puffs: p.puffs,
    'Featured (yes/no)': p.featured ? 'yes' : 'no',
    'Active (yes/no)': p.active ? 'yes' : 'no',
    'SEO title': p.seoTitle,
    'SEO description': p.seoDescription,
  };
}

function sendWorkbook(res, wb, filename) {
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(buf);
}

app.get('/api/admin/products/export', requireAdmin, (req, res) => {
  const headers = SHEET_COLUMNS.map(([, label]) => label);
  const rows = db.products.slice().sort((a, b) => a.id - b.id).map(sheetRowFor);
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Products');
  return sendWorkbook(res, wb, 'vape-world-products.xlsx');
});

app.get('/api/admin/products/template', requireAdmin, (req, res) => {
  const headers = SHEET_COLUMNS.map(([, label]) => label);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([], { header: headers }),
    'Products',
  );
  const example = sheetRowFor({
    sku: 'VW-0001',
    name: 'Elf Bar BC5000',
    brand: 'Elf Bar',
    category: db.categories[0]?.name || 'Disposable Vapes',
    description: '5000 puff rechargeable disposable vape.',
    price: 4500,
    salePrice: 3900,
    stock: 25,
    image: '/products/prod-disposable.jpg',
    gallery: [],
    flavour: 'Blue Razz',
    nicotine: '50mg',
    puffs: '5000',
    featured: true,
    active: true,
    seoTitle: '',
    seoDescription: '',
  });
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([example], { header: headers }),
    'Example',
  );
  return sendWorkbook(res, wb, 'vape-world-product-template.xlsx');
});

function pickCell(row, key, label) {
  const candidates = [label, key, key.toLowerCase(), label.toLowerCase()];
  for (const c of candidates) {
    if (row[c] !== undefined) return row[c];
  }
  const wanted = label.toLowerCase().replace(/[^a-z0-9]/g, '');
  const wanted2 = key.toLowerCase();
  for (const [k, v] of Object.entries(row)) {
    const norm = String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (norm === wanted || norm === wanted2) return v;
  }
  return undefined;
}

app.post(
  '/api/admin/products/import',
  requireAdmin,
  upload.single('file'),
  wrap((req, res) => {
    if (!req.file) return fail(res, 400, 'Attach an Excel or CSV file.');
    let wb;
    try {
      wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    } catch (err) {
      return fail(res, 400, `That file could not be read (${err.message}).`);
    }
    const sheetName =
      wb.SheetNames.find((n) => n.toLowerCase() === 'products') ||
      wb.SheetNames.find((n) => n.toLowerCase() !== 'example') ||
      wb.SheetNames[0];
    if (!sheetName) return fail(res, 400, 'The file has no sheets.');
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];

    rows.forEach((row, index) => {
      const line = index + 2;
      const get = (key) => {
        const col = SHEET_COLUMNS.find(([k]) => k === key);
        return pickCell(row, key, col ? col[1] : key);
      };
      const sku = str(get('sku')).trim();
      const name = str(get('name')).trim();
      if (!sku && !name) {
        skipped += 1;
        return;
      }
      if (!sku) {
        skipped += 1;
        errors.push(`Row ${line}: missing SKU`);
        return;
      }
      if (name.length < 2) {
        skipped += 1;
        errors.push(`Row ${line}: missing product name`);
        return;
      }

      const galleryRaw = str(get('gallery'));
      const patch = {
        sku,
        name,
        brand: str(get('brand')),
        category: str(get('category')) || 'Uncategorised',
        description: str(get('description')),
        price: toNum(get('price'), 0),
        salePrice: str(get('salePrice')).trim() === '' ? null : toNum(get('salePrice'), 0),
        stock: Math.max(0, Math.trunc(toNum(get('stock'), 0))),
        image: str(get('image')),
        gallery: galleryRaw
          ? galleryRaw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
          : [],
        flavour: str(get('flavour')),
        nicotine: str(get('nicotine')),
        puffs: str(get('puffs')),
        featured: toBool(get('featured'), false),
        active: toBool(get('active'), true),
        seoTitle: str(get('seoTitle')),
        seoDescription: str(get('seoDescription')),
      };

      const existing = db.products.find((p) => p.sku.toLowerCase() === sku.toLowerCase());
      if (existing) {
        Object.assign(
          existing,
          normaliseProduct(
            { ...existing, ...patch, slug: existing.slug, created_at: existing.created_at },
            existing.id,
          ),
        );
        updated += 1;
      } else {
        const id = nextId('product');
        db.products.push(normaliseProduct({ ...patch, slug: uniqueSlug(name, -1) }, id));
        created += 1;
      }
    });

    save();
    return res.json({ created, updated, skipped, errors, total: rows.length });
  }),
);

/* --------------------------------------------------- admin: categories ---- */

app.get('/api/admin/categories', requireAdmin, (req, res) => {
  const list = db.categories.slice().sort((a, b) => (a.sort ?? a.id) - (b.sort ?? b.id));
  res.json(list.map(categoryOut));
});

app.post('/api/admin/categories', requireAdmin, (req, res) => {
  const name = str(req.body && req.body.name).trim();
  if (name.length < 2) return fail(res, 400, 'Enter a category name');
  if (db.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    return fail(res, 409, 'That category already exists.');
  }
  const id = nextId('category');
  let slug = str(req.body.slug).trim() || slugify(name, `category-${id}`);
  let n = 2;
  while (db.categories.some((c) => c.slug === slug)) {
    slug = `${slugify(name, `category-${id}`)}-${n}`;
    n += 1;
  }
  const category = {
    id,
    name,
    slug,
    image: str(req.body.image),
    sort: Number(req.body.sort ?? req.body.sortOrder) || db.categories.length + 1,
  };
  db.categories.push(category);
  save();
  return res.status(201).json(categoryOut(category));
});

const updateCategory = (req, res) => {
  const c = db.categories.find((x) => String(x.id) === String(req.params.id));
  if (!c) return fail(res, 404, 'Category not found');
  const b = req.body || {};
  const previousName = c.name;
  if (b.name !== undefined) {
    const name = str(b.name).trim();
    if (name.length < 2) return fail(res, 400, 'Enter a category name');
    c.name = name;
  }
  if (b.slug !== undefined && str(b.slug).trim()) c.slug = slugify(b.slug, c.slug);
  if (b.image !== undefined) c.image = str(b.image);
  if (b.sort !== undefined || b.sortOrder !== undefined) {
    c.sort = Number(b.sort ?? b.sortOrder) || c.sort;
  }
  if (c.name !== previousName) {
    for (const p of db.products) {
      if (p.category === previousName) {
        p.category = c.name;
        p.categoryId = c.id;
      }
    }
  }
  save();
  return res.json(categoryOut(c));
};
app.patch('/api/admin/categories/:id', requireAdmin, updateCategory);
app.put('/api/admin/categories/:id', requireAdmin, updateCategory);

app.delete('/api/admin/categories/:id', requireAdmin, (req, res) => {
  const i = db.categories.findIndex((c) => String(c.id) === String(req.params.id));
  if (i === -1) return fail(res, 404, 'Category not found');
  const [removed] = db.categories.splice(i, 1);
  for (const p of db.products) {
    if (p.categoryId === removed.id) p.categoryId = null;
  }
  save();
  return res.json({ ok: true, id: removed.id });
});

/* ------------------------------------------------------- admin: orders ---- */

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const list = db.orders.slice().sort((a, b) => b.id - a.id);
  res.json(list.map(orderOut));
});

app.get('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const o = db.orders.find((x) => String(x.id) === String(req.params.id));
  if (!o) return fail(res, 404, 'Order not found');
  return res.json(orderOut(o));
});

const updateOrder = (req, res) => {
  const o = db.orders.find((x) => String(x.id) === String(req.params.id));
  if (!o) return fail(res, 404, 'Order not found');
  const b = req.body || {};
  if (b.status !== undefined) {
    const status = str(b.status).trim();
    if (!ORDER_STATUSES.includes(status)) return fail(res, 400, `Unknown status "${status}"`);
    o.status = status;
  }
  for (const field of ['name', 'email', 'phone', 'address', 'city', 'postal', 'note', 'txnId']) {
    if (b[field] !== undefined) o[field] = str(b[field]);
  }
  save();
  return res.json(orderOut(o));
};
app.patch('/api/admin/orders/:id', requireAdmin, updateOrder);
app.put('/api/admin/orders/:id', requireAdmin, updateOrder);

app.delete('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const i = db.orders.findIndex((o) => String(o.id) === String(req.params.id));
  if (i === -1) return fail(res, 404, 'Order not found');
  const [removed] = db.orders.splice(i, 1);
  save();
  return res.json({ ok: true, id: removed.id });
});

/* ---------------------------------------------------- admin: customers ---- */

app.get('/api/admin/customers', requireAdmin, (req, res) => {
  const list = db.customers.slice().sort((a, b) => b.id - a.id);
  res.json(
    list.map((c) => ({
      ...customerOut(c),
      orderCount: db.orders.filter(
        (o) => o.customerId === c.id || o.email.toLowerCase() === c.email.toLowerCase(),
      ).length,
    })),
  );
});

app.delete('/api/admin/customers/:id', requireAdmin, (req, res) => {
  const i = db.customers.findIndex((c) => String(c.id) === String(req.params.id));
  if (i === -1) return fail(res, 404, 'Customer not found');
  const [removed] = db.customers.splice(i, 1);
  for (const [t, s] of Object.entries(db.sessions)) {
    if (s.kind === 'customer' && s.id === removed.id) delete db.sessions[t];
  }
  save();
  return res.json({ ok: true, id: removed.id });
});

/* ----------------------------------------------------- admin: messages ---- */

app.get('/api/admin/messages', requireAdmin, (req, res) => {
  const list = db.messages.slice().sort((a, b) => b.id - a.id);
  res.json(list.map(messageOut));
});

const updateMessage = (req, res) => {
  const m = db.messages.find((x) => String(x.id) === String(req.params.id));
  if (!m) return fail(res, 404, 'Message not found');
  const b = req.body || {};
  // the panel PATCHes with no body to mean "mark as read"
  m.read = b && b.read !== undefined ? toBool(b.read, true) : true;
  save();
  return res.json(messageOut(m));
};
app.patch('/api/admin/messages/:id', requireAdmin, updateMessage);
app.put('/api/admin/messages/:id', requireAdmin, updateMessage);

app.delete('/api/admin/messages/:id', requireAdmin, (req, res) => {
  const i = db.messages.findIndex((m) => String(m.id) === String(req.params.id));
  if (i === -1) return fail(res, 404, 'Message not found');
  const [removed] = db.messages.splice(i, 1);
  save();
  return res.json({ ok: true, id: removed.id });
});

/* ----------------------------------------------------- admin: settings ---- */

app.get('/api/admin/settings', requireAdmin, (req, res) => res.json(settingsOut()));

const saveSettings = (req, res) => {
  const b = req.body || {};
  const next = { ...db.settings };
  for (const [key, value] of Object.entries(b)) {
    if (key === 'id') continue;
    if (key === 'backupConfig' && value && typeof value === 'object') {
      next.backupConfig = { ...DEFAULT_SETTINGS.backupConfig, ...next.backupConfig, ...value };
      continue;
    }
    const dflt = DEFAULT_SETTINGS[key];
    if (typeof dflt === 'boolean') next[key] = toBool(value, dflt);
    else if (typeof dflt === 'number') next[key] = toNum(value, dflt);
    else next[key] = value === null || value === undefined ? '' : String(value);
  }
  if (!str(next.storeName).trim()) return fail(res, 400, 'The store name cannot be empty.');
  if (b.shippingFee !== undefined && b.shippingFlat === undefined) {
    next.shippingFlat = toNum(b.shippingFee, next.shippingFlat);
  }
  for (const key of ['whatsappLink', 'seoOgImage']) {
    const v = str(next[key]).trim();
    if (v && !/^(https?:\/\/|\/)/i.test(v)) {
      return fail(res, 400, 'Enter a full web address starting with http:// or https://');
    }
  }
  db.settings = next;
  save();
  return res.json(settingsOut());
};
app.put('/api/admin/settings', requireAdmin, saveSettings);
app.patch('/api/admin/settings', requireAdmin, saveSettings);

/* ------------------------------------------------------- admin: upload ---- */

const IMAGE_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
};

app.post(
  '/api/admin/upload',
  requireAdmin,
  upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) return fail(res, 400, 'Choose an image to upload.');
    const ext =
      IMAGE_EXT[req.file.mimetype] ||
      (path.extname(req.file.originalname || '').toLowerCase() || '.bin');
    if (!Object.values(IMAGE_EXT).includes(ext)) {
      return fail(res, 400, 'Please upload a JPG, PNG, WEBP, GIF, AVIF or SVG image.');
    }
    const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    await fsp.writeFile(path.join(UPLOAD_DIR, name), req.file.buffer);
    const url = `/uploads/${name}`;
    return res.status(201).json({ url, path: url, name, size: req.file.size });
  }),
);

/* --------------------------------------------------------- admin: team ---- */

app.get('/api/admin/team', requireAdmin, (req, res) => {
  res.json(db.admins.map((a) => ({ ...adminOut(a), isYou: a.id === req.admin.id })));
});

app.post('/api/admin/team', requireAdmin, (req, res) => {
  const b = req.body || {};
  const email = str(b.email).trim().toLowerCase();
  const password = str(b.password);
  if (!/^\S+@\S+\.\S+$/.test(email)) return fail(res, 400, 'Enter a valid email');
  if (password.length < 6) return fail(res, 400, 'Use at least 6 characters.');
  if (db.admins.some((a) => a.email === email)) {
    return fail(res, 409, 'That email already has backend access.');
  }
  const admin = {
    id: nextId('admin'),
    email,
    name: str(b.name).trim() || 'Team member',
    role: str(b.role).trim() || 'staff',
    password: hashPassword(password),
  };
  db.admins.push(admin);
  save();
  return res.status(201).json(adminOut(admin));
});

app.patch('/api/admin/team/:id', requireAdmin, (req, res) => {
  const a = db.admins.find((x) => String(x.id) === String(req.params.id));
  if (!a) return fail(res, 404, 'Backend user not found');
  const b = req.body || {};
  if (b.password !== undefined) {
    if (str(b.password).length < 6) return fail(res, 400, 'Use at least 6 characters.');
    a.password = hashPassword(b.password);
  }
  if (b.name !== undefined && str(b.name).trim()) a.name = str(b.name).trim();
  if (b.role !== undefined && str(b.role).trim()) a.role = str(b.role).trim();
  save();
  return res.json(adminOut(a));
});

app.delete('/api/admin/team/:id', requireAdmin, (req, res) => {
  if (db.admins.length <= 1) return fail(res, 400, 'Keep at least one backend user.');
  const i = db.admins.findIndex((x) => String(x.id) === String(req.params.id));
  if (i === -1) return fail(res, 404, 'Backend user not found');
  const [removed] = db.admins.splice(i, 1);
  for (const [t, s] of Object.entries(db.sessions)) {
    if (s.kind === 'admin' && s.id === removed.id) delete db.sessions[t];
  }
  save();
  return res.json({ ok: true, id: removed.id });
});

/* --------------------------------------------------- admin: site check ---- */

app.get('/api/admin/site/check', requireAdmin, wrap(async (req, res) => {
  const s = settingsOut();
  const domain = str(s.siteDomain).replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim();
  const result = {
    domain,
    domainIps: [],
    reachable: false,
    https: false,
    status: 0,
    checkedAt: new Date().toISOString(),
    message: '',
  };
  if (!domain) {
    result.message = 'Save your live domain first.';
    return res.json(result);
  }
  try {
    result.domainIps = await dns.resolve4(domain);
  } catch (err) {
    result.message = `DNS lookup failed: ${err.code || err.message}`;
  }
  for (const scheme of ['https', 'http']) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(`${scheme}://${domain}/`, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      });
      clearTimeout(timer);
      result.reachable = true;
      result.https = scheme === 'https';
      result.status = response.status;
      break;
    } catch {
      /* try the next scheme */
    }
  }
  if (!result.message) {
    result.message = result.reachable ? 'Your domain answered.' : 'The domain did not answer yet.';
  }
  return res.json(result);
}));

/* ------------------------------------------------------ admin: backups ---- */

function snapshotObject() {
  return {
    kind: 'vape-world-backup',
    version: 1,
    takenAt: new Date().toISOString(),
    data: {
      products: db.products,
      categories: db.categories,
      orders: db.orders,
      customers: db.customers,
      messages: db.messages,
      admins: db.admins,
      settings: db.settings,
      counters: db.counters,
    },
  };
}

function backupFiles() {
  try {
    return fs
      .readdirSync(BACKUP_DIR)
      .filter((n) => n.endsWith('.json'))
      .map((name) => {
        const st = fs.statSync(path.join(BACKUP_DIR, name));
        return { name, size: st.size, createdAt: st.mtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

function backupConfig() {
  return { ...DEFAULT_SETTINGS.backupConfig, ...(db.settings.backupConfig || {}) };
}

function writeBackup(reason = 'manual') {
  const cfg = backupConfig();
  const p = (n) => String(n).padStart(2, '0');
  const d = new Date();
  const stamp =
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  const name = `vapeworld_${stamp}_${reason}.json`;
  try {
    fs.writeFileSync(path.join(BACKUP_DIR, name), JSON.stringify(snapshotObject(), null, 2));
    db.meta.lastBackupAt = new Date().toISOString();
    db.meta.lastError = '';
    const keep = Math.max(1, Number(cfg.keep) || 30);
    const files = backupFiles();
    for (const extra of files.slice(keep)) {
      try {
        fs.unlinkSync(path.join(BACKUP_DIR, extra.name));
      } catch { /* ignore */ }
    }
    return { name };
  } catch (err) {
    db.meta.lastError = err.message;
    return { name: null, error: err.message };
  }
}

let changeBackupTimer = null;
function maybeBackupOnChange() {
  if (!db || !backupConfig().onChange) return;
  clearTimeout(changeBackupTimer);
  changeBackupTimer = setTimeout(() => writeBackup('change'), 15000);
  changeBackupTimer.unref?.();
}

app.get('/api/admin/backup/status', requireAdmin, (req, res) => {
  const files = backupFiles();
  const cfg = backupConfig();
  res.json({
    dataFolder: DATA_DIR,
    backupFolder: BACKUP_DIR,
    desktop: false,
    counts: {
      products: db.products.length,
      orders: db.orders.length,
      customers: db.customers.length,
      messages: db.messages.length,
      categories: db.categories.length,
    },
    backups: files,
    totalBackups: files.length,
    totalSize: files.reduce((sum, f) => sum + f.size, 0),
    lastBackupAt: db.meta.lastBackupAt,
    lastError: db.meta.lastError || '',
    autoEnabled: !!cfg.autoEnabled,
    onChange: !!cfg.onChange,
    intervalMinutes: Number(cfg.intervalMinutes) || 60,
    keep: Number(cfg.keep) || 30,
  });
});

app.post('/api/admin/backup/config', requireAdmin, (req, res) => {
  const b = req.body || {};
  const cfg = backupConfig();
  if (b.autoEnabled !== undefined) cfg.autoEnabled = toBool(b.autoEnabled, cfg.autoEnabled);
  if (b.onChange !== undefined) cfg.onChange = toBool(b.onChange, cfg.onChange);
  if (b.intervalMinutes !== undefined) {
    cfg.intervalMinutes = Math.min(1440, Math.max(1, Math.trunc(toNum(b.intervalMinutes, 60))));
  }
  if (b.keep !== undefined) cfg.keep = Math.min(500, Math.max(1, Math.trunc(toNum(b.keep, 30))));
  db.settings.backupConfig = cfg;
  save();
  restartAutoBackup();
  return res.json(cfg);
});

app.post('/api/admin/backup/run', requireAdmin, (req, res) => {
  const result = writeBackup(str(req.body && req.body.reason) || 'manual');
  save();
  if (!result.name) return fail(res, 500, result.error || 'Backup failed');
  return res.json({ ok: true, name: result.name, lastBackupAt: db.meta.lastBackupAt });
});

app.get('/api/admin/backup/export', requireAdmin, (req, res) => res.json(snapshotObject()));

app.get('/api/admin/backup/file/:name', requireAdmin, (req, res) => {
  const name = path.basename(String(req.params.name));
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) return fail(res, 404, 'Backup not found');
  return res.type('application/json').send(fs.readFileSync(file, 'utf8'));
});

app.delete('/api/admin/backup/file/:name', requireAdmin, (req, res) => {
  const name = path.basename(String(req.params.name));
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) return fail(res, 404, 'Backup not found');
  fs.unlinkSync(file);
  return res.json({ ok: true, name });
});

function applySnapshot(snapshot, mode) {
  const data = (snapshot && snapshot.data) || snapshot;
  if (!data || typeof data !== 'object') throw new Error('That file is not a VAPE WORLD backup.');
  const lists = ['products', 'categories', 'orders', 'customers', 'messages', 'admins'];
  if (mode === 'replace') {
    for (const key of lists) if (Array.isArray(data[key])) db[key] = data[key];
    if (data.settings) db.settings = { ...DEFAULT_SETTINGS, ...data.settings };
    if (data.counters) db.counters = { ...db.counters, ...data.counters };
  } else {
    for (const key of lists) {
      if (!Array.isArray(data[key])) continue;
      for (const row of data[key]) {
        if (!db[key].some((existing) => existing.id === row.id)) db[key].push(row);
      }
    }
    if (data.settings) db.settings = { ...db.settings, ...data.settings };
  }
  for (const key of lists) {
    const counterKey = key.replace(/s$/, '').replace('categorie', 'category');
    const maxId = db[key].reduce((max, row) => Math.max(max, Number(row.id) || 0), 0);
    if (db.counters[counterKey] !== undefined) {
      db.counters[counterKey] = Math.max(db.counters[counterKey], maxId + 1);
    }
  }
  ensureAdmin();
  save();
}

app.post('/api/admin/backup/import', requireAdmin, wrap((req, res) => {
  const b = req.body || {};
  try {
    applySnapshot(b.snapshot || b, str(b.mode) || 'replace');
  } catch (err) {
    return fail(res, 400, err.message);
  }
  return res.json({ ok: true, counts: { products: db.products.length, orders: db.orders.length } });
}));

app.post('/api/admin/backup/restore', requireAdmin, wrap((req, res) => {
  const name = path.basename(str(req.body && req.body.name));
  const file = path.join(BACKUP_DIR, name);
  if (!name || !fs.existsSync(file)) return fail(res, 404, 'Backup not found');
  try {
    applySnapshot(JSON.parse(fs.readFileSync(file, 'utf8')), str(req.body.mode) || 'replace');
  } catch (err) {
    return fail(res, 400, err.message);
  }
  return res.json({ ok: true, name });
}));

// The desktop build handles these natively; the server build cannot open folders.
app.post('/api/admin/backup/pick-folder', requireAdmin, (req, res) =>
  res.json({ supported: false, folder: BACKUP_DIR, message: 'Folder picking needs the desktop app.' }),
);
app.post('/api/admin/backup/open-folder', requireAdmin, (req, res) =>
  res.json({ supported: false, folder: BACKUP_DIR, message: 'Folder opening needs the desktop app.' }),
);

let autoBackupTimer = null;
function restartAutoBackup() {
  if (autoBackupTimer) clearInterval(autoBackupTimer);
  const cfg = backupConfig();
  if (!cfg.autoEnabled) return;
  const ms = Math.max(1, Number(cfg.intervalMinutes) || 60) * 60 * 1000;
  autoBackupTimer = setInterval(() => {
    writeBackup('auto');
    save();
  }, ms);
  autoBackupTimer.unref?.();
}

/* ------------------------------------------------------- static assets ---- */

app.use(
  '/uploads',
  express.static(UPLOAD_DIR, { maxAge: '30d', fallthrough: true, index: false }),
);

app.all(/^\/api\//, (req, res) => fail(res, 404, `Unknown endpoint ${req.method} ${req.path}`));

if (fs.existsSync(WEB_DIR)) {
  // The shop pages ask this file where the API lives. When this server serves
  // the pages the API is on the very same address, so the base stays empty —
  // the copy of config.js on disk (which points at the online shop) is only
  // used by static hosts such as GitHub Pages and Vercel.
  app.get('/config.js', (req, res) => {
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(`window.__VW_API__ = ${JSON.stringify(process.env.PUBLIC_API_BASE || '')};\n`);
  });

  app.use(express.static(WEB_DIR, { index: false, maxAge: '1h' }));

  // Plain HTML pages built by web/build-seo.mjs, one per product and category.
  // They live in their own folders, so a directory request has to be mapped to
  // the index.html inside it before the single-page fallback below takes over.
  app.get(/^\/(p|c)\/([A-Za-z0-9._-]+)\/?$/, (req, res, next) => {
    const page = path.join(WEB_DIR, req.params[0], req.params[1], 'index.html');
    if (!page.startsWith(WEB_DIR) || !fs.existsSync(page)) return next();
    return res.sendFile(page);
  });

  for (const file of ['sitemap.xml', 'robots.txt']) {
    app.get(`/${file}`, (req, res, next) => {
      const page = path.join(WEB_DIR, file);
      if (!fs.existsSync(page)) return next();
      return res.sendFile(page);
    });
  }

  app.get('/app', (req, res, next) => {
    const page = path.join(WEB_DIR, 'app.html');
    if (!fs.existsSync(page)) return next();
    return res.sendFile(page);
  });

  app.get(/.*/, (req, res, next) => {
    if (req.method !== 'GET') return next();
    const index = path.join(WEB_DIR, 'index.html');
    if (!fs.existsSync(index)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(index);
  });
  console.log(`[web] serving frontend from ${WEB_DIR}`);
} else {
  console.log(`[web] no frontend at ${WEB_DIR} — running API only`);
}

/* -------------------------------------------------------- error handler --- */

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (err instanceof multer.MulterError) {
    return fail(res, 400, err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large.' : err.message);
  }
  console.error('[error]', err.message);
  return fail(res, status, err.message || 'Something went wrong');
});

/* ---------------------------------------------------------------- boot ---- */

loadDb();
if (!fs.existsSync(STORE_FILE)) save();
restartAutoBackup();

const server = app.listen(PORT, HOST, () => {
  console.log(`VAPE WORLD server listening on http://${HOST}:${PORT}`);
  console.log(`  data:    ${DATA_DIR}`);
  console.log(`  uploads: ${UPLOAD_DIR}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

module.exports = { app, server };
