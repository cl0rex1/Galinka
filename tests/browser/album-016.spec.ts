import { test, expect, type Page } from '@playwright/test';
import { voiceChat } from './helpers/voice-suite';

test.use({ viewport: { width: 1100, height: 800 }, actionTimeout: 5000 });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const photo = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG });
const input = (page: Page) => page.locator('input[type=file]').first();
/** Photos and videos open the send window: caption and Send live there. */
const sendWindow = (page: Page) => page.getByRole('dialog', { name: /^Отправить/ });

test.describe('0.16.0 albums in the demo', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem('galinka-demo-v1'));
    await page.goto('/?demo=1');
    await expect(page.locator('.message-row', { hasText: 'Я за!' }).first()).toBeVisible();
  });

  test('several photos wait in a strip, go out together and read as one grid', async ({ page }) => {
    await input(page).setInputFiles([photo('a.png'), photo('b.png'), photo('c.png')]);
    const window = sendWindow(page);
    await expect(window).toHaveAccessibleName('Отправить 3 фото');
    await expect(window.locator('li')).toHaveCount(3);
    // One can be taken back before sending.
    await window.getByRole('button', { name: 'Убрать b.png' }).click();
    await expect(window.locator('li')).toHaveCount(2);
    await input(page).setInputFiles([photo('d.png')]);
    await expect(window.locator('li')).toHaveCount(3);
    // Closing the window keeps the files in the composer strip; it opens again on the next file.
    await window.getByRole('button', { name: 'Свернуть' }).click();
    await expect(page.locator('.pending-strip li')).toHaveCount(3);
    await page.locator('.pending-strip').getByRole('button', { name: 'Убрать файл d.png' }).click();
    await input(page).setInputFiles([photo('d.png')]);

    await window.getByRole('textbox', { name: 'Подпись' }).fill('Поездка в горы');
    await window.getByRole('button', { name: 'Отправить', exact: true }).click();
    const album = page.locator('.album-grid');
    await expect(album).toHaveCount(1);
    await expect(album.locator('img')).toHaveCount(3);
    await expect(page.locator('.pending-strip')).toHaveCount(0);
    // The caption sits under the grid, once.
    await expect(page.locator('.message-row', { hasText: 'Поездка в горы' })).toHaveCount(1);
    // A tap opens the viewer on that photo.
    await album.locator('.image-preview').nth(1).click();
    await expect(page.getByText('2 из 3')).toBeVisible();
  });

  test('album actions edit its caption, forward every file, and find either photo from chat info', async ({
    page,
  }) => {
    await input(page).setInputFiles([photo('first.png'), photo('last.png')]);
    const review = sendWindow(page);
    await review.getByRole('textbox', { name: 'Подпись' }).fill('Первый вариант');
    await review.getByRole('button', { name: 'Отправить', exact: true }).click();
    const row = page.locator('.message-row').filter({ has: page.locator('.album-grid') });
    await row.locator('.message-text').click({ button: 'right' });
    await row.getByRole('button', { name: /Изменить/ }).click();
    const composer = page.getByRole('textbox', { name: 'Сообщение' });
    await expect(composer).toHaveValue('Первый вариант');
    await composer.fill('Готовая подпись');
    await composer.press('Enter');
    await expect(row).toContainText('Готовая подпись');

    for (const index of [0, 1]) {
      await page.getByRole('button', { name: 'О чате', exact: true }).click();
      await page.locator('.chat-media .media-grid button').nth(index).click();
      await page
        .getByRole('dialog', { name: 'Просмотр фотографии' })
        .getByRole('button', { name: 'Показать в чате' })
        .click();
      await expect(row).toHaveClass(/flash/);
    }
    await row.locator('.message-text').click({ button: 'right' });
    await row.getByRole('button', { name: /Переслать/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Переслать 2 сообщения' });
    await dialog.getByRole('button', { name: /Избранное/ }).click();
    await expect(row.locator('.album-grid img')).toHaveCount(2);
    await expect(row).toContainText('Готовая подпись');
    await row.locator('.message-text').click({ button: 'right' });
    await row.getByRole('button', { name: /Выбрать/ }).click();
    await expect(page.locator('.selection-header')).toContainText('2 сообщения');
    await page.getByRole('button', { name: 'Удалить выбранные' }).click();
    await page.getByRole('button', { name: 'Удалить у себя', exact: true }).click();
    await expect(row).toHaveCount(0);
  });

  test('an oversized selection preserves the draft; mixed audio and photos all arrive', async ({
    page,
  }) => {
    await input(page).setInputFiles(photo('keep.png'));
    await sendWindow(page).getByRole('button', { name: 'Свернуть' }).click();
    await input(page).setInputFiles(Array.from({ length: 10 }, (_, i) => photo(`${i}.png`)));
    await expect(page.getByRole('alert')).toContainText('не больше 10 файлов');
    await expect(page.locator('.pending-file strong')).toHaveAttribute('title', 'keep.png');
    await input(page).setInputFiles([
      { name: 'sound.wav', mimeType: 'audio/wav', buffer: Buffer.from('RIFF') },
      photo('other.png'),
    ]);
    const review = sendWindow(page);
    await expect(review.locator('li')).toHaveCount(3);
    await review.getByRole('button', { name: 'Отправить', exact: true }).click();
    await expect(page.locator('.messages .image-preview')).toHaveCount(2);
    await expect(page.locator('.messages .audio-file-name')).toHaveText('sound.wav');
    await expect(page.locator('.album-grid')).toHaveCount(0);
  });

  test('a single file still goes as before', async ({ page }) => {
    await input(page).setInputFiles([photo('one.png')]);
    await expect(page.locator('.pending-file')).toBeVisible();
    await expect(page.locator('.pending-strip')).toHaveCount(0);
  });
});

