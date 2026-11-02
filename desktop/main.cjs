const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Menu,
  protocol,
  net,
  dialog,
  systemPreferences,
} = require('electron');
const { readFile, stat } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const APP_URL = 'https://mess.quiby.me/app';
const RELEASES = 'https://github.com/cl0rex1/Galinka/releases/latest';
const buildInfo = (() => {
  try {
    return require('./build-info.json');
  } catch {
    return {};
  }
})();
const signedMac = (() => {
  try {
    return require('./build-info.json').macSigned === true;
  } catch {
    return false;
  }
})();
const manualUpdates =
  (process.platform === 'darwin' && !signedMac) ||
  (process.platform === 'linux' && !process.env.APPIMAGE);
const updateMode = manualUpdates ? 'manual' : 'automatic';
let window,
  state = { phase: 'idle', version: app.getVersion(), mode: updateMode },
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
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
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
    // Message links open in the system browser; executable/local URL schemes stay blocked.
    if (['https:', 'http:'].includes(u.protocol) && !u.username && !u.password)
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
  if (!app.isPackaged) return { phase: 'current', version: app.getVersion(), mode: updateMode };
  busy = true;
  try {
    if (manualUpdates) {
      send({ phase: 'checking', error: undefined });
      const response = await net.fetch(
        'https://api.github.com/repos/cl0rex1/Galinka/releases/latest',
        {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Galinka' },
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) throw Error('Update check failed');
      const release = await response.json();
      const version = release.tag_name.replace(/^v/, '');
      const valid = /^\d+\.\d+\.\d+$/.test(version);
      const newer =
        valid && version.localeCompare(app.getVersion(), undefined, { numeric: true }) > 0;
      const suffix =
        process.platform === 'darwin'
          ? `-mac-${process.arch}.dmg`
          : buildInfo.packageFormat === 'arch'
            ? '.pkg.tar.zst'
            : '.deb';
      const file =
        release.assets.find((asset) => asset.name.endsWith(suffix)) ||
        (process.platform === 'linux'
          ? release.assets.find((asset) => asset.name.endsWith('.deb'))
          : undefined);
      send({
        phase: newer && file ? 'available' : 'current',
        version,
        url: file?.browser_download_url,
      });
    } else await autoUpdater.checkForUpdates();
  } catch {
    send({ phase: 'error', error: 'Не удалось проверить обновления. Попробуйте позже.' });
  } finally {
    busy = false;
  }
  return state;
});
ipcMain.handle('updates:download', async (event) => {
  trusted(event);
  if (busy || state.phase !== 'available') return state;
  if (manualUpdates) {
    await external(state.url || 'https://mess.quiby.me/#download');
    return state;
  }
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
  let microphoneAllowed = false;
  const trustedMediaFrame = (contents, url, isMainFrame) => {
    try {
      return (
        contents === window?.webContents &&
        isMainFrame === true &&
        new URL(url).origin === new URL(APP_URL).origin
      );
    } catch {
      return false;
    }
  };
  window.webContents.session.setPermissionCheckHandler(
    (contents, permission, origin, details) =>
      trustedMediaFrame(contents, origin, details.isMainFrame) &&
      (permission === 'clipboard-sanitized-write' ||
        (permission === 'media' && details.mediaType === 'audio' && microphoneAllowed)),
  );
  window.webContents.session.setPermissionRequestHandler(
    async (contents, permission, callback, details) => {
      if (
        permission === 'clipboard-sanitized-write' &&
        trustedMediaFrame(contents, details.requestingUrl, details.isMainFrame)
      ) {
        callback(true);
        return;
      }
      if (
        permission !== 'media' ||
        !trustedMediaFrame(contents, details.requestingUrl, details.isMainFrame) ||
        details.mediaTypes?.length !== 1 ||
        details.mediaTypes[0] !== 'audio'
      ) {
        callback(false);
        return;
      }
      try {
        if (!microphoneAllowed) {
          microphoneAllowed =
            process.platform === 'darwin'
              ? await systemPreferences.askForMediaAccess('microphone')
              : (
                  await dialog.showMessageBox(window, {
                    type: 'question',
                    title: 'Микрофон Galinka',
                    message: 'Разрешить запись голосовых сообщений?',
                    detail:
                      'Микрофон используется только во время записи, которую вы запускаете кнопкой в чате.',
                    buttons: ['Разрешить', 'Не сейчас'],
                    defaultId: 0,
                    cancelId: 1,
                  })
                ).response === 0;
        }
        callback(microphoneAllowed && !contents.isDestroyed());
      } catch {
        callback(false);
      }
    },
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
