#!/usr/bin/env node
/**
 * Builds the crawlable part of VAPE WORLD.
 *
 * The shop itself is a single-page app behind hash routes (#/shop, #/product/x),
 * which Google cannot reliably index. This script reads the live shop API and
 * writes one plain HTML page per product and per category, plus sitemap.xml and
 * robots.txt, and injects social / structured-data tags into the pages that
 * already exist. Every generated page links straight into the app.
 *
 * Usage:
 *   node build-seo.mjs                                  # live API, default site
 *   API=http://localhost:9000 SITE=https://example.com node build-seo.mjs
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const WEB = path.dirname(new URL(import.meta.url).pathname);
const API = (process.env.API || 'https://vapeworlds1.pplx.app/port/9000').replace(/\/+$/, '');
const SITE = (process.env.SITE || 'https://vapeworld-store.vercel.app').replace(/\/+$/, '');
const TODAY = new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------- fetching ---- */

async function api(pathname) {
  const res = await fetch(`${API}/api/${pathname}`);
  if (!res.ok) throw new Error(`GET /api/${pathname} -> ${res.status}`);
  return res.json();
}

const asList = (value) =>
  Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [];

/* -------------------------------------------------------------- helpers ---- */

const esc = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const clip = (text = '', max = 155) => {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).replace(/[\s,;:.-]+\S*$/, '')}…`;
};

const money = (amount) => `Rs ${Number(amount || 0).toLocaleString('en-PK')}`;

const priceOf = (p) => Number(p.salePrice || p.price || 0);

const abs = (url) => {
  if (!url) return `${SITE}/hero.jpg`;
  if (/^https?:\/\//.test(url)) return url;
  return `${SITE}/${String(url).replace(/^\/+/, '')}`;
};

/* ----------------------------------------------------------- page shell ---- */

const CSS = `
:root{--ink:#0e1a20;--paper:#f6f8f7;--card:#fff;--line:#dde5e3;--muted:#5d7078;--accent:#12b886;--accent-ink:#03251b}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:400 16px/1.65 "DM Sans",system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
a{color:#0b7a5b}
img{max-width:100%;display:block}
.wrap{max-width:1000px;margin:0 auto;padding:0 24px}
header{background:var(--ink);color:#eaf3f0}
header .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:64px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;font-size:13px;color:#eaf3f0;text-decoration:none}
.dot{width:10px;height:10px;border-radius:50%;background:var(--accent)}
nav.top{display:flex;gap:18px;font-size:14px}
nav.top a{color:#b9cfc9;text-decoration:none}
nav.top a:hover{color:#fff}
.crumbs{font-size:13.5px;color:var(--muted);padding:22px 0 0}
.crumbs a{color:var(--muted)}
h1{font-family:"Space Grotesk","DM Sans",sans-serif;font-size:clamp(26px,4.2vw,38px);line-height:1.15;margin:14px 0 6px;letter-spacing:-.01em}
h2{font-family:"Space Grotesk","DM Sans",sans-serif;font-size:20px;margin:44px 0 16px}
.lede{color:var(--muted);margin:0 0 26px;max-width:60ch}
.detail{display:grid;grid-template-columns:minmax(0,440px) minmax(0,1fr);gap:34px;align-items:start;padding-bottom:8px}
@media(max-width:760px){.detail{grid-template-columns:1fr;gap:22px}}
.shot{background:var(--card);border:1px solid var(--line);border-radius:18px;overflow:hidden}
.shot img{width:100%;aspect-ratio:1/1;object-fit:cover}
.price{display:flex;align-items:baseline;gap:12px;margin:0 0 6px}
.price strong{font-family:"Space Grotesk","DM Sans",sans-serif;font-size:30px}
.price s{color:var(--muted)}
.tag{display:inline-block;background:#e6f7f1;color:#06614a;border-radius:999px;padding:3px 11px;font-size:12.5px;font-weight:600}
.tag.out{background:#fdeaea;color:#8f2020}
.btn{display:inline-block;background:var(--accent);color:var(--accent-ink);font-weight:700;text-decoration:none;padding:13px 24px;border-radius:999px}
.btn:hover{background:#0fa678}
.btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
.btn.ghost:hover{border-color:var(--ink)}
.row{display:flex;flex-wrap:wrap;gap:10px;margin:22px 0 6px}
dl.specs{display:grid;grid-template-columns:auto 1fr;gap:8px 18px;margin:26px 0 0;font-size:15px;border-top:1px solid var(--line);padding-top:20px}
dl.specs dt{color:var(--muted)}
dl.specs dd{margin:0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden;display:flex;flex-direction:column}
.card .body{padding:14px 16px 18px;display:flex;flex-direction:column;gap:4px;flex:1}
.card .kicker{font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.card h3{margin:0;font-size:16px;line-height:1.35}
.card h3 a{color:inherit;text-decoration:none}
.card h3 a:hover{text-decoration:underline}
.card .p{margin-top:auto;font-weight:700;padding-top:8px}
footer{margin-top:60px;background:var(--ink);color:#b9cfc9;font-size:14px}
footer .wrap{display:flex;flex-wrap:wrap;gap:26px;justify-content:space-between;padding-top:34px;padding-bottom:40px}
footer a{color:#eaf3f0}
footer .age{border:1px solid #2c4148;border-radius:999px;padding:4px 12px;font-size:12.5px}
`;

function shell({ title, description, canonical, image, jsonld, body, extraHead = '' }) {
  const blocks = (Array.isArray(jsonld) ? jsonld : [jsonld]).filter(Boolean);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${esc(canonical)}" />
<meta name="robots" content="index, follow, max-image-preview:large" />
<meta name="rating" content="adult" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="VAPE WORLD" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(canonical)}" />
<meta property="og:image" content="${esc(image)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${esc(image)}" />
<link rel="icon" type="image/png" href="${SITE}/favicon-32.png" />
<meta name="theme-color" content="#0E1A20" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400..700&family=Space+Grotesk:wght@500..700&display=swap" rel="stylesheet" />
${extraHead}<style>${CSS}</style>
${blocks.map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`).join('\n')}
</head>
<body>
<header>
  <div class="wrap">
    <a class="brand" href="${SITE}/"><span class="dot"></span> Vape World</a>
    <nav class="top">
      <a href="${SITE}/#/">Home</a>
      <a href="${SITE}/#/shop">Shop</a>
      <a href="${SITE}/#/track">Track order</a>
      <a href="${SITE}/#/contact">Contact</a>
      <a href="${SITE}/app">Get the app</a>
    </nav>
  </div>
</header>
${body}
<footer>
  <div class="wrap">
    <div>
      <strong style="color:#eaf3f0">VAPE WORLD</strong><br />
      Premium vapes, delivered across Pakistan.<br />
      <a href="https://wa.me/923710975847">WhatsApp +92 371 0975847</a>
    </div>
    <div>
      <a href="${SITE}/#/shop">Shop</a> · <a href="${SITE}/#/track">Track order</a> ·
      <a href="${SITE}/app">Android &amp; Windows apps</a><br />
      <span class="age">18+ only</span>
    </div>
  </div>
</footer>
</body>
</html>
`;
}

/* ---------------------------------------------------------------- pages ---- */

function productCard(p) {
  return `<article class="card">
  <div class="shot" style="border:0;border-radius:0"><img src="${esc(abs(p.image))}" alt="${esc(p.name)}" width="420" height="420" loading="lazy" /></div>
  <div class="body">
    <span class="kicker">${esc(p.brand || p.category || 'Vape World')}</span>
    <h3><a href="${SITE}/p/${esc(p.slug)}/">${esc(p.name)}</a></h3>
    <span class="p">${money(priceOf(p))}</span>
  </div>
</article>`;
}

function productPage(p, siblings) {
  const price = priceOf(p);
  const inStock = Number(p.stock || 0) > 0;
  const title =
    p.seoTitle || `${p.name} price in Pakistan — ${money(price)} | VAPE WORLD`;
  const description =
    p.seoDescription ||
    clip(
      `${p.name}${p.brand ? ` by ${p.brand}` : ''} for ${money(price)}. ${
        p.description || ''
      } Delivered across Pakistan, EasyPaisa or bank transfer.`,
    );
  const canonical = `${SITE}/p/${p.slug}/`;
  const specs = [
    ['Brand', p.brand],
    ['Category', p.category],
    ['Flavour', p.flavour],
    ['Nicotine', p.nicotine],
    ['Puffs', p.puffs],
    ['SKU', p.sku],
    ['Availability', inStock ? `In stock (${p.stock})` : 'Out of stock'],
    ['Delivery', 'Nationwide, 2–4 days. Free over Rs 5,000'],
  ].filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '');

  const body = `<main class="wrap">
<p class="crumbs"><a href="${SITE}/">Home</a> › <a href="${SITE}/#/shop">Shop</a> › ${
    p.category ? `<a href="${SITE}/c/${esc(slugOfCategory(p.category))}/">${esc(p.category)}</a> › ` : ''
  }${esc(p.name)}</p>
<div class="detail">
  <div class="shot"><img src="${esc(abs(p.image))}" alt="${esc(p.name)}" width="880" height="880" /></div>
  <div>
    <h1>${esc(p.name)}</h1>
    <p class="price"><strong>${money(price)}</strong>${
      p.salePrice && p.price > p.salePrice ? `<s>${money(p.price)}</s>` : ''
    }</p>
    <p><span class="tag${inStock ? '' : ' out'}">${inStock ? 'In stock' : 'Out of stock'}</span></p>
    <p class="lede">${esc(p.description || '')}</p>
    <div class="row">
      <a class="btn" href="${SITE}/#/product/${esc(p.slug)}">Buy on VAPE WORLD</a>
      <a class="btn ghost" href="https://wa.me/923710975847?text=${encodeURIComponent(
        `Salam, I want to order: ${p.name}`,
      )}">Order on WhatsApp</a>
    </div>
    <dl class="specs">${specs
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
      .join('')}</dl>
  </div>
</div>
${
  siblings.length
    ? `<h2>More from ${esc(p.category || 'the shop')}</h2><div class="grid">${siblings
        .map(productCard)
        .join('')}</div>`
    : ''
}
</main>`;

  const jsonld = [
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.name,
      description: clip(p.description || description, 400),
      image: [abs(p.image)],
      sku: p.sku || undefined,
      brand: p.brand ? { '@type': 'Brand', name: p.brand } : undefined,
      category: p.category || undefined,
      url: canonical,
      offers: {
        '@type': 'Offer',
        price: price,
        priceCurrency: 'PKR',
        availability: inStock
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
        url: canonical,
        itemCondition: 'https://schema.org/NewCondition',
        seller: { '@type': 'Organization', name: 'VAPE WORLD' },
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Shop', item: `${SITE}/#/shop` },
        ...(p.category
          ? [
              {
                '@type': 'ListItem',
                position: 3,
                name: p.category,
                item: `${SITE}/c/${slugOfCategory(p.category)}/`,
              },
            ]
          : []),
        {
          '@type': 'ListItem',
          position: p.category ? 4 : 3,
          name: p.name,
          item: canonical,
        },
      ],
    },
  ];

  return shell({ title, description, canonical, image: abs(p.image), jsonld, body });
}

function categoryPage(cat, items) {
  const canonical = `${SITE}/c/${cat.slug}/`;
  const cheapest = items.length ? Math.min(...items.map(priceOf)) : 0;
  const title = `${cat.name} in Pakistan — prices from ${money(cheapest)} | VAPE WORLD`;
  const description = clip(
    `${items.length} ${cat.name.toLowerCase()} in stock at VAPE WORLD, from ${money(
      cheapest,
    )}. Nationwide delivery, EasyPaisa or bank transfer, free over Rs 5,000.`,
  );

  const body = `<main class="wrap">
<p class="crumbs"><a href="${SITE}/">Home</a> › <a href="${SITE}/#/shop">Shop</a> › ${esc(cat.name)}</p>
<h1>${esc(cat.name)} in Pakistan</h1>
<p class="lede">${esc(
    `${items.length} product${items.length === 1 ? '' : 's'} in stock, delivered anywhere in Pakistan in 2–4 days. Prices include all taxes.`,
  )}</p>
<div class="row"><a class="btn" href="${SITE}/#/shop">Open the full shop</a></div>
<h2>All ${esc(cat.name.toLowerCase())}</h2>
<div class="grid">${items.map(productCard).join('')}</div>
</main>`;

  const jsonld = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: `${cat.name} — VAPE WORLD`,
      description,
      url: canonical,
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: items.length,
        itemListElement: items.map((p, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: `${SITE}/p/${p.slug}/`,
          name: p.name,
        })),
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Shop', item: `${SITE}/#/shop` },
        { '@type': 'ListItem', position: 3, name: cat.name, item: canonical },
      ],
    },
  ];

  return shell({ title, description, canonical, image: abs(cat.image), jsonld, body });
}

