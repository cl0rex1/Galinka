const { _electron: electron, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs/promises');
(async () => {
  const app = await electron.launch({
    executablePath: path.resolve('release/win-unpacked/Galinka.exe'),
    args: ['--user-data-dir=' + path.resolve('.tools/desktop-smoke-profile')],
  });
  try {
    const page = await app.firstWindow();
    await page.goto('https://mess.quiby.me/app?demo=1');
    await expect(page.getByRole('heading', { name: 'На выходные', exact: true })).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Сообщение', exact: true })
      .fill('Проверка установленного приложения');
    await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
    await expect(page.locator('.bubble').last()).toContainText(
      'Проверка установленного приложения',
    );
    await page
      .getByRole('button', { name: 'Настройки', exact: true })
      .filter({ visible: true })
      .click();
    await page.getByRole('button', { name: 'Тёмная', exact: false }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const status = await page.evaluate(() => window.galinkaDesktop.status());
    expect(status.installedVersion).toBe('0.3.0');
    await fs.mkdir('docs/screenshots', { recursive: true });
    await page.screenshot({ path: 'docs/screenshots/windows-app.png' });
    console.log('Packaged Windows app: bundled HTTPS UI, messages, theme and preload passed.');
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
