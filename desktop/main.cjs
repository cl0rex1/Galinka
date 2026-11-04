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
  Notification,
  Tray,
  nativeImage,
} = require('electron');
const { readFile, stat } = require('node:fs/promises');
const { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } = require('node:fs');
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
const signedMac = buildInfo.macSigned === true;
const manualUpdates =
  (process.platform === 'darwin' && !signedMac) ||
  (process.platform === 'linux' && !process.env.APPIMAGE);
const updateMode = manualUpdates ? 'manual' : 'automatic';
let window, tray;
let quitting = false;
let checking = false;
let downloading = false;
let pendingNotificationChat = null;
let notificationReceiverReady = false;
let preferences = { autoDownload: true, notifications: false };
const notifications = new Map();
const iconPath = path.join(__dirname, '..', 'public', 'icon-512.png');
let state = {
  phase: 'idle',
  version: app.getVersion(),
  installedVersion: app.getVersion(),
  platform: process.platform,
  packageFormat: buildInfo.packageFormat || 'desktop',
  mode: updateMode,
  autoDownload: preferences.autoDownload,
};

function loadPreferences() {
  try {
    const saved = JSON.parse(
      readFileSync(path.join(app.getPath('userData'), 'preferences.json'), 'utf8'),
    );
    preferences = {
      autoDownload: typeof saved.autoDownload === 'boolean' ? saved.autoDownload : true,
      notifications: saved.notifications === true,
    };
  } catch {}
  state.autoDownload = preferences.autoDownload;
}
function savePreferences(next) {
  const directory = app.getPath('userData');
  const file = path.join(directory, 'preferences.json');
  const updated = { ...preferences, ...next };
  mkdirSync(directory, { recursive: true });
  writeFileSync(file + '.tmp', JSON.stringify(updated), { mode: 0o600 });
  renameSync(file + '.tmp', file);
  preferences = updated;
}
function showWindow() {
  if (!window || window.isDestroyed()) createWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
function ensureTray() {
  if (tray) return;
  try {
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 });
    if (icon.isEmpty()) return;
    tray = new Tray(icon);
    tray.setToolTip('Galinka');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Открыть Galinka', click: showWindow },
        { type: 'separator' },
        { label: 'Выйти из Galinka', click: () => app.quit() },
      ]),
    );
    tray.on('click', showWindow);
  } catch {
    tray = undefined;
  }
}
function notificationStatus() {
  return {
    supported: Notification.isSupported(),
    enabled: preferences.notifications,
    background: preferences.notifications && !!tray,
  };
}
function clearNotifications() {
  for (const notification of notifications.values()) notification.close();
  notifications.clear();
  pendingNotificationChat = null;
}
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
  if (window && !window.isDestroyed()) window.webContents.send('updates:status', state);
};
function trusted(event) {
  if (
    event.sender !== window?.webContents ||
    event.senderFrame !== window?.webContents.mainFrame ||
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
// Downloads can be automatic, but a restart always requires an explicit user action.
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.on('checking-for-update', () => send({ phase: 'checking', error: undefined }));
autoUpdater.on('update-available', (info) =>
  send({ phase: 'available', version: info.version, percent: undefined }),
);
autoUpdater.on('update-not-available', () => send({ phase: 'current', version: app.getVersion() }));
autoUpdater.on('download-progress', (p) =>
  send({
    phase: 'downloading',
    percent: Math.min(100, Math.max(0, Math.round(p.percent))),
    transferred: p.transferred,
    total: p.total,
    bytesPerSecond: p.bytesPerSecond,
  }),
);
autoUpdater.on('update-downloaded', (info) =>
  send({ phase: 'downloaded', version: info.version, percent: 100, error: undefined }),
);
autoUpdater.on('error', () =>
  send({
    phase: 'error',
    error: 'Не удалось получить обновление. Попробуйте позже или откройте страницу загрузки.',
  }),
);
ipcMain.handle('updates:status', (event) => {
  trusted(event);
  return state;
});
async function downloadUpdate() {
  if (downloading || manualUpdates || state.phase !== 'available') return state;
  downloading = true;
  send({ phase: 'downloading', percent: 0, error: undefined });
  try {
    await autoUpdater.downloadUpdate();
  } catch {
    send({
      phase: 'error',
      error: 'Загрузка прервалась. Проверьте соединение и попробуйте ещё раз.',
    });
  } finally {
    downloading = false;
  }
  return state;
}
async function checkUpdates() {
  if (checking || downloading || state.phase === 'downloaded') return state;
  if (!app.isPackaged) return { ...state, phase: 'current' };
  checking = true;
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
      const version = String(release.tag_name || '').replace(/^v/, '');
      const valid = /^\d+\.\d+\.\d+$/.test(version);
      const newer =
        valid && version.localeCompare(app.getVersion(), undefined, { numeric: true }) > 0;
      const suffix =
        process.platform === 'darwin'
          ? `-mac-${process.arch}.dmg`
          : buildInfo.packageFormat === 'arch'
            ? '.pkg.tar.zst'
            : '.deb';
      const file = (Array.isArray(release.assets) ? release.assets : []).find(
        (asset) =>
          typeof asset.name === 'string' &&
          asset.name.endsWith(suffix) &&
          typeof asset.browser_download_url === 'string' &&
          asset.browser_download_url.startsWith(
            'https://github.com/cl0rex1/Galinka/releases/download/',
          ),
      );
      send({
        phase: newer && file ? 'available' : 'current',
        version,
        url: file?.browser_download_url,
      });
    } else await autoUpdater.checkForUpdates();
  } catch {
    send({ phase: 'error', error: 'Не удалось проверить обновления. Попробуйте позже.' });
  } finally {
    checking = false;
  }
  if (!manualUpdates && preferences.autoDownload && state.phase === 'available')
    void downloadUpdate();
  return state;
}
ipcMain.handle('updates:check', async (event) => {
  trusted(event);
  return checkUpdates();
});
ipcMain.handle('updates:download', async (event) => {
  trusted(event);
  if (checking || downloading || state.phase !== 'available') return state;
  if (manualUpdates) {
    await external(state.url || 'https://mess.quiby.me/#download');
    return state;
  }
  return downloadUpdate();
});
ipcMain.handle('updates:install', (event) => {
  trusted(event);
  if (state.phase !== 'downloaded' || manualUpdates) return false;
  setImmediate(() => {
    // quitAndInstall closes windows before before-quit; bypass close-to-tray here.
    quitting = true;
    autoUpdater.quitAndInstall(false, true);
  });
  return true;
});
ipcMain.handle('updates:auto-download', (event, enabled) => {
  trusted(event);
  if (typeof enabled !== 'boolean') throw Error('Invalid preference');
  savePreferences({ autoDownload: enabled });
  send({ autoDownload: enabled });
  if (enabled && !manualUpdates) void downloadUpdate();
  return state;
});
ipcMain.handle('updates:releases', (event) => {
  trusted(event);
  return external(RELEASES);
});
ipcMain.handle('notifications:status', (event) => {
  trusted(event);
  return notificationStatus();
});
ipcMain.handle('notifications:enabled', (event, enabled) => {
  trusted(event);
  if (typeof enabled !== 'boolean') throw Error('Invalid preference');
  const wasEnabled = preferences.notifications;
  savePreferences({ notifications: enabled && Notification.isSupported() });
  if (preferences.notifications) {
    ensureTray();
    if (!wasEnabled) {
      // Showing the first native notification allows the OS to request authorization.
      // This preference never implies that system settings have granted it.
      const welcome = new Notification({
        title: 'Galinka',
        body: 'Здесь появятся новые сообщения',
        icon: iconPath,
        silent: true,
      });
      notifications.set('welcome', welcome);
      welcome.on('click', showWindow);
      welcome.on('close', () => notifications.delete('welcome'));
      welcome.on('failed', () => notifications.delete('welcome'));
      welcome.show();
    }
  } else {
    clearNotifications();
    tray?.destroy();
    tray = undefined;
    if (!window.isVisible()) showWindow();
  }
  return notificationStatus();
});
ipcMain.handle('notifications:clear', (event) => {
  trusted(event);
  savePreferences({ notifications: false });
  clearNotifications();
  tray?.destroy();
  tray = undefined;
  if (!window.isVisible()) showWindow();
});
ipcMain.handle('notifications:pending', (event) => {
  trusted(event);
  notificationReceiverReady = true;
  const chatId = pendingNotificationChat;
  pendingNotificationChat = null;
  return chatId;
});
ipcMain.handle('notifications:show', (event, options) => {
  trusted(event);
  if (
    !options ||
    typeof options.chatId !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(options.chatId)
  )
    throw Error('Invalid chat');
  if (
    !preferences.notifications ||
    !Notification.isSupported() ||
    (window.isVisible() && window.isFocused())
  )
    return false;
  const chatId = options.chatId;
  notifications.get(chatId)?.close();
  if (notifications.size >= 20) {
    const oldest = notifications.keys().next().value;
    notifications.get(oldest)?.close();
    notifications.delete(oldest);
  }
  const notification = new Notification({
    title: 'Galinka',
    body: 'Новое сообщение',
    icon: iconPath,
    silent: false,
  });
  notifications.set(chatId, notification);
  notification.on('click', () => {
    showWindow();
    if (notificationReceiverReady) window.webContents.send('notifications:open', chatId);
    else pendingNotificationChat = chatId;
  });
  const remove = () => {
    if (notifications.get(chatId) === notification) notifications.delete(chatId);
  };
  notification.on('close', remove);
  notification.on('failed', remove);
  notification.show();
  return true;
});
function createWindow() {
  window = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Galinka',
    backgroundColor: '#0c0c0d',
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
  window.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) notificationReceiverReady = false;
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
  window.on('close', (event) => {
    if (!quitting && preferences.notifications && tray) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on('closed', () => {
    window = null;
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('will-quit', clearNotifications);
  app.on('second-instance', showWindow);
  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('me.quiby.galinka');
    loadPreferences();
    if (preferences.notifications) ensureTray();
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
    app.on('activate', showWindow);
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
