import { useSyncExternalStore } from 'react';

/** The voice message or round video playing in the feed, for the mini-player above the chat. */
export type NowPlaying = { element: HTMLMediaElement; label: string };
let current: NowPlaying | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function setNowPlaying(next: NowPlaying | null) {
  if (current?.element === next?.element && current?.label === next?.label) return;
  current = next;
  emit();
}
/** Forget the element if it is the one shown (it ended, or its bubble left the screen). */
export function clearNowPlaying(element: HTMLMediaElement) {
  if (current?.element === element) setNowPlaying(null);
}
export function useNowPlaying() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

/**
 * As in Telegram: when a voice message or round video ends, the next one in the feed starts.
 * Players mark their play button with `data-sequence`; the order is the feed's DOM order.
 * Returns false when there is no next one.
 */
export function playNext(element: HTMLMediaElement) {
  const feed = element.closest('.messages');
  if (!feed) return false;
  const buttons = [...feed.querySelectorAll<HTMLButtonElement>('[data-sequence]')];
  const index = buttons.findIndex((button) =>
    button.closest('[data-sequence-item]')?.contains(element),
  );
  const next = index >= 0 ? buttons[index + 1] : undefined;
  if (!next) return false;
  next.closest('[data-sequence-item]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  next.click();
  return true;
}