let CATEGORY_SLUGS = new Map();
const slugOfCategory = (name) =>
  CATEGORY_SLUGS.get(String(name).toLowerCase()) ||
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/* ------------------------------------------------- head injection (SPA) ---- */

async function injectHead(file, tags) {
  const target = path.join(WEB, file);
  let html = await fs.readFile(target, 'utf8');
  html = html.replace(
    /\n?<!-- seo:start -->[\s\S]*?<!-- seo:end -->\n?/,
    '\n',
  );
  html = html.replace('</head>', `${tags}</head>`);
  await fs.writeFile(target, html);
}

/* ----------------------------------------------------------------- main ---- */

const [productsRaw, categoriesRaw, settings] = await Promise.all([
  api('products'),
  api('categories'),
  api('settings').catch(() => ({})),
]);

// Placeholder rows the shop owner used while testing should not reach Google.
const isJunk = (p) =>
  /^test\b/i.test(String(p.slug)) ||
  /^test\b/i.test(String(p.name)) ||
  priceOf(p) < 50;
const products = asList(productsRaw).filter(
  (p) => p.active !== false && p.slug && !isJunk(p),
);
const categories = asList(categoriesRaw).filter((c) => c.slug);
CATEGORY_SLUGS = new Map(categories.map((c) => [c.name.toLowerCase(), c.slug]));

