import { demoRequest } from './demo';
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export const API_BASE = import.meta.env.VITE_API_BASE || '/api';
export function isDemo() {
  return sessionStorage.getItem('galinka-demo') === 'true';
}
type RequestOptions = { signal?: AbortSignal; timeoutMs?: number };
export async function api<T>(
  url: string,
  method = 'GET',
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  if (options.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
  if (isDemo() && !location.pathname.startsWith('/admin'))
    return demoRequest(url, method, body) as Promise<T>;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  // Uploads need more time on mobile connections. Bound the whole response, including its body.
  const timeout = setTimeout(
    cancel,
    options.timeoutMs ?? (body instanceof FormData ? 120_000 : method === 'GET' ? 20_000 : 30_000),
  );
  try {
    const response = await fetch(`${API_BASE}${url}`, {
      method,
      signal: controller.signal,
      credentials: 'include',
      headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) return undefined as T;
    let result: unknown;
    try {
      result = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new ApiError(
        'Сервер вернул некорректный ответ. Попробуйте ещё раз.',
        response.ok ? 502 : response.status,
      );
    }
    if (!response.ok) {
      const message =
        result &&
        typeof result === 'object' &&
        'error' in result &&
        typeof result.error === 'string'
          ? result.error
          : 'Не удалось выполнить запрос.';
      throw new ApiError(message, response.status);
    }
    return result as T;
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted)
      throw new ApiError('Сервер долго не отвечает. Проверьте соединение и повторите попытку.', 0);
    throw new ApiError('Нет соединения с сервером. Проверьте интернет и повторите попытку.', 0);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
  }
}
