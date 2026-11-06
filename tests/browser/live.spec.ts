import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('published Galinka serves the current installers and a working app', async ({
  page,
}, testInfo) => {
  test.skip(!process.env.GALINKA_LIVE_URL, 'Set GALINKA_LIVE_URL for the public smoke check.');
  const { version } = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(process.env.GALINKA_LIVE_URL!);
  await expect(page.getByRole('heading', { name: 'Ближе. Даже издалека.' })).toBeVisible();
  const prefix = `https://github.com/cl0rex1/Galinka/releases/download/v${version}/Galinka-${version}`;
  for (const [platform, name, suffix] of [
    ['Windows', /Скачать для Windows/, '-win-x64.exe'],
    ['Android', /Скачать APK/, '-android-release.apk'],
    ['Arch Linux', /Скачать пакет/, '-arch-x64.pkg.tar.zst'],
    ['macOS', /Для Apple Silicon/, '-mac-arm64.dmg'],
    ['Linux', /Скачать AppImage/, '-linux-x86_64.AppImage'],
  ] as const) {
    await page.getByRole('button', { name: platform, exact: true }).click();
    await expect(page.getByRole('link', { name })).toHaveAttribute('href', prefix + suffix);
  }
  await page.screenshot({ path: testInfo.outputPath('downloads-live.png'), fullPage: true });
  await page.getByRole('link', { name: 'Открыть Galinka в браузере', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible();
});