await fs.rm(path.join(WEB, 'p'), { recursive: true, force: true });
await fs.rm(path.join(WEB, 'c'), { recursive: true, force: true });

for (const p of products) {
  const siblings = products
    .filter((o) => o.slug !== p.slug && o.category === p.category)
    .slice(0, 4);
  const dir = path.join(WEB, 'p', p.slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'index.html'), productPage(p, siblings));
}

for (const cat of categories) {
  const items = products.filter(
    (p) => p.categoryId === cat.id || p.category === cat.name,
  );
  if (!items.length) continue;
  const dir = path.join(WEB, 'c', cat.slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'index.html'), categoryPage(cat, items));
}

/* --- structured data + social tags on the app's own entry pages --- */

const storeJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Store',
  name: settings.storeName || 'VAPE WORLD',
  description:
    settings.aboutText ||
    'Premium disposable vapes, pod kits, e-liquids and accessories delivered across Pakistan.',
  url: `${SITE}/`,
  image: `${SITE}/hero.jpg`,
  logo: `${SITE}/icons/icon-512.png`,
  email: settings.contactEmail || undefined,
  telephone: settings.contactPhone || undefined,
  priceRange: 'Rs 500 – Rs 12,000',
  currenciesAccepted: 'PKR',
  paymentAccepted: 'EasyPaisa, Bank transfer',
  areaServed: { '@type': 'Country', name: 'Pakistan' },
  address: {
    '@type': 'PostalAddress',
    addressCountry: 'PK',
    addressRegion: 'Khyber Pakhtunkhwa',
    addressLocality: 'Peshawar',
  },
  sameAs: [settings.whatsappLink].filter(Boolean),
};

const websiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: settings.storeName || 'VAPE WORLD',
  url: `${SITE}/`,
  inLanguage: 'en-PK',
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: `${SITE}/#/shop?q={search_term_string}`,
    },
    'query-input': 'required name=search_term_string',
  },
};

const homeTitle = settings.seoTitle || 'VAPE WORLD — Premium Vapes in Pakistan';
const homeDesc =
  settings.seoDescription ||
  'Disposable vapes, pod kits, e-liquids and accessories delivered across Pakistan. EasyPaisa and bank transfer accepted. 18+ only.';

const verify = [
  settings.googleVerification
    ? `<meta name="google-site-verification" content="${esc(settings.googleVerification)}" />`
    : '',
  settings.bingVerification
    ? `<meta name="msvalidate.01" content="${esc(settings.bingVerification)}" />`
    : '',
].filter(Boolean);

const homeTags = `<!-- seo:start -->
<link rel="canonical" href="${SITE}/" />
<meta name="robots" content="index, follow, max-image-preview:large" />
<meta name="rating" content="adult" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="VAPE WORLD" />
<meta property="og:title" content="${esc(homeTitle)}" />
<meta property="og:description" content="${esc(homeDesc)}" />
<meta property="og:url" content="${SITE}/" />
<meta property="og:image" content="${SITE}/hero.jpg" />
<meta property="og:locale" content="en_PK" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(homeTitle)}" />
<meta name="twitter:description" content="${esc(homeDesc)}" />
<meta name="twitter:image" content="${SITE}/hero.jpg" />
${verify.join('\n')}
<script type="application/ld+json">${JSON.stringify(storeJsonLd)}</script>
<script type="application/ld+json">${JSON.stringify(websiteJsonLd)}</script>
<!-- seo:end -->
`;

