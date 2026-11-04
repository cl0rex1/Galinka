const { _electron: electron, expect } = require('@playwright/test');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');

(async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'galinka-native-smoke-'));
  const app = await electron.launch({
    args: [path.resolve('dist-desktop'), '--user-data-dir=' + directory],
  });
  try {
    // Exercise native IPC/window/tray lifecycle without sending OS test alerts or
    // changing the user's notification permissions. Delivery is tested with an OS device.
    await app.evaluate(({ Notification }) => {
      global.testNotifications = [];
      Notification.prototype.show = function () {
        global.testNotifications.push(this);
      };
    });
    const page = await app.firstWindow();
    await page.goto('https://mess.quiby.me/app?demo=1');
    await expect(page.getByRole('heading', { name: 'На выходные', exact: true })).toBeVisible();
    const status = await page.evaluate(() => window.galinkaDesktop.status());
    expect(status.installedVersion).toBe(require('../../package.json').version);
    const disabled = await page.evaluate(() => window.galinkaDesktop.setAutoDownload(false));
    expect(disabled.autoDownload).toBe(false);
    await page.evaluate(() => window.galinkaDesktop.setAutoDownload(true));
    const enabled = await page.evaluate(() => window.galinkaDesktop.notifications.setEnabled(true));
    expect(enabled.enabled).toBe(true);
    expect(enabled.background).toBe(true);
    await page.evaluate(() => {
      window.galinkaDesktop.notifications.onOpen((chatId) => {
        window.testOpenedChat = chatId;
      });
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    const background = await app.evaluate(({ BrowserWindow }) => ({
      count: BrowserWindow.getAllWindows().length,
      visible: BrowserWindow.getAllWindows()[0].isVisible(),
    }));
    expect(background).toEqual({ count: 1, visible: false });
    const chatId = '405f3fdd-c85a-4596-bab4-d123981e1a2f';
    expect(
      await page.evaluate((id) => window.galinkaDesktop.notifications.show({ chatId: id }), chatId),
    ).toBe(true);
    const toast = await app.evaluate(() => {
      const notification = global.testNotifications.at(-1);
      const result = { title: notification.title, body: notification.body };
      notification.emit('click');
      return result;
    });
    expect(toast).toEqual({ title: 'Galinka', body: 'Новое сообщение' });
    await expect.poll(() => page.evaluate(() => window.testOpenedChat)).toBe(chatId);
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    ).toBe(true);
    await page.evaluate(() => window.galinkaDesktop.notifications.clear());
    expect((await page.evaluate(() => window.galinkaDesktop.notifications.status())).enabled).toBe(
      false,
    );
    console.log(
      'Native Electron: bundled UI, private notification bridge, click routing, tray lifetime and update preferences passed. OS delivery and installers were not invoked.',
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
