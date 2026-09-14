# VAPE WORLD

Premium vapes, pod kits, e-liquids and accessories — online shop for Pakistan, plus an Android app and a Windows desktop app built from the same code.

| Piece | What it is |
| --- | --- |
| `web/` | The shop website (React build). Pure static files — hosts anywhere. |
| `server/` | The shop server: products, orders, customers, messages, settings, vendor panel API. Node + Express, data in a JSON file, no database to install. |
| `android/` | Android app (`VAPE WORLD.apk`) — the shop in a native shell, built without Gradle. |
| `desktop/` | Windows / Linux / macOS desktop app (Electron) that carries its own copy of the shop server. |

## Live

- Website: https://vape-world.vercel.app
- Backup website: https://vapeworlds1.pplx.app
- Shop API: https://vapeworlds1.pplx.app/port/9000/api

## Vendor panel

Sign in at `/#/signin` with the shop owner account, then the panel is at `/#/admin`.

On a fresh install the shop creates the vendor account `admin@vapeworld.pk` with a **random** password and writes it to `ADMIN-LOGIN.txt` inside the data folder (the desktop app shows it under Shop → Vendor login). Change it from the panel's "Login details" tab, then delete that file. To pick your own from the start, set `ADMIN_EMAIL` / `ADMIN_PASSWORD` before the first run.

## Run the whole shop on one machine

```bash
cd server
npm install
node index.js          # http://localhost:9000
```

The server serves the website *and* the API from the same address, so nothing else is needed. Environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `9000` | Port to listen on |
| `DATA_DIR` | `server/data` | Where `store.json`, uploads and backups live |
| `WEB_DIR` | `../web` | Folder with the website files |
| `PUBLIC_API_BASE` | empty | Leave empty when one server does both jobs |

## Host it free

**Frontend on Vercel or GitHub Pages** — both serve `web/` as static files. `web/config.js` holds the address of the shop API; point it at wherever the server runs:

```js
window.__VW_API__ = "https://your-api-host.example/api-base";
```

**Server on a free Node host** (Render, Railway, Fly.io, or any VPS): deploy this repo, start command `node server/index.js`, and set `DATA_DIR` to a persistent disk so orders survive restarts.

## Build the Android app

```bash
cd android
ANDROID_SDK_ROOT=$HOME/android-sdk JAVA_HOME=$HOME/jdk17 ./build-apk.sh
# -> android/build/VAPE-WORLD.apk
```

Needs Android SDK build-tools 35 + platform 35 and a JDK 17. The site address the app opens is the `SITE_URL` constant in `android/java/pk/vapeworld/shop/MainActivity.java`. The signing key is created on first build as `android/vapeworld.keystore` — keep it safe; Play Store updates must be signed with the same key.

## Build the desktop app

```bash
cd desktop
npm install
npm run dist:win      # -> desktop/dist/VAPE-WORLD-Setup-1.0.0.exe + portable .exe
```

The desktop app starts the bundled shop server on a local port and opens the shop in its own window, so it works with no internet. The **Shop** menu switches between this PC's copy and the live website.

## API

Full endpoint reference, auth headers and data shapes: [`server/API-NOTES.md`](server/API-NOTES.md).
