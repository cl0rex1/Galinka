import { test, expect, type BrowserContext } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

// Use an isolated production server: the admin test owns Vite's API port 3001.
async function freePort() {
  const socket = createServer();
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) =>
    socket.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

test('two real clients exchange group messages; retry and chat switching preserve drafts and files', async ({
  browser,
}) => {
  test.skip(
    !process.env.TEST_DATABASE_URL,
    'Set TEST_DATABASE_URL to a separate PostgreSQL database; run npm run build first.',
  );
  test.setTimeout(90000);
  const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const directory = await mkdtemp(path.join(tmpdir(), 'galinka-messaging-ui-'));
  const accounts: string[] = [];
  const contexts: BrowserContext[] = [];
  const suffix = randomUUID().slice(0, 8);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let server: ChildProcess | undefined;
  let logs = '';
  let releaseUpload: (() => void) | undefined;
  try {
    server = spawn(process.execPath, ['dist-server/index.js'], {
      env: {
        ...process.env,
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        PORT: String(port),
        APP_ORIGIN: origin,
        INVITE_CODE: 'messaging-ui-test-invite',
        UPLOAD_DIR: directory,
        NODE_ENV: 'production',
        PUSH_ENABLED: 'false',
        COOKIE_SECURE: 'false',
      },
      stdio: 'pipe',
    });
    server.stderr?.on('data', (chunk) => {
      logs += chunk;
    });
    let started = false;
    for (let attempt = 0; attempt < 100; attempt++) {
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
    const aliceContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      serviceWorkers: 'block',
    });
    contexts.push(aliceContext);
    const bobContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
      hasTouch: true,
      isMobile: true,
      serviceWorkers: 'block',
    });
    contexts.push(bobContext);
    for (const [context, username, name] of [
      [aliceContext, `alice${suffix}`, 'Алиса'],
      [bobContext, `bob${suffix}`, 'Борис'],
    ] as const) {
      const response = await context.request.post(`${origin}/api/auth/register`, {
        data: {
          username,
          name,
          password: 'messaging-test-password',
          invite: 'messaging-ui-test-invite',
        },
      });
      expect(response.status()).toBe(201);
      accounts.push((await response.json()).id);
    }
    const alice = await aliceContext.newPage();
    const bob = await bobContext.newPage();
    const pageErrors: string[] = [];
    for (const page of [alice, bob])
      page.on('pageerror', (error) => pageErrors.push(error.message));
    await Promise.all([alice.goto(`${origin}/app`), bob.goto(`${origin}/app`)]);
    await expect(alice.getByRole('textbox', { name: 'Сообщение', exact: true })).toBeVisible();
    await expect(bob.locator('.chat-list .chat-item', { hasText: 'Избранное' })).toBeVisible();

    const group = `Друзья ${suffix}`;
    await alice.getByRole('button', { name: 'Новый чат', exact: true }).click();
    await alice.getByRole('button', { name: 'Новая группа', exact: true }).click();
    await alice.getByLabel('Название группы', { exact: true }).fill(group);
    await alice.getByLabel('Найти пользователя', { exact: true }).fill(`bob${suffix}`);
    await alice.locator('.people-results button', { hasText: `@bob${suffix}` }).click();
    await alice.getByRole('button', { name: 'Создать группу', exact: true }).click();
    await expect(alice.getByRole('dialog')).not.toBeVisible();
    await expect(bob.locator('.chat-list .chat-item', { hasText: group })).toBeVisible();
    await bob.locator('.chat-list .chat-item', { hasText: group }).click();
    const composeAlice = alice.getByRole('textbox', { name: 'Сообщение', exact: true });
    const composeBob = bob.getByRole('textbox', { name: 'Сообщение', exact: true });
    await composeAlice.fill('Привет, это сообщение с компьютера');
    await alice.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
    await expect(
      bob.locator('.bubble p', { hasText: 'Привет, это сообщение с компьютера' }),
    ).toBeVisible();
    await composeBob.fill('Ответ с телефона');
    await bob.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
    await expect(alice.locator('.bubble p', { hasText: 'Ответ с телефона' })).toBeVisible();

    // Commit the first request but lose its response. A retry must use the same nonce.
    const nonces: string[] = [];
    const messageRoute = /\/(?:api|messenger)\/chats\/[^/]+\/messages(?:\?.*)?$/;
    await alice.route(messageRoute, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      nonces.push(route.request().postDataJSON().nonce);
      if (nonces.length === 1) {
        const saved = await route.fetch();
        expect(saved.status()).toBe(201);
        await route.abort('failed');
      } else await route.continue();
    });
    const retryText = `Повтор без дубликата ${suffix}`;
    await composeAlice.fill(retryText);
    await alice.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
    await expect(alice.getByRole('alert')).toContainText('Нет соединения');
    await expect(composeAlice).toHaveValue(retryText);
    await expect(bob.locator('.bubble p', { hasText: retryText })).toBeVisible();
    await alice.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
    await expect(composeAlice).toHaveValue('');
    expect(nonces).toHaveLength(2);
    expect(nonces[1]).toBe(nonces[0]);
    const saved = await db.query(
      'SELECT count(*)::int AS n FROM messages WHERE sender_id=$1 AND body=$2',
      [accounts[0], retryText],
    );
    expect(saved.rows[0].n).toBe(1);
    await alice.unroute(messageRoute);

    // Pause a group upload while editing a different chat's text and attachment.
    let uploadStarted = false;
    const fileRoute = /\/(?:api|messenger)\/chats\/[^/]+\/files$/;
    await alice.route(fileRoute, async (route) => {
      uploadStarted = true;
      await new Promise<void>((resolve) => {
        releaseUpload = resolve;
      });
      await route.continue();
    });
    await composeAlice.fill('Файл для группы');
    await alice.locator('input[type="file"]').setInputFiles({
      name: 'group-note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Shared with friends'),
    });
    await alice.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
    await expect.poll(() => uploadStarted).toBe(true);
    await alice.locator('.chat-list .chat-item', { hasText: 'Избранное' }).click();
    await composeAlice.fill('Личный черновик остаётся здесь');
    await alice.locator('input[type="file"]').setInputFiles({
      name: 'private-note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Private draft'),
    });
    releaseUpload?.();
    await expect(bob.locator('.bubble p', { hasText: 'Файл для группы' })).toBeVisible();
    await expect(bob.locator('.file-attachment', { hasText: 'group-note.txt' })).toBeVisible();
    await expect(composeAlice).toHaveValue('Личный черновик остаётся здесь');
    await expect(alice.locator('.pending-file')).toContainText('private-note.txt');
    await alice.unroute(fileRoute);
    await alice.locator('.chat-list .chat-item', { hasText: group }).click();
    await expect(composeAlice).toHaveValue('');
    await expect(alice.locator('.pending-file')).toHaveCount(0);
    await alice.locator('.chat-list .chat-item', { hasText: 'Избранное' }).click();
    await expect(composeAlice).toHaveValue('Личный черновик остаётся здесь');
    await expect(alice.locator('.pending-file')).toContainText('private-note.txt');
    const files = await db.query('SELECT name FROM files WHERE user_id=$1', [accounts[0]]);
    expect(files.rows.map((row) => row.name)).toEqual(['group-note.txt']);
    expect(pageErrors).toEqual([]);
  } finally {
    releaseUpload?.();
    await Promise.all(contexts.map((context) => context.close()));
    server?.kill('SIGTERM');
    if (server && server.exitCode === null && server.signalCode === null)
      await new Promise((resolve) => server!.once('exit', resolve));
    if (accounts.length) {
      await db.query(
        'DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE owner_id=ANY($1::uuid[]))',
        [accounts],
      );
      await db.query('DELETE FROM files WHERE user_id=ANY($1::uuid[])', [accounts]);
      await db.query('DELETE FROM chats WHERE owner_id=ANY($1::uuid[])', [accounts]);
      await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [accounts]);
    }
    await db.end();
    await rm(directory, { recursive: true, force: true });
  }
});
