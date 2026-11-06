import { test, expect } from '@playwright/test';
import { detectPlatform, newerVersion } from '../../src/platform';
const assets = [
  'Galinka-0.4.0-android-release.apk',
  'Galinka-0.4.0-win-x64.exe',
  'Galinka-0.4.0-mac-arm64.dmg',
  'Galinka-0.4.0-mac-x64.dmg',
  'Galinka-0.4.0-linux-x64.AppImage',
  'Galinka-0.4.0-linux-x64.deb',
  'Galinka-0.4.0-arch-x64.pkg.tar.zst',
];
const release = {
  version: '0.4.0',
  url: 'https://github.com/cl0rex1/Galinka/releases/tag/v0.4.0',
  assets: assets.map((name) => ({
    name,
    url: `https://github.com/cl0rex1/Galinka/releases/download/v0.4.0/${name}`,
    size: 24000000,
  })),
};
test('device detection distinguishes iPad desktop mode and semantic versions', () => {
  expect(detectPlatform('Mozilla Macintosh Safari', 5)).toBe('iOS');
  expect(detectPlatform('Mozilla Macintosh Safari', 0)).toBe('macOS');
  expect(detectPlatform('Mozilla Android Linux', 5)).toBe('Android');
  expect(newerVersion('0.10.0', '0.9.9')).toBe(true);
  expect(newerVersion('0.3.2', '0.4.0')).toBe(false);
  expect(newerVersion('garbage', '0.4.0')).toBe(false);
});
for (const width of [320, 375, 414, 768]) {
  test(`downloads fit at ${width}px and select real installers for every platform`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/downloads', (r) => r.fulfill({ json: release }));
    await page.goto('/');
    for (const [platform, suffix] of [
      ['Android', '.apk'],
      ['Windows', '.exe'],
      ['macOS', '.dmg'],
      ['Linux', '.AppImage'],
      ['Arch Linux', '.pkg.tar.zst'],
    ]) {
      await page.getByRole('button', { name: platform, exact: true }).click();
      await expect(page.locator('.release-files a.primary').first()).toHaveAttribute(
        'href',
        new RegExp(suffix.replaceAll('.', '\\.') + '$'),
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await page.getByRole('button', { name: 'iOS', exact: true }).click();
    await page.getByRole('button', { name: 'Как установить', exact: true }).click();
    await expect(page.locator('.phone-instructions')).toContainText('Safari');
    await page.screenshot({ path: testInfo.outputPath(`downloads-${width}.png`), fullPage: true });
  });
}
test('download failure offers a working retry', async ({ page }) => {
  let failed = true;
  await page.route('**/api/downloads', (r) =>
    r.fulfill(failed ? { status: 503, json: { error: 'unavailable' } } : { json: release }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Android', exact: true }).click();
  await expect(page.getByText('Не удалось загрузить список сборок.')).toBeVisible();
  failed = false;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('link', { name: /Скачать APK/ })).toBeVisible();
});
test('update sidebar action appears only after a newer version is found', async ({ page }) => {
  await page.route('**/api/version', (r) =>
    r.fulfill({ json: { version: '9.0.0', build: 'future' } }),
  );
  await page.goto('/?demo=1');
  await expect(page.getByRole('button', { name: 'Доступно обновление', exact: true })).toHaveCount(
    0,
  );
  await page
    .getByRole('button', { name: 'Настройки', exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole('tab', { name: 'Приложение', exact: true }).click();
  await page.getByRole('button', { name: 'Проверить обновления', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Доступно обновление', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Обновить приложение', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('На связи с вашим сервером')).toHaveCount(0);
});
