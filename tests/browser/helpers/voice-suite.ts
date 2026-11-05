import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

async function voiceChat(page: Page) {
  const self = { id: 'voice-self', username: 'listener', name: 'Слушатель', color: 0 };
  const sender = { id: 'voice-sender', username: 'sender', name: 'Друг', color: 1 };
  const chat = {
    id: 'voice-chat',
    title: 'Голосовые',
    kind: 'group',
    owner_id: self.id,
    member_count: 2,
    peer: null,
    nelya: false,
    unread: 0,
    last_message: null,
    created_at: new Date().toISOString(),
  };
  const messages = ['slow', 'fast'].map((id, i) => ({
    id,
    chat_id: chat.id,
    sender_id: sender.id,
    sender,
    body: '',
    created_at: new Date(Date.now() - 10000 + i * 1000).toISOString(),
    nonce: id,
    reactions: [],
    file: { id, name: `${id}.m4a`, mime: 'audio/mp4', size: 16000 },
  }));
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/files/')) return route.fallback();
    if (url.pathname === '/api/me') return route.fulfill({ json: self });
    if (url.pathname === '/api/chats') return route.fulfill({ json: [chat] });
    if (url.pathname.endsWith('/messages')) return route.fulfill({ json: messages });
    if (url.pathname.endsWith('/members')) return route.fulfill({ json: [self, sender] });
    if (url.pathname.endsWith('/events')) return route.abort();
    if (url.pathname.endsWith('/announcements'))
      return route.fulfill({ json: { items: [], total: 0, page: 1 } });
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/app');
  await page.locator('.chat-item', { hasText: 'Голосовые' }).click();
  await expect(page.locator('.audio-attachment')).toHaveCount(2);
}
async function playsFromClick(player: ReturnType<Page['locator']>) {
  await player.locator('.voice-play').click();
  const audio = player.locator('audio');
  await expect
    .poll(() => audio.evaluate((element) => element.readyState))
    .toBeGreaterThanOrEqual(2);
  // iPhone may require another trusted tap after the first asynchronous fetch.
  if (await audio.evaluate((element) => element.paused)) {
    await expect(player.locator('.voice-status')).toContainText('Нажмите');
    await player.locator('.voice-play').click();
  }
  await expect.poll(() => audio.evaluate((element) => element.currentTime)).toBeGreaterThan(0.1);
  return audio;
}

export function voiceTests() {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  test('loads privately on demand, recovers from a network error and seeks after a trusted tap', async ({
    page,
    context,
  }) => {
    const bytes = await readFile('tests/fixtures/voice-webkit.m4a');
    await context.addCookies([
      {
        name: 'voice-test-session',
        value: 'test-only',
        url: 'http://localhost:5173',
        httpOnly: true,
      },
    ]);
    let requests = 0,
      cookie = false;
    const fixture = createServer((request, response) => {
      requests++;
      cookie = request.headers.cookie?.includes('voice-test-session=test-only') || false;
      response.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      if (requests === 1) {
        response.writeHead(503).end();
        return;
      }
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'audio/mp4', 'content-length': bytes.length });
        response.end(bytes);
      }, 350);
    });
    await new Promise<void>((resolve) => fixture.listen(0, resolve));
    const address = fixture.address();
    if (!address || typeof address === 'string') throw Error('Missing fixture port');
    try {
      await page.route('**/api/files/slow?inline=1', (route) =>
        route.continue({ url: `http://localhost:${address.port}/voice` }),
      );
      await voiceChat(page);
      const player = page.locator('.voice-player').first();
      await expect(player.locator('.voice-time')).toHaveText('—:—');
      expect(requests).toBe(0);
      await player.locator('.voice-play').click();
      await expect(player.getByRole('alert')).toContainText('Не удалось загрузить');
      await expect(
        player.getByRole('button', { name: 'Скачать голосовое', exact: true }),
      ).toBeVisible();
      const audio = await playsFromClick(player);
      expect(cookie).toBe(true);
      expect(requests).toBe(2);
      expect(
        await audio.evaluate(
          (element) => Number.isFinite(element.duration) && element.duration > 1,
        ),
      ).toBe(true);
      await player.locator('.voice-play').click();
      await expect(audio).toHaveJSProperty('paused', true);
      await player.getByRole('slider').fill('0.7');
      await expect
        .poll(() => audio.evaluate((element) => element.currentTime))
        .toBeGreaterThanOrEqual(0.69);
      await player.locator('.voice-speed').click();
      await expect(audio).toHaveJSProperty('playbackRate', 1.5);
      await player.locator('.voice-play').click();
      await expect
        .poll(() => audio.evaluate((element) => element.currentTime))
        .toBeGreaterThan(0.8);
      await expect(player.getByRole('alert')).toHaveCount(0);
    } finally {
      fixture.close();
    }
  });

  test('a slow earlier download cannot interrupt a newer selected voice', async ({ page }) => {
    const bytes = await readFile('tests/fixtures/voice-webkit.m4a');
    const slowStarted = Promise.withResolvers<void>();
    const releaseSlow = Promise.withResolvers<void>();
    const slowFinished = Promise.withResolvers<void>();
    await page.route('**/api/files/*?inline=1', async (route) => {
      if (route.request().url().includes('/slow?')) {
        slowStarted.resolve();
        await releaseSlow.promise;
        await route.fulfill({ contentType: 'audio/mp4', body: bytes }).catch(() => {});
        slowFinished.resolve();
        return;
      }
      await route.fulfill({ contentType: 'audio/mp4', body: bytes }).catch(() => {});
    });
    await voiceChat(page);
    const slow = page.locator('.voice-player').nth(0),
      fast = page.locator('.voice-player').nth(1);
    await slow.locator('.voice-play').click();
    await slowStarted.promise;
    try {
      await playsFromClick(fast);
    } finally {
      releaseSlow.resolve();
    }
    await slowFinished.promise;
    await expect(slow).toHaveAttribute('data-state', 'idle');
    await expect(slow.locator('audio')).toHaveJSProperty('paused', true);
    await expect(slow.locator('audio')).not.toHaveAttribute('src', /.+/);
    await expect(slow.getByRole('alert')).toHaveCount(0);
  });
}
