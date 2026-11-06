import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 820 } });

test('rapid sending keeps order, frees the field at once and leaves no pending bubbles', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  await page.locator('.chat-item', { hasText: 'На выходные' }).click();
  const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  for (let i = 1; i <= 5; i++) {
    await input.fill(`Очередь ${i}`);
    await input.press('Enter');
    // The field is cleared and editable immediately, before the server answers.
    await expect(input).toHaveValue('');
  }
  await expect(page.locator('.pending-mark')).toHaveCount(0);
  const own = await page.locator('.message-row.own .message-text').allTextContents();
  expect(own.slice(-5)).toEqual([1, 2, 3, 4, 5].map((i) => `Очередь ${i}`));
});

test('search: in-chat matches step from newest to oldest; sidebar finds messages in any chat', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  await page.locator('.chat-item', { hasText: 'На выходные' }).click();
  await page.getByRole('button', { name: 'Поиск по сообщениям', exact: true }).click();
  await page.getByRole('textbox', { name: 'Поиск по сообщениям' }).fill('неля');
  const count = page.locator('.search-count');
  await expect(count).toHaveText(/^1 из \d+$/);
  // The conversation is not filtered: messages without the word stay on screen.
  await expect(page.locator('.message-row', { hasText: 'Я за!' })).toBeVisible();
  await expect(page.locator('.message-text mark').first()).toBeVisible();
  await page.getByRole('button', { name: 'Предыдущее совпадение' }).click();
  await expect(count).toHaveText(/^2 из \d+$/);
  await page.getByRole('button', { name: 'Закрыть поиск' }).click();

  await page.getByRole('textbox', { name: 'Найти чат' }).fill('плейлист');
  const hit = page.locator('.message-hit', { hasText: 'Аня' });
  await expect(hit).toBeVisible();
  await expect(hit.locator('mark')).toHaveText('плейлист');
  await hit.click();
  await expect(page.locator('.chat-header')).toContainText('Аня');
  await expect(page.locator('.message-row.flash')).toContainText('плейлист');
});

test('a custom theme is created, applied, and travels by link to another browser', async ({
  page,
  browser,
}) => {
  await page.addInitScript(() => {
    Object.defineProperties(navigator, {
      canShare: { value: (data: ShareData) => data.files?.[0]?.type === 'image/png' },
      share: {
        value: async (data: ShareData) => {
          document.body.dataset.sharedText = data.text;
          document.body.dataset.sharedFile = data.files?.[0]?.name;
        },
      },
    });
  });
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('tab', { name: 'Оформление', exact: true }).click();
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Новая тема' });
  await editor.getByLabel('Название').fill('Мята');
  await editor
    .getByRole('group', { name: 'Акцент' })
    .getByRole('button', { name: '#0f7f86' })
    .click();
  await editor.getByRole('button', { name: 'Создать тему' }).click();
  await expect(page.getByRole('radio', { name: 'Тема Мята' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.style.getPropertyValue('--color-accent')),
    )
    .toBe('#0f7f86');
  await page.getByRole('button', { name: 'Поделиться темой' }).click();
  const sheet = page.getByRole('dialog', { name: 'Поделиться темой' });
  await expect(sheet.getByRole('img', { name: 'QR-код' })).toBeVisible();
  const link = await sheet.getByRole('textbox', { name: 'Ссылка' }).inputValue();
  expect(link).toContain('/app?theme=');
  await sheet.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-shared-file', 'galinka-Мята.png');
  expect(await page.locator('body').getAttribute('data-shared-text')).toContain(link);

  const other = await browser.newPage();
  await other.goto(link.replace('/app?', '/app?demo=1&'));
  const preview = other.getByRole('dialog', { name: 'Тема «Мята»' });
  await preview.getByRole('button', { name: 'Добавить и включить' }).click();
  await expect
    .poll(() =>
      other.evaluate(() => document.documentElement.style.getPropertyValue('--color-accent')),
    )
    .toBe('#0f7f86');
  await expect(other).not.toHaveURL(/theme=/);
  await other.close();
});
