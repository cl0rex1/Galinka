import { useEffect, useRef } from 'react';
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
      message: Message;
    }
  | { type: 'read'; chatId: string; userId?: string; lastMessageId?: string }
  | { type: 'presence'; userId: string }
  | { type: 'typing'; chatId: string; userId: string; name: string; action: TypingAction }
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
 * Missed events are recovered on focus, on reconnecting to the network and every 30 s.
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
    const events = new EventSource(`${API_BASE}/events`, { withCredentials: true });
    events.onmessage = (event) => {
      if (!live) return;
      handlerRef.current.onConnected(true);
      let change: SyncEvent;
      try {
        change = JSON.parse(event.data);
      } catch {
        return everything();
      }
      schedule(handlerRef.current.onEvent(change));
    };
    let checkingSession = false;
    events.onerror = () => {
      if (!live) return;
      handlerRef.current.onConnected(false);
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
    const visible = () => {
      if (document.visibilityState === 'visible') everything();
    };
    const offline = () => handlerRef.current.onConnected(false);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', everything);
    window.addEventListener('offline', offline);
    // Recover missed events and unread state after background suspension or a proxy interruption.
    const interval = setInterval(visible, 30000);
    return () => {
      live = false;
      events.close();
      clearTimeout(timer);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('online', everything);
      window.removeEventListener('offline', offline);
    };
  }, [enabled]);
}
