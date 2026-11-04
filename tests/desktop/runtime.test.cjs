const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const origin = 'https://mess.quiby.me/app';
const chatId = '405f3fdd-c85a-4596-bab4-d123981e1a2f';
const nextTick = () => new Promise((resolve) => setImmediate(resolve));

// Execute the real main process against OS/updater boundaries: no notifications,
// installer or production network request is sent during these tests.
async function launch(options = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'galinka-desktop-test-'));
  if (options.preferences)
    writeFileSync(path.join(directory, 'preferences.json'), JSON.stringify(options.preferences));
  const windows = [],
    shown = [],
    opened = [],
    handlers = new Map(),
    trays = [];
  const app = new EventEmitter();
  Object.assign(app, {
    isPackaged: true,
    getVersion: () => '0.4.1',
    getPath: () => directory,
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    setAppUserModelId: () => {},
    quit() {
      this.emit('before-quit');
      for (const window of windows) if (!window.destroyed) window.close();
      this.emit('will-quit');
    },
  });
  class BrowserWindow extends EventEmitter {
    constructor(config) {
      super();
      this.config = config;
      this.visible = true;
      this.focused = true;
      this.destroyed = false;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        mainFrame: { url: origin },
        sent: [],
        send: (channel, value) => this.webContents.sent.push([channel, value]),
        setWindowOpenHandler: (handler) => {
          this.openHandler = handler;
        },
        session: { setPermissionCheckHandler() {}, setPermissionRequestHandler() {} },
        isDestroyed: () => this.destroyed,
      });
      windows.push(this);
    }
    loadURL() {
      return Promise.resolve();
    }
    isDestroyed() {
      return this.destroyed;
    }
    isMinimized() {
      return false;
    }
    isVisible() {
      return this.visible;
    }
    isFocused() {
      return this.focused;
    }
    hide() {
      this.visible = false;
      this.focused = false;
    }
    show() {
      this.visible = true;
    }
    focus() {
      this.focused = true;
    }
    restore() {
      this.visible = true;
    }
    close() {
      let cancelled = false;
      this.emit('close', {
        preventDefault() {
          cancelled = true;
        },
      });
      if (!cancelled) {
        this.destroyed = true;
        this.emit('closed');
      }
    }
  }
  class Notification extends EventEmitter {
    static isSupported() {
      return true;
    }
    constructor(config) {
      super();
      this.config = config;
    }
    show() {
      shown.push(this);
    }
    close() {
      this.closed = true;
      this.emit('close');
    }
  }
  class Tray extends EventEmitter {
    constructor() {
      super();
      trays.push(this);
    }
    setToolTip() {}
    setContextMenu(menu) {
      this.menu = menu;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  let resolveDownload;
  const autoUpdater = new EventEmitter();
  Object.assign(autoUpdater, {
    checks: 0,
    downloads: 0,
    installs: 0,
    async checkForUpdates() {
      this.checks++;
      this.emit('checking-for-update');
      this.emit('update-available', { version: '0.5.0' });
    },
    downloadUpdate() {
      this.downloads++;
      return new Promise((resolve) => {
        resolveDownload = resolve;
      });
    },
    quitAndInstall() {
      this.installs++;
      for (const window of windows) if (!window.destroyed) window.close();
      app.quit();
    },
  });
  const electron = {
    app,
    BrowserWindow,
    Notification,
    Tray,
    nativeImage: { createFromPath: () => ({ resize: () => ({ isEmpty: () => false }) }) },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    shell: {
      openExternal: async (url) => {
        opened.push(url);
      },
    },
    Menu: { buildFromTemplate: (template) => template, setApplicationMenu() {} },
    protocol: { handle() {} },
    net: { fetch: async () => ({ ok: true, json: async () => options.release }) },
    dialog: {},
    systemPreferences: {},
  };
  vm.runInNewContext(
    readFileSync(path.resolve('desktop/main.cjs'), 'utf8'),
    {
      require: (name) =>
        name === 'electron'
          ? electron
          : name === 'electron-updater'
            ? { autoUpdater }
            : name === './build-info.json'
              ? options.buildInfo || {}
              : require(name),
      __dirname: path.resolve('desktop'),
      process: { platform: options.platform || 'win32', arch: 'arm64', env: options.env || {} },
      URL,
      Response,
      AbortSignal,
      setImmediate,
      console,
    },
    { filename: 'desktop/main.cjs' },
  );
  await nextTick();
  const window = windows[0];
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  return {
    window,
    app,
    shown,
    opened,
    trays,
    autoUpdater,
    directory,
    invoke: (name, ...args) => handlers.get(name)(event, ...args),
    untrusted: (name, frame) => handlers.get(name)({ ...event, senderFrame: frame }),
    completeDownload() {
      autoUpdater.emit('update-downloaded', { version: '0.5.0' });
      resolveDownload?.([]);
    },
    close() {
      app.quit();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('desktop IPC only accepts the trusted main frame and constrained notification input', async () => {
  const app = await launch();
  try {
    assert.equal(app.window.config.webPreferences.sandbox, true);
    assert.equal(app.window.config.webPreferences.contextIsolation, true);
    assert.equal(app.window.config.webPreferences.nodeIntegration, false);
    assert.throws(() => app.untrusted('notifications:status', { url: origin }), /Untrusted caller/);
    app.window.webContents.mainFrame.url = 'https://example.org';
    assert.throws(() => app.invoke('updates:auto-download', true), /Untrusted caller/);
    app.window.webContents.mainFrame.url = origin;
    assert.throws(
      () => app.invoke('notifications:show', { chatId: '../../private' }),
      /Invalid chat/,
    );
    assert.throws(() => app.invoke('notifications:enabled', 'true'), /Invalid preference/);
    app.window.openHandler({ url: 'file:///etc/passwd' });
    assert.deepEqual(app.opened, []);
  } finally {
    app.close();
  }
});

test('native notifications are opt-in, private, grouped by chat, open the chat and keep the closed window alive', async () => {
  const app = await launch();
  try {
    assert.equal(app.invoke('notifications:show', { chatId }), false);
    const status = app.invoke('notifications:enabled', true);
    assert.equal(status.background, true);
    assert.equal(app.shown[0].config.body, 'Здесь появятся новые сообщения');
    app.shown.length = 0;
    assert.equal(
      app.invoke('notifications:show', { chatId }),
      false,
      'focused app does not duplicate alerts',
    );
    app.window.close();
    assert.equal(app.window.destroyed, false);
    assert.equal(app.window.visible, false);
    assert.equal(
      app.invoke('notifications:show', { chatId, body: 'private message', title: 'private name' }),
      true,
    );
    const first = app.shown[0];
    assert.equal(first.config.title, 'Galinka');
    assert.equal(first.config.body, 'Новое сообщение');
    app.invoke('notifications:show', { chatId });
    assert.equal(first.closed, true);
    app.shown[1].emit('click');
    assert.equal(app.window.visible, true);
    assert.equal(
      app.invoke('notifications:pending'),
      chatId,
      'early click is delivered after renderer subscribes',
    );
    assert.equal(app.invoke('notifications:pending'), null);
    app.window.hide();
    app.invoke('notifications:show', { chatId });
    app.shown[2].emit('click');
    assert.deepEqual(app.window.webContents.sent.at(-1), ['notifications:open', chatId]);
    app.invoke('notifications:clear');
    assert.equal(app.invoke('notifications:status').enabled, false);
    assert.equal(app.trays[0].destroyed, true);
    assert.equal(app.shown[2].closed, true);
    app.invoke('notifications:enabled', true);
    app.trays[1].menu.find((item) => item.label === 'Выйти из Galinka').click();
    assert.equal(app.window.destroyed, true, 'explicit Exit bypasses close-to-tray');
  } finally {
    app.close();
  }
});

test('automatic download reports progress, survives repeated checks, and only installs explicitly', async () => {
  const app = await launch();
  try {
    app.invoke('notifications:enabled', true);
    assert.equal(app.autoUpdater.autoInstallOnAppQuit, false);
    assert.equal((await app.invoke('updates:check')).phase, 'downloading');
    assert.equal(app.autoUpdater.downloads, 1);
    await app.invoke('updates:check');
    assert.equal(app.autoUpdater.checks, 1);
    assert.equal(app.invoke('updates:install'), false);
    app.autoUpdater.emit('download-progress', {
      percent: 48.6,
      transferred: 20,
      total: 40,
      bytesPerSecond: 4,
    });
    assert.equal(app.invoke('updates:status').percent, 49);
    assert.equal(app.invoke('updates:status').bytesPerSecond, 4);
    app.completeDownload();
    await nextTick();
    await app.invoke('updates:check');
    assert.equal(app.invoke('updates:status').phase, 'downloaded');
    assert.equal(app.autoUpdater.installs, 0);
    app.window.hide();
    assert.equal(app.invoke('updates:install'), true);
    await nextTick();
    assert.equal(app.autoUpdater.installs, 1);
    assert.equal(app.window.destroyed, true, 'installer must not get stuck in tray');
  } finally {
    app.close();
  }
});

test('automatic downloading can be disabled persistently and enabled for a waiting release', async () => {
  const app = await launch({ preferences: { autoDownload: false } });
  try {
    assert.equal((await app.invoke('updates:check')).phase, 'available');
    assert.equal(app.autoUpdater.downloads, 0);
    app.invoke('updates:auto-download', true);
    assert.equal(app.autoUpdater.downloads, 1);
    assert.equal(
      JSON.parse(readFileSync(path.join(app.directory, 'preferences.json'))).autoDownload,
      true,
    );
    app.completeDownload();
    await nextTick();
  } finally {
    app.close();
  }
});

test('unsigned macOS and Arch select their own manual installers without automatic installation', async () => {
  const prefix = 'https://github.com/cl0rex1/Galinka/releases/download/v0.5.0/';
  const release = {
    tag_name: 'v0.5.0',
    assets: [
      { name: 'Galinka-0.5.0-linux-arm64.deb', browser_download_url: prefix + 'galinka.deb' },
      { name: 'Galinka-0.5.0-mac-arm64.dmg', browser_download_url: prefix + 'galinka.dmg' },
      { name: 'galinka-0.5.0.pkg.tar.zst', browser_download_url: prefix + 'galinka.pkg.tar.zst' },
    ],
  };
  for (const options of [
    { platform: 'darwin', extension: '.dmg' },
    { platform: 'linux', buildInfo: { packageFormat: 'arch' }, extension: '.pkg.tar.zst' },
  ]) {
    const app = await launch({ ...options, release });
    try {
      const state = await app.invoke('updates:check');
      assert.equal(state.mode, 'manual');
      assert.equal(state.phase, 'available');
      assert.equal(app.autoUpdater.downloads, 0);
      await app.invoke('updates:download');
      assert.ok(app.opened[0].endsWith(options.extension));
      assert.equal(app.invoke('updates:install'), false);
    } finally {
      app.close();
    }
  }
});
