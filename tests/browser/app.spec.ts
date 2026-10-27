import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);
test('demo conversation and Nelya work; modules and keyboard modal are usable', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  await expect(
    page.getByRole('heading', { name: 'На выходные', exact: true }).first(),
  ).toBeVisible();
  await mkdir('docs/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/desktop.png' });
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('@неля монетка');
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  await expect(page.locator('.bubble').last()).toContainText(/Выпало: (орёл|решка)/);
  await page.getByRole('button', { name: 'Новый чат', exact: true }).click();
  await page.getByRole('button', { name: 'Новая группа', exact: true }).click();
  await page.getByLabel('Название группы').fill('Проверка друзей');
  await page.getByRole('button', { name: 'Создать группу', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Проверка друзей', exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Модули', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Это Неля.', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Установить приложение', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
for (const width of [320, 375, 414, 768])
  test(`responsive layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto('/?demo=1');
    if (width <= 640) await page.getByRole('button', { name: /На выходные/ }).click();
    await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    if (width === 375) await page.screenshot({ path: 'docs/screenshots/mobile.png' });
    const composer = await page.locator('.composer').boundingBox();
    expect(composer!.x).toBeGreaterThanOrEqual(0);
    expect(composer!.x + composer!.width).toBeLessThanOrEqual(width);
    if (width <= 640)
      await page.getByRole('button', { name: 'Назад к чатам', exact: true }).click();
    await page
      .getByRole('button', { name: 'Модули', exact: true })
      .filter({ visible: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Это Неля.', exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

test('landing provides downloads and installation instructions', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Место, где свои.' })).toBeVisible();
  await page.getByRole('button', { name: 'Как установить', exact: true }).click();
  await expect(page.locator('.phone-instructions')).toContainText('iPhone');
  await page.getByRole('link', { name: 'Начать общаться', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'С возвращением', exact: true })).toBeVisible();
});
test('web update check reports the installed release', async ({ page }) => {
  await page.route('**/api/version', (route) =>
    route.fulfill({ json: { version, build: process.env.BUILD_SHA || version } }),
  );
  await page.goto('/?demo=1');
  await page
    .getByRole('button', { name: 'Настройки', exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole('button', { name: 'Проверить обновления', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('актуальная версия');
});

test('themes persist and system mode follows the device; demo never asks for push access', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/?demo=1');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page
    .getByRole('button', { name: 'Настройки', exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole('button', { name: 'Тёмная', exact: false }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('switch', { name: 'Пуш-уведомления' })).toHaveCount(0);
  await expect(page.getByText('Недоступны в демоверсии.')).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page
    .getByRole('button', { name: 'Настройки', exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole('button', { name: 'Системная', exact: false }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: testInfo.outputPath('settings-dark.png') });
  await page.getByRole('button', { name: 'Чаты', exact: true }).filter({ visible: true }).click();
  await page.screenshot({ path: testInfo.outputPath('desktop-dark.png') });
});

test('chat details open on demand and a multiline composer keeps the draft', async ({ page }) => {
  await page.goto('/?demo=1');
  await expect(page.locator('.chat-info')).toHaveCount(0);
  await page.getByRole('button', { name: 'О чате', exact: true }).click();
  await expect(page.locator('.chat-info')).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть информацию' }).click();
  const composer = page.getByRole('textbox', { name: 'Сообщение', exact: true });
  await composer.fill('Первая строка\nВторая строка\nТретья строка');
  expect((await composer.boundingBox())!.height).toBeGreaterThan(50);
  await page.getByRole('button', { name: /Аня.*плейлист/ }).click();
  await page.getByRole('button', { name: /На выходные.*Неля/ }).click();
  await expect(composer).toHaveValue('Первая строка\nВторая строка\nТретья строка');
});
