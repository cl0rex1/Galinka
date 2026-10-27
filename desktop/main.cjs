const { app, BrowserWindow, ipcMain, shell, Menu, protocol, net } = require('electron');
const { readFile, stat } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const APP_URL = 'https://mess.quiby.me/app';
const RELEASES = 'https://github.com/cl0rex1/Galinka/releases/latest';
let window,
  state = { phase: 'idle', version: app.getVersion() },
  busy = false;
async function serveBundledApp() {
  const root = path.resolve(
    __dirname,
    '..',
    existsSync(path.join(__dirname, '..', 'web')) ? 'web' : 'dist',
  );
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.webmanifest': 'application/manifest+json',
  };
  protocol.handle('https', async (request) => {
    const url = new URL(request.url);
    if (
      url.origin !== new URL(APP_URL).origin ||
      url.pathname === '/messenger' ||
      url.pathname.startsWith('/messenger/')
    )
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    try {
      let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      if (file !== root && !file.startsWith(root + path.sep))
        return new Response('', { status: 403 });
      if (
        url.pathname === '/' ||
        url.pathname === '/app' ||
        !(await stat(file).catch(() => null))?.isFile()
      )
        file = path.join(root, 'index.html');
      return new Response(await readFile(file), {
        headers: {
          'Content-Type': types[path.extname(file)] || 'application/octet-stream',
          'Content-Security-Policy':
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        },
      });
    } catch {
      return new Response('Galinka could not load. Please reinstall.', { status: 500 });
    }
  });
}
const send = (next) => {
  state = { ...state, ...next };
  window?.webContents.send('updates:status', state);
};
function trusted(event) {
  if (
    event.sender !== window?.webContents ||
    new URL(event.senderFrame.url).origin !== new URL(APP_URL).origin
  )
    throw Error('Untrusted caller');
}
const external = (url) => {
  try {
    const u = new URL(url);
    if (
      u.protocol === 'https:' &&
      [
        'mess.quiby.me',
        'api.quiby.me',
        'github.com',
        'objects.githubusercontent.com',
        'release-assets.githubusercontent.com',
      ].includes(u.hostname)
    )
      return shell.openExternal(url);
  } catch {}
  return Promise.resolve();
};
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.on('checking-for-update', () => send({ phase: 'checking', error: undefined }));
autoUpdater.on('update-available', (info) => send({ phase: 'available', version: info.version }));
autoUpdater.on('update-not-available', () => send({ phase: 'current', version: app.getVersion() }));
autoUpdater.on('download-progress', (p) =>
  send({ phase: 'downloading', percent: Math.round(p.percent) }),
);
autoUpdater.on('update-downloaded', (info) => send({ phase: 'downloaded', version: info.version }));
autoUpdater.on('error', () =>
  send({
    phase: 'error',
    error: 'Не удалось получить обновление. Попробуйте позже или откройте страницу загрузки.',
  }),
);
ipcMain.handle('updates:status', (event) => {
  trusted(event);
  return { ...state, installedVersion: app.getVersion(), platform: process.platform };
});
ipcMain.handle('updates:check', async (event) => {
  trusted(event);
  if (busy) return state;
  if (!app.isPackaged) return { phase: 'current', version: app.getVersion() };
  busy = true;
  try {
    await autoUpdater.checkForUpdates();
  } catch {
  } finally {
    busy = false;
  }
  return state;
});
ipcMain.handle('updates:download', async (event) => {
  trusted(event);
  if (busy || state.phase !== 'available') return state;
  busy = true;
  try {
    await autoUpdater.downloadUpdate();
  } catch {
  } finally {
    busy = false;
  }
  return state;
});
ipcMain.handle('updates:install', (event) => {
  trusted(event);
  if (state.phase === 'downloaded') setImmediate(() => autoUpdater.quitAndInstall());
});
ipcMain.handle('updates:releases', (event) => {
  trusted(event);
  return external(RELEASES);
});
function createWindow() {
  window = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Galinka',
    backgroundColor: '#111817',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void external(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== new URL(APP_URL).origin) {
      event.preventDefault();
      void external(url);
    }
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  window.webContents.on('did-fail-load', (_event, code) => {
    if (code === -3) return;
    window?.show();
  });
  window.once('ready-to-show', () => window.show());
  window.loadURL(APP_URL);
  window.on('closed', () => {
    window = null;
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.whenReady().then(async () => {
    await serveBundledApp();
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { label: 'Galinka', submenu: [{ role: 'about' }, { role: 'quit' }] },
        {
          label: 'Правка',
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
          label: 'Вид',
          submenu: [
            { role: 'reload' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { role: 'togglefullscreen' },
          ],
        },
      ]),
    );
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
