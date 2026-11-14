import { useEffect, useRef } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { api, ApiError, API_BASE } from './api';
import type { Message } from './types';

/** Server-sent change. New and edited messages arrive as full rows (since 0.13). */
export type SyncEvent =
  | {
      type: 'message';
      event: 'message.created' | 'message.updated';
      chatId: string;
      messageId: string;
      senderId: string;
      /** Sent without a notification. */
      silent?: boolean;
      message: Message;
    }
  | { type: 'read'; chatId: string; userId?: string; lastMessageId?: string }
  | { type: 'presence'; userId: string }
  | { type: 'typing'; chatId: string; userId: string; name: string; action: TypingAction }
  | { type: 'draft'; chatId: string; draft: string }
  | { type: 'connected' }
  | {
      type: 'refresh';
      chatId?: string;
      deletedId?: string;
      removedUserId?: string;
      event?: string;
      messageId?: string;
      senderId?: string;
    };

export type TypingAction = 'typing' | 'voice' | 'video';
/** Who is typing or recording in each chat, until when (ms). */
export type Typing = Record<
  string,
  { userId: string; name: string; action: TypingAction; until: number }[]
>;

/** What still has to be fetched after an event was applied locally. */
export type Refetch = { list: boolean; conversation: boolean };

/**
 * The live-events connection. Each event goes to `onEvent`, which applies what it
 * can in place and returns what must be refetched; refetches are batched over 100 ms.
 * The stream is reopened after a failure, on returning to the app and when it goes silent;
 * missed events are recovered on every reconnect, on focus and every 30 s.
 */
export function useSync(
  enabled: boolean,
  handlers: {
    onEvent: (event: SyncEvent) => Refetch;
    refetch: (what: Refetch) => void;
    onConnected: (connected: boolean) => void;
    onSessionLost: (error: ApiError) => void;
  },
) {
  const handlerRef = useRef(handlers);
  handlerRef.current = handlers;
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending: Refetch = { list: false, conversation: false };
    const schedule = (what: Refetch) => {
      if (!live) return;
      pending.list ||= what.list;
      pending.conversation ||= what.conversation;
      if (timer || !(pending.list || pending.conversation)) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (!live) return;
        const batch = { ...pending };
        pending.list = pending.conversation = false;
        handlerRef.current.refetch(batch);
      }, 100);
    };
    const everything = () => schedule({ list: true, conversation: true });
    let events: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;
    let opened = false;
    // The server pings every 25 s. A phone that slept or changed network can be left with a
    // socket that looks open and never delivers again; silence for this long means it is dead.
    let lastHeard = Date.now();
    const heard = () => {
      lastHeard = Date.now();
    };
    let checkingSession = false;
    function connect() {
      clearTimeout(retry);
      events?.close();
      const source = new EventSource(`${API_BASE}/events`, { withCredentials: true });
      events = source;
      heard();
      source.onopen = () => {
        if (source !== events || !live) return;
        delay = 1000;
        heard();
        handlerRef.current.onConnected(true);
        // Whatever was said while the stream was down is not coming through it.
        if (opened) everything();
        opened = true;
      };
      source.onmessage = (event) => {
        if (source !== events || !live) return;
        heard();
        handlerRef.current.onConnected(true);
        let change: SyncEvent;
        try {
          change = JSON.parse(event.data);
        } catch {
          return everything();
        }
        schedule(handlerRef.current.onEvent(change));
      };
      source.addEventListener('ping', heard);
      source.onerror = () => {
        if (source !== events || !live) return;
        handlerRef.current.onConnected(false);
        // The browser retries a dropped connection by itself, but after an HTTP error (a proxy
        // 502 during a deploy, 429, 401) it closes the stream for good: reopen it ourselves.
        if (source.readyState === 2 /* CLOSED */) {
          retry = setTimeout(connect, delay);
          delay = Math.min(delay * 2, 30000);
        }
        if (checkingSession) return;
        checkingSession = true;
        api('/me')
          .catch((e) => {
            if (live && e instanceof ApiError && e.status === 401)
              handlerRef.current.onSessionLost(e);
          })
          .finally(() => {
            checkingSession = false;
          });
      };
    }
    connect();
    let hiddenAt = 0;
    /** Back in the foreground: a socket that slept is rarely alive, so start a new one. */
    const resumed = () => {
      if (!live) return;
      if (Date.now() - hiddenAt > 3000) connect();
      everything();
    };
    const visible = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else resumed();
    };
    const online = () => {
      connect();
      everything();
    };
    const offline = () => handlerRef.current.onConnected(false);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    // The app shell on a phone reports foreground and background itself, and not always as page
    // visibility.
    let nativeListener: { remove: () => Promise<void> } | undefined;
    void NativeApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) resumed();
      else hiddenAt = Date.now();
    })
      .then((handle) => {
        if (live) nativeListener = handle;
        else void handle.remove();
      })
      .catch(() => {});
    // Safety net while visible: missed events come back by polling, and a silent stream is replaced.
    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastHeard > 70000) {
        handlerRef.current.onConnected(false);
        connect();
      }
      everything();
    }, 30000);
    return () => {
      live = false;
      events?.close();
      clearTimeout(timer);
      clearTimeout(retry);
      clearInterval(interval);
      void nativeListener?.remove();
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [enabled]);
}
