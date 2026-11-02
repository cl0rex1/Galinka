import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
test.use({ actionTimeout: 10000 });

async function freePort() {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

test('administrator manages users and published mobile content through the real API', async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.TEST_DATABASE_URL,
    'Set TEST_DATABASE_URL to a separate local PostgreSQL database.',
  );
  test.setTimeout(90000);
  const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const directory = await mkdtemp(path.join(tmpdir(), 'galinka-admin-ui-'));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const accounts: string[] = [],
    suffix = randomUUID().slice(0, 8);
  let server: ChildProcess | undefined,
    logs = '';
  const admin = 'admin' + suffix,
    reader = 'reader' + suffix,
    password = 'course-test-password';
  async function login(username: string, target = '/admin') {
    await page.goto(`${origin}${target}`);
    await page.getByLabel('Логин', { exact: true }).fill(username);
    await page.getByLabel('Пароль', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Войти', exact: true }).last().click();
  }
  try {
    server = spawn(process.execPath, ['dist-server/index.js'], {
      env: {
        ...process.env,
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        PORT: String(port),
        INVITE_CODE: 'course-ui-test-invite',
        APP_ORIGIN: origin,
        UPLOAD_DIR: directory,
        NODE_ENV: 'production',
        PUSH_ENABLED: 'false',
        COOKIE_SECURE: 'false',
      },
      stdio: 'pipe',
    });
    server.stderr?.on('data', (chunk) => (logs += chunk));
    let started = false;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${origin}/api/health`)).ok) {
          started = true;
          break;
        }
      } catch {}
      if (server.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(started, logs).toBe(true);
    for (const [username, name] of [
      [admin, 'Александр'],
      [reader, 'Мария'],
    ]) {
      const response = await fetch(`${origin}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, name, password, invite: 'course-ui-test-invite' }),
      });
      expect(response.status).toBe(201);
      accounts.push((await response.json()).id);
    }
    await db.query("UPDATE users SET role='admin' WHERE id=$1", [accounts[0]]);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${origin}/admin`);
    await page.screenshot({ path: testInfo.outputPath('admin-login.png') });
    await login(admin);
    await expect(page.getByRole('heading', { name: 'Пользователи', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: /Мария/ })).toBeVisible();
    for (const width of [320, 375, 414, 768, 1440]) {
      await page.setViewportSize({ width, height: 960 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await page.screenshot({ path: testInfo.outputPath('admin-users.png'), fullPage: true });
    await page.getByRole('button', { name: 'Добавить пользователя', exact: true }).click();
    await page.getByLabel('Имя', { exact: true }).fill('Даниил');
    await page
      .getByRole('dialog')
      .getByLabel(/^Логин/)
      .fill('friend' + suffix);
    await page
      .getByRole('dialog')
      .getByLabel(/^Пароль/)
      .fill(password);
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    const added = await db.query('SELECT id FROM users WHERE username=$1', ['friend' + suffix]);
    accounts.push(added.rows[0].id);
    await page.getByRole('button', { name: `Изменить friend${suffix}`, exact: true }).click();
    await page.getByLabel('Имя', { exact: true }).fill('Даниил Обновлённый');
    await page.getByLabel('Заблокировать аккаунт').check();
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByRole('row', { name: /Даниил Обновлённый/ })).toContainText(
      'Заблокирован',
    );
    await page.getByRole('button', { name: 'Объявления', exact: true }).click();
    await page.getByRole('button', { name: 'Создать объявление', exact: true }).click();
    await page.getByLabel('Заголовок').fill('Встреча нашей компании');
    await page
      .getByLabel('Текст объявления')
      .fill('В субботу собираемся в 18:00.\nМесто и планы обсудим в общем чате.');
    await page.getByRole('dialog').screenshot({ path: testInfo.outputPath('admin-editor.png') });
    // A failed save keeps the draft editable, then retry succeeds.
    await page.route('**/api/admin/announcements', (route) =>
      route.request().method() === 'POST' ? route.abort() : route.continue(),
    );
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Нет соединения');
    await expect(page.getByLabel('Заголовок')).toHaveValue('Встреча нашей компании');
    await page.unroute('**/api/admin/announcements');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByText('Черновик', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
    await expect(page.getByText('Опубликовано', { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('admin-announcements.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await login(reader, '/app');
    await page.setViewportSize({ width: 375, height: 600 });
    await page
      .getByRole('button', { name: 'Объявления', exact: true })
      .filter({ visible: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Встреча нашей компании' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('mobile-announcements.png') });
    await page.route('**/api/announcements?*', (route) =>
      route.fulfill({
        status: 503,
        json: { error: 'Сервер временно недоступен. Повторите попытку.' },
      }),
    );
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Сервер временно' })).toBeVisible();
    await page.unroute('**/api/announcements?*');
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Встреча нашей компании' })).toBeVisible();
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 850 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await page.goto(`${origin}/admin`);
    await expect(page.getByRole('heading', { name: 'Доступ ограничен' })).toBeVisible();
    await page.context().clearCookies();
    await page.setViewportSize({ width: 1440, height: 960 });
    await login(admin);
    await page.getByRole('button', { name: 'Объявления', exact: true }).click();
    await page.getByRole('button', { name: 'Снять с публикации', exact: true }).click();
    await expect(page.getByText('Черновик', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Удалить Встреча нашей компании', exact: true }).click();
    await page.getByRole('button', { name: 'Удалить навсегда', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'Встреча нашей компании' })).toHaveCount(0);
  } finally {
    server?.kill('SIGTERM');
    if (server && server.exitCode === null)
      await new Promise((resolve) => server!.once('exit', resolve));
    if (accounts.length) {
      await db.query('DELETE FROM announcements WHERE author_id=ANY($1::uuid[])', [accounts]);
      await db.query('DELETE FROM chats WHERE owner_id=ANY($1::uuid[])', [accounts]);
      await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [accounts]);
    }
    await db.end();
    await rm(directory, { recursive: true, force: true });
  }
});