test('the chat profile lists shared media, files and links and opens the message', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.removeItem('galinka-demo-v1'));
  await page.goto('/?demo=1');
  await expect(page.locator('.message-row', { hasText: 'Я за!' }).first()).toBeVisible();
  await input(page).setInputFiles([photo('a.png'), photo('b.png')]);
  await expect(page.locator('.pending-strip li')).toHaveCount(2);
  await sendWindow(page).getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.locator('.album-grid')).toHaveCount(1);
  await input(page).setInputFiles([
    { name: 'отчёт.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') },
  ]);
  await expect(page.locator('.pending-file')).toBeVisible();
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  await expect(page.locator('.file-attachment', { hasText: 'отчёт.pdf' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Сообщение' }).fill('смотри https://example.com/гора');
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();

  await page.getByRole('button', { name: 'О чате', exact: true }).click();
  const section = page.locator('.chat-media');
  await expect(section.locator('.media-grid button')).toHaveCount(2);
  await section.getByRole('tab', { name: 'Файлы' }).click();
  await expect(section.getByText('отчёт.pdf')).toBeVisible();
  await section.getByRole('tab', { name: 'Ссылки' }).click();
  await expect(section.getByRole('link', { name: 'https://example.com/гора' })).toBeVisible();
  await section.getByRole('tab', { name: 'Голосовые' }).click();
  await expect(section.getByText('Голосовых сообщений и кружков пока нет.')).toBeVisible();
  // A tap on an item shows that message in the conversation.
  await section.getByRole('tab', { name: 'Файлы' }).click();
  const download = page.waitForEvent('download');
  await section.getByRole('button', { name: 'Скачать отчёт.pdf' }).click();
  expect((await download).suggestedFilename()).toBe('отчёт.pdf');
  await section.getByRole('button', { name: 'Показать в чате' }).click();
  await expect(page.locator('.message-row.flash')).toHaveCount(1);
});

test('retrying a media page keeps earlier items and resumes at the same cursor', async ({
  page,
}) => {
  await voiceChat(page);
  const cursors: string[] = [];
  await page.route('**/api/chats/voice-chat/media?*', (route) => {
    const before = new URL(route.request().url()).searchParams.get('before');
    if (before) {
      cursors.push(before);
      if (cursors.length === 1) return route.fulfill({ status: 503, json: {} });
    }
    const id = before ? 'second' : 'first';
    return route.fulfill({
      json: {
        items: [
          {
            id,
            cursor: id,
            created_at: '2026-11-18T00:00:00Z',
            sender_name: 'Друг',
            file: {
              id,
              name: id + '.mp4',
              mime: 'video/mp4',
              thumb: 'data:image/png;base64,' + PNG.toString('base64'),
            },
          },
        ],
        more: !before,
      },
    });
  });
  await page.getByRole('button', { name: 'О чате', exact: true }).click();
  const section = page.locator('.chat-media');
  await expect(section.locator('.media-grid img')).toHaveCount(1);
  await section.getByRole('button', { name: 'Показать ещё' }).click();
  await section.getByRole('button', { name: 'Повторить' }).click();
  await expect(section.locator('.media-grid img')).toHaveCount(2);
  expect(cursors).toEqual(['first', 'first']);
});
