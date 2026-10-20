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
export async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  if (isDemo()) return demoRequest(url, method, body) as Promise<T>;
  const response = await fetch(`${API_BASE}${url}`, {
    method,
    credentials: 'include',
    headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response
    .json()
    .catch(() => ({ error: 'Сервер недоступен. Попробуйте ещё раз.' }));
  if (!response.ok)
    throw new ApiError(result.error || 'Не удалось выполнить запрос.', response.status);
  return result as T;
}
