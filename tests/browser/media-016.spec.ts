import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 1100, height: 800 }, actionTimeout: 5000 });

async function chat(page: Page) {
  await page.addInitScript(() => localStorage.removeItem('galinka-demo-v1'));
  await page.goto('/?demo=1');
  await expect(page.locator('.message-row', { hasText: 'Я за!' }).first()).toBeVisible();
}
const sendWindow = (page: Page) => page.getByRole('dialog', { name: /^Отправить/ });

/** A PNG of the given size, drawn in the page. */
async function picture(page: Page, width: number, height: number) {
  const bytes = await page.evaluate(
    async ([w, h]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#3a7';
      context.fillRect(0, 0, w, h);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), 'image/png'),
      );
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    [width, height],
  );
  return { name: 'wide.png', mimeType: 'image/png', buffer: Buffer.from(bytes) };
}

test('a photo is turned and cropped in the editor, sent with its caption, and holds its place', async ({
  page,
}) => {
  await chat(page);
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles(await picture(page, 800, 400));
  const window = sendWindow(page);
  await window.getByRole('button', { name: 'Редактировать wide.png' }).click();
  const editor = page.getByRole('dialog', { name: 'Редактор фото' });
  await editor.getByRole('button', { name: 'Повернуть' }).click();
  // Pull the bottom edge of the frame halfway up.
  const handle = editor.locator('.crop-handle.s');
  const box = (await handle.boundingBox())!;
  const canvas = (await editor.locator('canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - canvas.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  await editor.getByRole('button', { name: 'Рисовать' }).click();
  await page.mouse.move(canvas.x + 20, canvas.y + 20);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 80, canvas.y + 60, { steps: 5 });
  await page.mouse.up();
  await expect(editor.getByRole('button', { name: 'Отменить последний штрих' })).toBeEnabled();
  await editor.getByRole('button', { name: 'Готово' }).click();
  await expect(editor).toHaveCount(0);
  // Turned a quarter: 400×800, then half the height kept.
  const edited = window.locator('img');
  await expect
    .poll(() => edited.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]))
    .toEqual([400, 400]);
  await window.getByRole('textbox', { name: 'Подпись' }).fill('Обрезал');
  await window.getByRole('button', { name: 'Отправить', exact: true }).click();
  const sent = page.locator('.message-row', { hasText: 'Обрезал' }).locator('.image-preview img');
  // Width and height are known before the picture loads.
  await expect(sent).toHaveAttribute('width', '400');
  await expect(sent).toHaveAttribute('height', '400');
  await expect(sent.locator('..')).toHaveClass(/loaded/);
});

async function syntheticMicrophone(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', {
      configurable: true,
      value: async () => {
        const context = new AudioContext();
        const destination = context.createMediaStreamDestination();
        const oscillator = context.createOscillator();
        oscillator.connect(destination);
        oscillator.start();
        await context.resume();
        return destination.stream;
      },
    });
  });
}

test('voice: pause and resume, listen before sending; holding the button sends on release', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Synthetic audio recording is checked in Chromium.');
  await syntheticMicrophone(page);
  await chat(page);
  const mic = page.getByRole('button', { name: 'Записать голосовое сообщение', exact: true });
  await mic.click();
  await expect(page.locator('.recording-time')).toHaveText('00:01', { timeout: 10000 });
  await expect(page.locator('.recording-wave i').first()).toBeAttached();
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await expect(page.locator('.recording-label')).toHaveText('Пауза');
  const paused = await page.locator('.recording-time').textContent();
  await page.waitForTimeout(1500);
  await expect(page.locator('.recording-time')).toHaveText(paused!);
  await page.getByRole('button', { name: 'Продолжить запись', exact: true }).click();
  await page.getByRole('button', { name: 'Завершить запись', exact: true }).click();
  // Listen before sending: the recording waits in the composer with its player.
  await expect(page.locator('.pending-file .voice-play')).toBeVisible();
  await page.getByRole('button', { name: 'Убрать файл', exact: true }).click();

  const box = (await mic.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('.voice-recording.holding')).toBeVisible();
  await expect(page.locator('.recording-time')).toHaveText('00:01', { timeout: 10000 });
  await page.mouse.up();
  // Sent straight away, no preview step.
  await expect(page.locator('.audio-attachment .voice-play')).toBeVisible();
  await expect(page.locator('.pending-file')).toHaveCount(0);

  // A second one; playing the first goes on to the second, with the mini-player above the chat.
  await page.mouse.down();
  await expect(page.locator('.recording-time')).toHaveText('00:01', { timeout: 10000 });
  await page.mouse.up();
  const voices = page.locator('.messages .audio-attachment .voice-player');
  await expect(voices).toHaveCount(2);
  await voices.first().getByRole('button', { name: 'Воспроизвести голосовое' }).click();
  await expect(page.getByRole('region', { name: 'Сейчас играет' })).toBeVisible();
  await expect(voices.nth(1)).toHaveAttribute('data-state', 'playing', { timeout: 10000 });
  await page.getByRole('button', { name: 'Закрыть плеер' }).click();
  await expect(page.getByRole('region', { name: 'Сейчас играет' })).toHaveCount(0);
  await expect(voices.nth(1)).not.toHaveAttribute('data-state', 'playing');
});
