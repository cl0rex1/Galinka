import { test, expect, type Page } from '@playwright/test';

const settings = (page: Page) =>
  page.getByRole('button', { name: 'Настройки', exact: true }).filter({ visible: true }).click();

test.describe('settings as a list of sections', () => {
  test('a section opens as a screen of its own and every way back returns to the list', async ({
    page,
  }) => {
    await page.goto('/?demo=1');
    await settings(page);
    const list = page.getByRole('heading', { name: 'Настройки', level: 1 });
    await expect(list).toBeVisible();
    for (const section of ['Конфиденциальность', 'Оформление', 'Приложение']) {
      await page.getByRole('button', { name: section, exact: true }).click();
      await expect(page.getByRole('heading', { name: section, level: 2 })).toBeVisible();
      // The list under it is out of reach while the section is open.
      await expect(page.locator('.settings-page')).toHaveAttribute('inert', '');
      await page.getByRole('button', { name: 'Назад к настройкам', exact: true }).click();
      await expect(page.locator('.settings-subpage')).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Голос и видео', exact: true }).click();
    await expect(page.locator('.settings-subpage')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-subpage')).toHaveCount(0);
    await expect(page.locator('.settings-page')).not.toHaveAttribute('inert', '');
  });

  test('on a phone a section is swiped away from its left edge', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto('/?demo=1');
    await settings(page);
    await page.getByRole('button', { name: 'Уведомления и звуки', exact: true }).click();
    await expect(page.locator('.settings-subpage')).toHaveCount(1);
    await page.waitForTimeout(450);
    const cdp = await context.newCDPSession(page);
    const touch = (type: string, x: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type: type as 'touchStart',
        touchPoints: type === 'touchEnd' ? [] : [{ x, y: 500 }],
      });
    await touch('touchStart', 6);
    for (let x = 30; x <= 240; x += 30) await touch('touchMove', x);
    await touch('touchEnd', 240);
    await expect(page.locator('.settings-subpage')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Оформление', exact: true })).toBeVisible();
    await context.close();
  });
});

test.describe('chat row menu', () => {
  test('a right click offers the quick actions, and they act on that chat', async ({ page }) => {
    await page.goto('/?demo=1');
    const row = page.locator('.chat-item', { hasText: 'Аня' });
    await expect(row.locator('.unread')).toBeVisible();
    await row.click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Чат «Аня»' });
    await expect(menu).toBeVisible();
    // The menu stays on screen and takes the keyboard.
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await menu.getByRole('menuitem', { name: 'Отметить прочитанным' }).click();
    await expect(menu).toHaveCount(0);
    await expect(row.locator('.unread')).toHaveCount(0);

    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Закрепить' }).click();
    await expect(page.locator('.chat-item').first()).toContainText('Аня');
    await page.locator('.chat-item', { hasText: 'Аня' }).click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Открепить' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('a long press on a phone opens the menu instead of the chat', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 740 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto('/?demo=1');
    const box = (await page.locator('.chat-item', { hasText: 'Макс' }).boundingBox())!;
    const cdp = await context.newCDPSession(page);
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.waitForTimeout(650);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const menu = page.getByRole('menu', { name: 'Чат «Макс»' });
    await expect(menu).toBeVisible();
    const rect = (await menu.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(375);
    // Still on the list: the press did not open the chat.
    await expect(page.locator('.app-shell.has-active')).toHaveCount(0);
    await menu.getByRole('menuitem', { name: 'Без звука' }).click();
    await expect(page.locator('.chat-item', { hasText: 'Макс' }).getByLabel('Без уведомлений')).toBeVisible();
    await context.close();
  });
});

test.describe('profile', () => {
  test('editing the profile: name, about, login with a live check, and the draft survives', async ({
    page,
  }) => {
    await page.goto('/?demo=1');
    await settings(page);
    await page.getByRole('button', { name: 'Изменить профиль', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Профиль', level: 2 })).toBeVisible();
    const about = page.getByRole('textbox', { name: /О себе/ });
    await about.fill('Пишу код и пеку хлеб');
    // Leaving without saving keeps what was typed.
    await page.getByRole('button', { name: 'Назад к настройкам', exact: true }).click();
    await page.getByRole('button', { name: 'Изменить профиль', exact: true }).click();
    await expect(about).toHaveValue('Пишу код и пеку хлеб');

    const login = page.getByRole('textbox', { name: 'Логин' });
    await login.fill('max');
    await expect(page.getByText('Этот логин уже занят')).toBeVisible();
    await expect(login).toHaveAttribute('aria-invalid', 'true');
    await login.fill('a');
    await expect(page.getByText('От 3 до 24 знаков: латинские буквы, цифры и _')).toBeVisible();
    await login.fill('@Sasha_New');
    await expect(login).toHaveValue('sasha_new');
    await expect(page.getByText('Логин свободен')).toBeVisible();
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();

    await expect(page.locator('.settings-subpage')).toHaveCount(0);
    const header = page.locator('.settings-profile');
    await expect(header).toContainText('@sasha_new');
    await expect(header).toContainText('Пишу код и пеку хлеб');
  });

  test('the QR card is one picture with the name and login, shown and saved alike', async ({
    page,
  }) => {
    await page.goto('/?demo=1');
    await settings(page);
    await page.getByRole('button', { name: 'QR-код', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Мой профиль' });
    const card = sheet.getByRole('img', { name: 'QR-код' });
    await expect(card).toBeVisible();
    expect(await card.getAttribute('title')).toBe('Саша, @sasha');
    const size = await card.evaluate((image: HTMLImageElement) => [
      image.naturalWidth,
      image.naturalHeight,
    ]);
    expect(size).toEqual([1080, 1350]);
    const download = page.waitForEvent('download');
    await sheet.getByRole('button', { name: 'Сохранить QR', exact: true }).click();
    expect((await download).suggestedFilename()).toBe('galinka-Саша.png');
  });

  test('someone’s profile shows what they wrote about themselves and copies their login', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/?demo=1');
    await page.getByRole('button', { name: /Аня/ }).first().click();
    await page.getByRole('button', { name: 'О чате', exact: true }).click();
    const info = page.getByRole('complementary', { name: 'О чате' });
    await expect(info.getByText('Люблю горы, плёночные фото и долгие прогулки')).toBeVisible();
    await info.getByRole('button', { name: 'Скопировать логин @anya' }).click();
    await expect(info.getByText('Скопировано')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('@anya');
  });
});
