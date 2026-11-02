import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { syntheticMicrophone } from './helpers/media';

test.use({ actionTimeout: 10000 });

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

test('real messenger features synchronize replies, edits, media and group permissions while preferences stay personal', async ({
  browser,
}) => {
  test.skip(!process.env.TEST_DATABASE_URL, 'Set TEST_DATABASE_URL and run npm run build first.');
  test.setTimeout(90000);
  const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const directory = await mkdtemp(path.join(tmpdir(), 'galinka-features-ui-'));
  const accounts: string[] = [];
  const contexts: BrowserContext[] = [];
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const suffix = randomUUID().slice(0, 8);
  let server: ChildProcess | undefined;
  let logs = '';
  try {
    server = spawn(process.execPath, ['dist-server/index.js'], {
      env: {
        ...process.env,
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        PORT: String(port),
        APP_ORIGIN: origin,
        INVITE_CODE: 'features-browser-test-invite',
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
    const bobContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
      isMobile: true,
      hasTouch: true,
      serviceWorkers: 'block',
    });
    const carolContext = await browser.newContext({ serviceWorkers: 'block' });
    contexts.push(aliceContext, bobContext, carolContext);
    for (const [context, username, name] of [
      [aliceContext, `featurea${suffix}`, 'Алиса'],
      [bobContext, `featureb${suffix}`, 'Борис'],
      [carolContext, `featurec${suffix}`, 'Катя'],
    ] as const) {
      const result = await context.request.post(`${origin}/api/auth/register`, {
        data: {
          username,
          name,
          password: 'features-test-password',
          invite: 'features-browser-test-invite',
        },
      });
      expect(result.status()).toBe(201);
      accounts.push((await result.json()).id);
    }
    const groupName = `Компания ${suffix}`;
    const created = await aliceContext.request.post(`${origin}/api/chats`, {
      data: { kind: 'group', title: groupName, userIds: [accounts[1]] },
    });
    expect(created.status()).toBe(201);
    const chatId = (await created.json()).id;
    const original = `Встречаемся в субботу ${suffix}`;
    const seeded = await aliceContext.request.post(`${origin}/api/chats/${chatId}/messages`, {
      data: { body: original, nonce: randomUUID() },
    });
    expect(seeded.status()).toBe(201);
    const alice = await aliceContext.newPage(),
      bob = await bobContext.newPage();
    await syntheticMicrophone(alice);
    const pageErrors: string[] = [],
      rateErrors: string[] = [];
    for (const page of [alice, bob]) {
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('response', (response) => {
        if (response.status() === 429) rateErrors.push(response.url());
      });
    }
    await Promise.all([alice.goto(`${origin}/app`), bob.goto(`${origin}/app`)]);
    await bob.locator('.chat-item', { hasText: groupName }).click();
    await expect(alice.locator('.chat-header')).toContainText(groupName);
    await expect(bob.locator('.bubble > p', { hasText: original })).toBeVisible();
    const originalAlice = alice
      .locator('.message-row.own')
      .filter({ has: alice.locator('.bubble > p', { hasText: original }) });
    await expect(originalAlice.locator('.read-receipt')).toHaveAttribute(
      'aria-label',
      'Прочитали: 1',
    );

    const originalBob = bob
      .locator('.message-row')
      .filter({ has: bob.locator('.bubble > p', { hasText: original }) });
    await originalBob.locator('summary').click();
    await originalBob.getByRole('button', { name: 'Ответить', exact: true }).click();
    await expect(bob.locator('.composer-context')).toContainText('Ответ для Алиса');
    const answer = `Буду к шести ${suffix}`;
    await bob.getByRole('textbox', { name: 'Сообщение', exact: true }).fill(answer);
    await bob.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
    const answerAlice = alice
      .locator('.message-row')
      .filter({ has: alice.locator('.bubble > p', { hasText: answer }) });
    await expect(answerAlice.locator('.message-quote')).toContainText(original);
    await expect(answerAlice.locator('.message-quote')).toContainText('Алиса');

    await originalAlice.locator('summary').click();
    await originalAlice.getByRole('button', { name: 'Редактировать', exact: true }).click();
    const corrected = `Встречаемся в воскресенье ${suffix}`;
    await alice.getByRole('textbox', { name: 'Сообщение', exact: true }).fill(corrected);
    await alice.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
    const correctedBob = bob
      .locator('.message-row')
      .filter({ has: bob.locator('.bubble > p', { hasText: corrected }) });
    await expect(correctedBob.locator('.message-edited')).toHaveText('изменено');
    await expect(bob.locator('.message-quote')).toContainText(corrected);

    async function chatAction(page: Page, label: string) {
      await page.locator('.chat-actions > summary').click();
      await page.locator('.chat-actions').getByRole('button', { name: label, exact: true }).click();
    }
    await chatAction(alice, 'Закрепить чат');
    await expect(
      alice.locator('.chat-item', { hasText: groupName }).getByLabel('Закреплён'),
    ).toBeVisible();
    await chatAction(alice, 'Без уведомлений');
    await expect(
      alice.locator('.chat-item', { hasText: groupName }).getByLabel('Без уведомлений'),
    ).toBeVisible();
    await chatAction(alice, 'В архив');
    await expect(alice.locator('.chat-item', { hasText: groupName })).toHaveCount(0);
    await expect(bob.locator('.chat-header')).toContainText(groupName);
    const bobChats = await (await bobContext.request.get(`${origin}/api/chats`)).json();
    const peer = bobChats.find((chat: { id: string }) => chat.id === chatId);
    expect([peer.pinned, peer.muted, peer.archived]).toEqual([false, false, false]);
    await alice.reload();
    await alice.locator('.archive-link').click();
    const archived = alice.locator('.chat-item', { hasText: groupName });
    await expect(archived.getByLabel('Закреплён')).toBeVisible();
    await expect(archived.getByLabel('Без уведомлений')).toBeVisible();
    await archived.click();
    await chatAction(alice, 'Вернуть из архива');
    await expect(alice.locator('.chat-item', { hasText: groupName })).toHaveCount(0);
    await alice.locator('.archive-link').click();
    await expect(alice.locator('.chat-item', { hasText: groupName })).toBeVisible();

    const imageBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    );
    await alice
      .locator('input[type="file"]')
      .setInputFiles({ name: 'friends.png', mimeType: 'image/png', buffer: imageBytes });
    await alice.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
    const preview = bob.getByRole('button', { name: 'Открыть фото friends.png', exact: true });
    await expect(preview.locator('img')).toHaveJSProperty('naturalWidth', 1);
    await preview.click();
    const lightbox = bob.getByRole('dialog', { name: 'Просмотр фото friends.png', exact: true });
    await expect(lightbox).toBeVisible();
    await expect(lightbox.locator('.media-full-image')).toHaveJSProperty('naturalWidth', 1);
    await lightbox.getByRole('button', { name: 'Закрыть фотографию', exact: true }).click();
    await expect(lightbox).not.toBeVisible();

    // Exercise the full private media path with this engine's real audio encoder.
    // Bob receives the uploaded recording through SSE and loads it with his own session.
    await alice.getByRole('button', { name: 'Записать голосовое сообщение', exact: true }).click();
    await expect(alice.locator('.recording-time')).toHaveText('00:01', { timeout: 10000 });
    await alice.getByRole('button', { name: 'Завершить запись', exact: true }).click();
    await expect(alice.locator('.pending-file')).toContainText('Голосовое-');
    await alice.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
    const voice = bob.locator('.audio-attachment audio');
    await expect(voice).toBeVisible();
    await expect
      .poll(() => voice.evaluate((element) => element.readyState))
      .toBeGreaterThanOrEqual(1);
    expect(
      await alice.evaluate(
        () => (window as unknown as { testStreams: MediaStream[] }).testStreams.length,
      ),
    ).toBe(1);
    const recording = await db.query(
      'SELECT id,mime FROM files WHERE chat_id=$1 AND mime LIKE $2',
      [chatId, 'audio/%'],
    );
    expect(recording.rows).toHaveLength(1);
    expect(['audio/webm', 'audio/mp4', 'audio/ogg']).toContain(recording.rows[0].mime);
    await test.info().attach('voice-playback.json', {
      body: JSON.stringify({
        browser: browser.browserType().name(),
        mime: recording.rows[0].mime,
        readyState: await voice.evaluate((element) => element.readyState),
      }),
      contentType: 'application/json',
    });
    const audioUrl = `${origin}/api/files/${recording.rows[0].id}?inline=1`;
    const range = await bobContext.request.get(audioUrl, { headers: { Range: 'bytes=0-15' } });
    expect(range.status()).toBe(206);
    expect(range.headers()['content-type']).toContain(recording.rows[0].mime);
    expect(range.headers()['content-range']).toMatch(/^bytes 0-15\//);
    expect((await carolContext.request.get(audioUrl)).status()).toBe(404);

    await chatAction(alice, 'Управление группой');
    const settings = alice.getByRole('dialog', { name: 'Управление группой', exact: true });
    const renamed = `Близкие друзья ${suffix}`;
    await settings.getByLabel('Название группы', { exact: true }).fill(renamed);
    await settings.getByRole('button', { name: 'Сохранить название', exact: true }).click();
    await expect(bob.locator('.chat-header')).toContainText(renamed);
    await settings.getByLabel('Найти пользователя', { exact: true }).fill(`featurec${suffix}`);
    await settings.locator('.people-results button', { hasText: `@featurec${suffix}` }).click();
    await settings.getByRole('button', { name: 'Добавить выбранных (1)', exact: true }).click();
    await expect(settings.locator('.group-member-row', { hasText: 'Катя' })).toBeVisible();
    await settings.getByRole('button', { name: 'Удалить участника: Борис', exact: true }).click();
    await settings.getByRole('button', { name: 'Удалить участника', exact: true }).click();
    await expect(bob.locator('.chat-header')).toHaveCount(0);
    await expect(bob.locator('.message-row')).toHaveCount(0);
    await expect(bob.locator('.chat-item', { hasText: renamed })).toHaveCount(0);
    await settings.getByRole('button', { name: 'Сделать владельцем: Катя', exact: true }).click();
    await settings.getByRole('button', { name: 'Передать владение', exact: true }).click();
    await expect(settings.getByLabel('Название группы', { exact: true })).toHaveCount(0);
    await expect(settings.locator('.group-member-row', { hasText: 'Катя' })).toContainText(
      'Владелец',
    );
    await settings.getByRole('button', { name: 'Выйти из группы', exact: true }).click();
    await settings.getByRole('button', { name: 'Выйти из группы', exact: true }).click();
    await expect(settings).not.toBeVisible();
    await expect(alice.locator('.chat-header')).toHaveCount(0);
    await expect(alice.locator('.chat-item', { hasText: renamed })).toHaveCount(0);
    expect(
      (await db.query('SELECT owner_id FROM chats WHERE id=$1', [chatId])).rows[0].owner_id,
    ).toBe(accounts[2]);
    expect(pageErrors).toEqual([]);
    expect(rateErrors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    server?.kill('SIGTERM');
    if (server && server.exitCode === null && server.signalCode === null)
      await new Promise((resolve) => server!.once('exit', resolve));
    if (accounts.length) {
      await db.query('DELETE FROM chats WHERE owner_id=ANY($1::uuid[])', [accounts]);
      await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [accounts]);
    }
    await db.end();
    await rm(directory, { recursive: true, force: true });
  }
});
