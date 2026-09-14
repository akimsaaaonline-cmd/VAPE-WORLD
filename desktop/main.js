/**
 * VAPE WORLD — desktop app (Windows / Linux / macOS).
 *
 * The app carries the whole shop with it: the same website and the same shop
 * server that runs online. On start it launches that server on a local port and
 * opens the shop in a normal desktop window, so the PC copy keeps working with
 * no internet. The menu can switch to the online shop whenever the owner wants
 * to see live orders from the website.
 */
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

const LOCAL_PORT = 9017;
const LOCAL_URL = `http://127.0.0.1:${LOCAL_PORT}/`;
const ONLINE_URL = 'https://vapeworlds1.pplx.app/#/';

let mainWindow = null;
let serverProcess = null;

function resourceDir(name) {
  return app.isPackaged
    ? path.join(process.resourcesPath, name)
    : path.join(__dirname, '..', name);
}

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) resolve(false);
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

function startShopServer() {
  const serverEntry = path.join(resourceDir('server'), 'index.js');
  if (!fs.existsSync(serverEntry)) return;

  const dataDir = path.join(app.getPath('userData'), 'shop-data');
  fs.mkdirSync(dataDir, { recursive: true });

  serverProcess = fork(serverEntry, [], {
    cwd: path.dirname(serverEntry),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(LOCAL_PORT),
      DATA_DIR: dataDir,
      WEB_DIR: resourceDir('web'),
    },
    execPath: process.execPath,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  const logFile = path.join(app.getPath('userData'), 'shop-server.log');
  const write = (chunk) => {
    try {
      fs.appendFileSync(logFile, chunk);
    } catch (_) {}
  };
  if (serverProcess.stdout) serverProcess.stdout.on('data', write);
  if (serverProcess.stderr) serverProcess.stderr.on('data', write);
}

function buildMenu() {
  const template = [
    {
      label: 'Shop',
      submenu: [
        {
          label: 'This PC (offline copy)',
          click: () => mainWindow && mainWindow.loadURL(LOCAL_URL),
        },
        {
          label: 'Online shop (website)',
          click: () => mainWindow && mainWindow.loadURL(ONLINE_URL),
        },
        { type: 'separator' },
        {
          label: 'Open shop data folder',
          click: () => shell.openPath(path.join(app.getPath('userData'), 'shop-data')),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About VAPE WORLD',
          click: () =>
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'VAPE WORLD',
              message: `VAPE WORLD ${app.getVersion()}`,
              detail:
                'Premium vapes, pod kits and e-liquids.\n\n' +
                'This app runs the shop on your own PC and can also open the live website.',
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0E1A20',
    title: 'VAPE WORLD',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  mainWindow.setMenuBarVisibility(true);

  // Links to other sites (WhatsApp, maps, e-mail) open in the real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const stay =
      url.startsWith(LOCAL_URL) ||
      url.startsWith('http://127.0.0.1:' + LOCAL_PORT) ||
      url.startsWith(ONLINE_URL.split('#')[0]);
    if (!stay) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  const ready = await waitForPort(LOCAL_PORT, 15000);
  await mainWindow.loadURL(ready ? LOCAL_URL : ONLINE_URL);
}

app.whenReady().then(() => {
  startShopServer();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
});
