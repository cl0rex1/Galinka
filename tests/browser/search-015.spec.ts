import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 1100, height: 800 }, actionTimeout: 5000 });

const row = (page: Page, text: string) => page.locator('.message-row', { hasText: text }).first();

test.describe('0.15.0 in the demo', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('galinka-demo-v1');
      for (const key of Object.keys(localStorage))
        if (key.startsWith('galinka-recent-search')) localStorage.removeItem(key);
    });
    await page.goto('/?demo=1');
    await expect(row(page, 'Я за!')).toBeVisible();
  });

  test('search filters narrow messages; a found message opens and the search is remembered', async ({
    page,
  }) => {
    const field = page.getByRole('textbox', { name: 'Найти чат' });
    await field.click();
    const filters = page.getByRole('group', { name: 'Фильтры поиска' });
    await expect(filters).toBeVisible();
    await expect(page.getByText('Найдите чат, человека или сообщение')).toBeVisible();

    // A filter alone is a search: everything I wrote.
    await filters.getByRole('combobox', { name: 'Автор' }).selectOption('me');
    const hits = page.locator('.message-hit');
    await expect(hits.first()).toBeVisible();
    for (const text of await hits.allInnerTexts()) expect(text).toContain('Вы:');

    // "Я за! Хочется гор" is someone else's: with the author filter it is not found.
    await field.fill('гор');
    await expect(page.getByText('Ничего не найдено')).toBeVisible();
    await filters.getByRole('button', { name: 'Сбросить' }).click();
    await expect(hits.first()).toBeVisible();
    await hits.first().click();
    await expect(filters).toHaveCount(0);
    await expect(page.locator('.message-row.flash')).toHaveCount(1);

    // Back in search, with nothing typed: the query and the chat are under "Недавние".
    await field.click();
    await expect(page.getByRole('button', { name: 'гор', exact: true })).toBeVisible();
    await expect(page.locator('.recent-chats button')).toHaveCount(1);
    await page.getByRole('button', { name: 'Очистить', exact: true }).click();
    await expect(page.locator('.recent-chats button')).toHaveCount(0);
    await field.press('Escape');
    await expect(page.getByRole('group', { name: 'Фильтры поиска' })).toHaveCount(0);
  });

  test('the group owner can mention everyone, and it reads as a mention', async ({ page }) => {
    const composer = page.getByRole('textbox', { name: 'Сообщение' });
    await composer.fill('@вс');
    const option = page.getByRole('button', { name: /Упомянуть всех/ });
    await expect(option).toBeVisible();
    await option.click();
    await expect(composer).toHaveValue('@все ');
    await composer.pressSequentially('собираемся в 7');
    await composer.press('Enter');
    await expect(row(page, 'собираемся в 7').locator('.message-mention.all')).toHaveText('@все');
  });

  test('the chat calendar is in the in-chat search, and a day opens its messages', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Поиск по сообщениям', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Перейти к дате' })).toBeVisible();
    const today = new Date().toLocaleDateString('sv');
    await page.locator('.date-jump').fill(today);
    await expect(page.locator('.message-row.flash')).toHaveCount(1);
  });
});
