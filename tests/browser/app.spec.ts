import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
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
