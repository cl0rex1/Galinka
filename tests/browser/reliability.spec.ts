import { test, expect } from '@playwright/test';

const admin = {
  id: 'admin-test',
  username: 'administrator',
  name: 'Администратор',
  color: 0,
  role: 'admin',
};

test('API rejects invalid responses, times out stalled requests and distinguishes cancellation', async ({
  page,
}) => {
  await page.route('**/api/me', (route) =>
    route.fulfill({ status: 401, json: { error: 'Войдите в Galinka.' } }),
  );
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Вход', exact: true })).toBeVisible();
  await page.route('**/api/broken-success', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Proxy error</html>' }),
  );
  await page.route('**/api/broken-auth', (route) =>
    route.fulfill({ status: 401, contentType: 'text/html', body: '<html>Unauthorized</html>' }),
  );
  await page.route('**/api/stalled', () => {});
  const result = await page.evaluate(async () => {
    const modulePath = '/src/api.ts';
    const { api } = await import(modulePath);
    const readError = async (request: Promise<unknown>) => {
      try {
        await request;
        return { status: -1, name: 'success', message: '' };
      } catch (error) {
        const value = error as Error & { status?: number };
        return { status: value.status, name: value.name, message: value.message };
      }
    };
    const invalid = await readError(api('/broken-success'));
    const unauthorized = await readError(api('/broken-auth'));
    const timeout = await readError(api('/stalled', 'GET', undefined, { timeoutMs: 50 }));
    const controller = new AbortController();
    const pending = api('/stalled', 'GET', undefined, { signal: controller.signal });
    controller.abort();
    const cancelled = await readError(pending);
    return { invalid, unauthorized, timeout, cancelled };
  });
  expect(result.invalid.status).toBe(502);
  expect(result.invalid.message).toContain('некорректный ответ');
  expect(result.unauthorized.status).toBe(401);
  expect(result.timeout.status).toBe(0);
  expect(result.timeout.message).toContain('долго не отвечает');
  expect(result.cancelled.name).toBe('AbortError');
});

test('admin search keeps the latest results when an earlier response arrives late', async ({
  page,
}) => {
  let releaseOld: (() => void) | undefined;
  let oldStarted = false;
  let oldFinished = false;
  await page.route('**/api/me', (route) => route.fulfill({ json: admin }));
  await page.route('**/api/admin/users?*', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q');
    if (query === 'al') {
      oldStarted = true;
      await new Promise<void>((resolve) => {
        releaseOld = resolve;
      });
      await route
        .fulfill({
          json: {
            items: [{ ...admin, id: 'old', username: 'alice', name: 'Алиса' }],
            total: 1,
            page: 1,
          },
        })
        .catch(() => {});
      oldFinished = true;
    } else {
      await route.fulfill({
        json: {
          items:
            query === 'alex' ? [{ ...admin, id: 'new', username: 'alex', name: 'Алексей' }] : [],
          total: query ? 1 : 0,
          page: 1,
        },
      });
    }
  });
  await page.goto('/admin');
  const search = page.getByRole('searchbox', { name: 'Поиск пользователей' });
  await search.fill('al');
  await expect.poll(() => oldStarted).toBe(true);
  await search.fill('alex');
  await expect(page.getByRole('cell', { name: 'Алексей @alex' })).toBeVisible();
  releaseOld?.();
  await expect.poll(() => oldFinished).toBe(true);
  await expect(page.getByRole('cell', { name: 'Алиса @alice' })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'Алексей @alex' })).toBeVisible();
});
