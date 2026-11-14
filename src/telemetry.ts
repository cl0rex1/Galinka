import { api, isDemo } from './api';

declare const __BUILD_ID__: string;

const reported = new Set<string>();
let installed = false;

/** Send a deduplicated client error report to the server (up to 50 unique entries per session). */
export function reportClientError(message: string, stack = '') {
  if (typeof window === 'undefined' || isDemo()) return;
  const text = message.trim().slice(0, 1000);
  if (!text) return;
  const key = `${text}|${stack.split('\n')[0] || ''}`;
  if (reported.has(key) || reported.size >= 50) return;
  reported.add(key);
  void api('/client-errors', 'POST', {
    message: text,
    stack: stack.slice(0, 8000),
    url: `${location.pathname}${location.search}`.slice(0, 500),
    release: typeof __BUILD_ID__ === 'string' ? __BUILD_ID__.slice(0, 80) : '',
  }).catch(() => {});
}

/** Attach global window error and unhandled promise rejection listeners once. */
export function installErrorReporter() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (event) => {
    const message = event.message || String(event.error || 'Unknown error');
    const stack =
      event.error instanceof Error
        ? event.error.stack || ''
        : event.filename
          ? `${event.filename}:${event.lineno}:${event.colno}`
          : '';
    reportClientError(message, stack);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason || 'Unhandled rejection');
    const stack = reason instanceof Error ? reason.stack || '' : '';
    reportClientError(message, stack);
  });
}
