import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import qrcode from 'qrcode-generator';

// A fake camera that films a QR code: a Y4M video Chromium plays instead of a real device.
// The code sits off-centre so the scanner frame has to travel to it.
const themeCode = 'WyLQnNGP0YLQsCIsImxpZ2h0IiwiIzBmN2Y4NiIsIiNkOWViZTkiLCIjZDJlZmVjIl0';
const video = path.join(tmpdir(), 'galinka-qr-camera.y4m');
{
  const qr = qrcode(0, 'M');
  qr.addData(`http://localhost:5173/app?theme=${themeCode}`);
  qr.make();
  const [width, height, cell] = [640, 480, 6];
  const n = qr.getModuleCount();
  const left = 300,
    top = 120;
  const luma = Buffer.alloc(width * height, 235);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const r = Math.floor((y - top) / cell),
        c = Math.floor((x - left) / cell);
      if (r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c)) luma[y * width + x] = 16;
    }
  const chroma = Buffer.alloc((width * height) / 2, 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), luma, chroma]);
  writeFileSync(
    video,
    Buffer.concat([
      Buffer.from(`YUV4MPEG2 W${width} H${height} F10:1 Ip A1:1 C420jpeg\n`),
      ...Array.from({ length: 10 }, () => frame),
    ]),
  );
}
test.use({
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-video-capture=${video}`,
    ],
  },
  permissions: ['camera'],
  viewport: { width: 390, height: 844 },
});

test('scanner finds a code anywhere in the picture, frames it and opens the Galinka link', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'The fake camera file is a Chromium switch.');
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Сканировать QR-код', exact: true }).click();
  const scanner = page.getByRole('dialog', { name: 'Сканер QR-кода' });
  await expect(scanner).toBeVisible();
  // Once found, the theme preview opens and the camera is released.
  const preview = page.getByRole('dialog', { name: 'Тема «Мята»' });
  await expect(preview).toBeVisible({ timeout: 10000 });
  await expect(scanner).toHaveCount(0);
  await preview.getByRole('button', { name: 'Добавить и включить' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.style.getPropertyValue('--color-accent')),
    )
    .toBe('#0f7f86');
});

test('signing in by QR: the new device shows a code and enters once the phone approves', async ({
  page,
}) => {
  let polls = 0;
  const anna = { id: 'u1', username: 'anna', name: 'Анна', color: 1, role: 'user' };
  // Signed out until the phone approves, signed in afterwards (as the session cookie would do).
  await page.route('**/api/me', (route) =>
    polls < 2 ? route.fulfill({ status: 401, json: { error: '' } }) : route.fulfill({ json: anna }),
  );
  await page.route('**/api/events', (route) => route.abort());
  await page.route('**/api/auth/qr', (route) =>
    route.fulfill({ json: { token: 'a'.repeat(32), key: 'k', expires: Date.now() + 120000 } }),
  );
  await page.route('**/api/auth/qr/poll', (route) =>
    route.fulfill({
      json:
        ++polls < 2
          ? { status: 'pending' }
          : {
              status: 'approved',
              person: anna,
            },
    }),
  );
  await page.route('**/api/chats', (route) => route.fulfill({ json: [] }));
  await page.goto('/app');
  await page.waitForTimeout(600); // let the card finish rising in
  const qrTab = page.getByRole('tab', { name: 'QR-код', exact: true });
  const position = (await qrTab.boundingBox())!.y;
  await qrTab.click();
  await expect(page.getByRole('img', { name: 'QR-код' })).toBeVisible();
  expect((await qrTab.boundingBox())!.y).toBe(position);
  await expect(page.getByRole('heading', { name: 'Чаты' })).toBeVisible({ timeout: 8000 });
});
