import { test, expect, type Page } from '@playwright/test';

test('touch gestures reply and return to chats without losing a draft or hijacking vertical scrolling', async ({
  browser,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Uses Chromium real touch input through CDP.');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const touch = await context.newCDPSession(page);
  async function swipe(x: number, y: number, dx: number, dy: number) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 8; step++) {
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + (dx * step) / 8, y: y + (dy * step) / 8 }],
      });
      await page.waitForTimeout(16);
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  try {
    await page.goto('/?demo=1');
    await page.getByRole('button', { name: /На выходные/ }).click();
    const input = page.getByRole('textbox', { name: 'Сообщение', exact: true });
    await input.fill('Сообщение для жеста');
    await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
    const bubble = page.locator('.bubble').filter({ hasText: 'Сообщение для жеста' }).last();
    await expect(bubble).toBeVisible();
    const box = (await bubble.boundingBox())!;
    await swipe(box.x + 28, box.y + box.height / 2, 90, 1);
    await expect(page.locator('.composer-context')).toContainText('Сообщение для жеста');
    await input.fill('Черновик после свайпа');
    await input.blur();
    const area = (await page.locator('.messages').boundingBox())!;
    await swipe(15, area.y + area.height / 2, 135, 3);
    await expect(page.getByRole('button', { name: /На выходные/ })).toBeVisible();
    await page.getByRole('button', { name: /На выходные/ }).click();
    await expect(input).toHaveValue('Черновик после свайпа');
    await page.getByRole('button', { name: 'Отменить ответ', exact: true }).click();
    await swipe(box.x + 28, box.y - 15, 3, -90);
    await expect(page.locator('.composer-context')).toHaveCount(0);
    await expect(input).toHaveValue('Черновик после свайпа');
    expect(await page.locator('[data-swiping]').count()).toBe(0);
  } finally {
    await context.close();
  }
});

const userId = '10000000-0000-4000-8000-000000000001';
async function signedIn(page: Page) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json =
      path === '/api/me'
        ? { id: userId, name: 'Тест', username: 'test', color: 1 }
        : path === '/api/chats' || path === '/api/announcements'
          ? []
          : path === '/api/version'
            ? { version: '0.0.0' }
            : path === '/api/push/status'
              ? {
                  enabled: false,
                  browserAvailable: true,
                  publicKey:
                    'BCFVN2U1jEf70fxHsCx1vl-MJVmTSL5tAKvy23R58rUugFE2uYuYVZFndGbJF08wk4RGgXZP1jwdPV1tmPWIFXY',
                }
              : { ok: true };
    if (path === '/api/events')
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': ready\n\n' });
    await route.fulfill({ json });
  });
  await page.goto('/app');
  await page
    .getByRole('button', { name: 'Настройки', exact: true })
    .filter({ visible: true })
    .click();
}

test('browser push asks permission only on click, registers this session, and removes the subscription when disabled', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = { requests: 0, subscribes: 0, unsubscribes: 0, registered: 0 };
    (window as unknown as { pushTest: typeof state }).pushTest = state;
    let permission: NotificationPermission = 'default';
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: class {
        static get permission() {
          return permission;
        }
        static async requestPermission() {
          state.requests++;
          permission = 'granted';
          return permission;
        }
      },
    });
    let subscription: object | null = null;
    const registration = {
      update: async () => {},
      getNotifications: async () => [],
      pushManager: {
        getSubscription: async () => subscription,
        subscribe: async () => {
          state.subscribes++;
          subscription = {
            endpoint: 'https://fcm.googleapis.com/fcm/send/example',
            toJSON: () => ({
              endpoint: 'https://fcm.googleapis.com/fcm/send/example',
              keys: { p256dh: 'example', auth: 'example' },
            }),
            unsubscribe: async () => {
              state.unsubscribes++;
              subscription = null;
              return true;
            },
          };
          return subscription;
        },
      },
    };
    Object.defineProperty(window, 'PushManager', { configurable: true, value: class {} });
    const serviceWorker = Object.assign(new EventTarget(), {
      ready: Promise.resolve(registration),
      controller: null,
      register: async () => {
        state.registered++;
        return registration;
      },
      getRegistration: async () => registration,
    });
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });
  });
  await signedIn(page);
  const toggle = page.getByRole('switch', { name: 'Пуш-уведомления' });
  await expect(toggle).toBeEnabled();
  expect(await page.evaluate(() => (window as any).pushTest.requests)).toBe(0);
  const subscribe = page.waitForRequest(
    (request) => request.url().endsWith('/push/subscriptions') && request.method() === 'POST',
  );
  await toggle.click();
  expect((await subscribe).postDataJSON()).toHaveProperty(
    'endpoint',
    'https://fcm.googleapis.com/fcm/send/example',
  );
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  const unsubscribe = page.waitForRequest(
    (request) => request.url().endsWith('/push/subscriptions') && request.method() === 'DELETE',
  );
  await toggle.click();
  await unsubscribe;
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  // The switch reads "off" while busy; wait until the operation finishes.
  await expect(toggle).toBeEnabled();
  expect(await page.evaluate(() => (window as any).pushTest)).toMatchObject({
    requests: 1,
    subscribes: 1,
    unsubscribes: 1,
  });
});

test('iPhone browser explains installation instead of asking for unavailable push permission', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await signedIn(page);
    await expect(page.locator('.notification-settings')).toContainText('экран «Домой»');
    await expect(page.getByRole('switch', { name: 'Пуш-уведомления' })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
