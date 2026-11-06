import { test, expect } from '@playwright/test';

// Chromium's fake camera and microphone: never the user's real devices.
test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
  permissions: ['camera', 'microphone'],
  viewport: { width: 1280, height: 820 },
});

test('round video: record, attach, send and play', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Fake capture devices are a Chromium switch.');
  await page.goto('/?demo=1');
  await page.locator('.chat-item', { hasText: 'На выходные' }).click();
  await page.getByRole('button', { name: 'Записать кружок', exact: true }).click();
  const recorder = page.getByRole('dialog', { name: 'Запись кружка', exact: true });
  await expect(recorder.locator('.recording-time')).toHaveText('0:02', { timeout: 10000 });
  await recorder.getByRole('button', { name: 'Завершить кружок', exact: true }).click();
  await expect(recorder).toHaveCount(0);
  await expect(page.locator('.pending-file')).toContainText('Кружок');
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  const note = page.locator('.video-note').last();
  // The recorder writes no length into the header; the player still finds it.
  await expect(note.locator('.video-note-time')).toHaveText(/^0:0[1-3]$/);
  await note.click();
  await expect(note).toHaveClass(/playing/);
  await expect(page.locator('.chat-item').first()).toContainText('Вы: Кружок');
});

test('photo viewer zooms and resets; dialogs survive a text selection dragged outside', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  await page.locator('.chat-item', { hasText: 'На выходные' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'zoom.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWT0AAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть фото zoom.png', exact: true }).click();
  const viewer = page.getByRole('dialog', { name: 'Просмотр фото zoom.png', exact: true });
  const image = viewer.locator('.media-full-image');
  await viewer.getByRole('button', { name: 'Увеличить', exact: true }).click();
  await expect.poll(() => image.evaluate((el) => el.style.transform)).toContain('scale(1.5)');
  await page.keyboard.press('0');
  await expect.poll(() => image.evaluate((el) => el.style.transform)).toContain('scale(1)');
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);

  // Select text in a field and release the mouse over the backdrop: the dialog stays.
  await page.getByRole('button', { name: 'Новый чат', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Новый чат', exact: true });
  const field = dialog.getByLabel('Найти пользователя', { exact: true });
  await field.fill('выделяемый текст');
  const box = (await field.boundingBox())!;
  await page.mouse.move(box.x + box.width - 8, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(4, 4, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expect(dialog).toBeVisible();
  // A real click on the backdrop still closes it.
  await page.mouse.click(4, 4);
  await expect(dialog).toHaveCount(0);
});

test('chat rows share one height whatever the preview length', async ({ page }) => {
  await page.goto('/?demo=1');
  await expect(page.locator('.chat-item').nth(3)).toBeVisible();
  const heights = await page
    .locator('.chat-item')
    .evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().height)));
  expect(heights.length).toBeGreaterThan(2);
  expect(new Set(heights).size).toBe(1);
});
