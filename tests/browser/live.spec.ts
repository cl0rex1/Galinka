import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test('published Galinka serves real desktop downloads and a working app', async ({ page }) => {
  test.skip(!process.env.GALINKA_LIVE_URL, 'Set GALINKA_LIVE_URL for the public smoke check.');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(process.env.GALINKA_LIVE_URL!);
  await expect(page.getByRole('heading', { name: 'Место, где свои.' })).toBeVisible();
  await page.getByRole('button', { name: 'Windows', exact: true }).click();
  const download = page.getByRole('link', { name: /Скачать приложение/ });
  await expect(download).toHaveAttribute(
    'href',
    /github\.com\/cl0rex1\/Galinka\/releases\/download\/v\d+\.\d+\.\d+\/.*\.exe$/,
  );
  await mkdir('docs/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/downloads-live.png', fullPage: true });
  await page.getByRole('link', { name: 'Начать общаться', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'С возвращением', exact: true })).toBeVisible();
});
