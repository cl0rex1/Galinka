import { test, expect } from '@playwright/test';

test('file uploads report progress, send session cookies and retain actionable server errors', async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: 'upload-test-session',
      value: 'test-only',
      url: 'http://localhost:5173',
      httpOnly: true,
    },
  ]);
  await page.route('**/api/me', (route) =>
    route.fulfill({ status: 401, json: { error: 'Войдите в Galinka.' } }),
  );
  await page.goto('/app');
  let multipart = false,
    cookie = false;
  await page.route('**/api/upload-test', async (route) => {
    const headers = route.request().headers();
    multipart = headers['content-type'].startsWith('multipart/form-data; boundary=');
    cookie = headers.cookie?.includes('upload-test-session=test-only') || false;
    await route.fulfill({ status: 201, json: { id: 'uploaded' } });
  });
  await page.route('**/api/upload-rejected', (route) =>
    route.fulfill({ status: 413, json: { error: 'Файл слишком большой.' } }),
  );
  await page.route('**/api/upload-stalled', () => {});
  const result = await page.evaluate(async () => {
    const modulePath = '/src/api.ts';
    const { upload } = await import(modulePath);
    const file = new FormData();
    file.append(
      'file',
      new File(['voice-upload-test'.repeat(4096)], 'voice.webm', { type: 'audio/webm' }),
    );
    const progress: number[] = [];
    const data = await upload('/upload-test', file, (value: number) => progress.push(value));
    const readError = async (request: Promise<unknown>) => {
      try {
        await request;
        return { name: 'success', status: -1, message: '' };
      } catch (error) {
        const e = error as Error & { status: number };
        return { name: e.name, status: e.status, message: e.message };
      }
    };
    const rejected = await readError(upload('/upload-rejected', file, () => {}));
    const timedOut = await readError(upload('/upload-stalled', file, () => {}, { timeoutMs: 50 }));
    const controller = new AbortController();
    const waiting = upload('/upload-stalled', file, () => {}, { signal: controller.signal });
    controller.abort();
    const cancelled = await readError(waiting);
    return { data, progress, rejected, timedOut, cancelled };
  });
  expect(multipart).toBe(true);
  expect(cookie).toBe(true);
  expect(result.data.id).toBe('uploaded');
  expect(result.progress[0]).toBe(0);
  expect(result.progress.at(-1)).toBe(100);
  expect(result.progress.every((value: number) => value >= 0 && value <= 100)).toBe(true);
  expect(result.rejected).toMatchObject({ status: 413, message: 'Файл слишком большой.' });
  expect(result.timedOut.status).toBe(0);
  expect(result.timedOut.message).toContain('много времени');
  expect(result.cancelled.name).toBe('AbortError');
});
