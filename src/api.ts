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

/** Upload a file with real byte progress; keep the browser's multipart boundary. */
export async function upload<T>(
  url: string,
  body: FormData,
  onProgress: (percent: number) => void,
  options: RequestOptions = {},
): Promise<T> {
  if (options.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
  onProgress(0);
  if (isDemo() && !location.pathname.startsWith('/admin')) {
    const result = await api<T>(url, 'POST', body, options);
    if (options.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    onProgress(100);
    return result;
  }
  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();
    let settled = false;
    const cleanup = () => {
      settled = true;
      options.signal?.removeEventListener('abort', cancel);
      request.upload.onprogress = null;
      request.onload = request.onerror = request.ontimeout = request.onabort = null;
    };
    const fail = (error: Error) => {
      if (!settled) {
        cleanup();
        reject(error);
      }
    };
    const cancel = () => request.abort();
    request.open('POST', `${API_BASE}${url}`);
    request.withCredentials = true;
    request.timeout = options.timeoutMs ?? 120_000;
    request.upload.onprogress = (event) => {
      if (!settled && event.lengthComputable && event.total > 0)
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    request.onerror = () =>
      fail(new ApiError('Нет соединения с сервером. Проверьте интернет и повторите попытку.', 0));
    request.ontimeout = () =>
      fail(
        new ApiError(
          'Загрузка заняла слишком много времени. Проверьте соединение и повторите попытку.',
          0,
        ),
      );
    request.onabort = () => fail(new DOMException('Request cancelled', 'AbortError'));
    request.onload = () => {
      if (settled) return;
      let result: unknown;
      try {
        result = request.status === 204 ? undefined : JSON.parse(request.responseText);
      } catch {
        fail(
          new ApiError(
            'Сервер вернул некорректный ответ. Попробуйте ещё раз.',
            request.status >= 200 && request.status < 300 ? 502 : request.status,
          ),
        );
        return;
      }
      if (request.status < 200 || request.status >= 300) {
        const message =
          result &&
          typeof result === 'object' &&
          'error' in result &&
          typeof result.error === 'string'
            ? result.error
            : 'Не удалось загрузить файл.';
        fail(new ApiError(message, request.status));
        return;
      }
      cleanup();
      onProgress(100);
      resolve(result as T);
    };
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      request.send(body);
    } catch {
      fail(new ApiError('Не удалось начать загрузку файла. Повторите попытку.', 0));
    }
  });
}