await injectHead('index.html', homeTags);

const appTags = `<!-- seo:start -->
<link rel="canonical" href="${SITE}/app" />
<meta name="robots" content="index, follow" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="VAPE WORLD" />
<meta property="og:title" content="Get the VAPE WORLD app — Android and Windows" />
<meta property="og:description" content="Download the VAPE WORLD shop for Android, or the desktop app for Windows." />
<meta property="og:url" content="${SITE}/app" />
<meta property="og:image" content="${SITE}/hero.jpg" />
<meta name="twitter:card" content="summary_large_image" />
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'VAPE WORLD',
  operatingSystem: 'Android 5.0+, Windows 10/11',
  applicationCategory: 'ShoppingApplication',
  url: `${SITE}/app`,
  downloadUrl: `${SITE}/downloads/VAPE-WORLD-1.0.0.apk`,
  softwareVersion: '1.0.0',
  offers: { '@type': 'Offer', price: 0, priceCurrency: 'PKR' },
  publisher: { '@type': 'Organization', name: 'VAPE WORLD' },
})}</script>
<!-- seo:end -->
`;

await injectHead('app.html', appTags);

/* --------------------------------------------------- sitemap and robots ---- */

const urls = [
  { loc: `${SITE}/`, priority: '1.0', changefreq: 'daily' },
  { loc: `${SITE}/app`, priority: '0.6', changefreq: 'monthly' },
  ...categories
    .filter((c) => products.some((p) => p.categoryId === c.id || p.category === c.name))
    .map((c) => ({ loc: `${SITE}/c/${c.slug}/`, priority: '0.8', changefreq: 'weekly' })),
  ...products.map((p) => ({
    loc: `${SITE}/p/${p.slug}/`,
    priority: '0.7',
    changefreq: 'weekly',
  })),
];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${TODAY}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`,
  )
  .join('\n')}
</urlset>
`;
await fs.writeFile(path.join(WEB, 'sitemap.xml'), sitemap);

const robots = `# VAPE WORLD — https://github.com/akimsaaaonline-cmd/VAPE-WORLD
User-agent: *
Allow: /
Disallow: /downloads/

Sitemap: ${SITE}/sitemap.xml
`;
await fs.writeFile(path.join(WEB, 'robots.txt'), robots);

/* --------------------------------------------------------- IndexNow ping ---- */
// Bing, Yandex, Naver and Seznam accept instant URL submissions through
// IndexNow; no account needed, just the key file served from the site root.
const INDEXNOW_KEY = process.env.INDEXNOW_KEY || 'ba6c6b367c00ca37faf83090fddb23b9';
if (INDEXNOW_KEY && !process.env.SKIP_PING) {
  try {
    const res = await fetch('https://api.indexnow.org/IndexNow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: new URL(SITE).host,
        key: INDEXNOW_KEY,
        keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`,
        urlList: urls.map((u) => u.loc),
      }),
    });
    console.log(`IndexNow (Bing/Yandex): ${res.status} ${res.statusText}`);
  } catch (e) {
    console.log(`IndexNow ping failed: ${e.message}`);
  }
}

console.log(
  `SEO build: ${products.length} product pages, ${
    urls.length - 2 - products.length
  } category pages, sitemap with ${urls.length} URLs -> ${SITE}`,
);
