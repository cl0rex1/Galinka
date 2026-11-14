import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type WheelEvent,
} from 'react';
import { flushSync } from 'react-dom';
import { api, ApiError } from './api';
import { firstUnread, reconcileMessages, type CachedConversation } from './conversation';
import { closeMenu, motionAllowed } from './ui';
import type { Chat, Message, Person } from './types';

type ConversationOptions = {
  me: Person | null;
  activeId: string | null;
  active: Chat | undefined;
  section: string;
  ready: boolean;
  infoOpen: boolean;
  groupModalOpen: boolean;
  composerLayoutKey: string;
  chatsRef: MutableRefObject<Chat[]>;
  activeRef: MutableRefObject<string | null>;
  sectionRef: MutableRefObject<string>;
  refreshChats: () => Promise<Chat[]>;
  report: (error: unknown) => void;
  onError: (message: string) => void;
  onChatOpened?: () => void;
};

/** Owns the active conversation's messages, members, caching, scroll behavior and pagination. */
export function useConversation({
  me,
  activeId,
  active,
  section,
  ready,
  infoOpen,
  groupModalOpen,
  composerLayoutKey,
  chatsRef,
  activeRef,
  sectionRef,
  refreshChats,
  report,
  onError,
  onChatOpened,
}: ConversationOptions) {
  const [messages, setMessages] = useState<Message[]>([]),
    [members, setMembers] = useState<Person[]>([]),
    [awayFromBottom, setAwayFromBottom] = useState(false),
    [newMessageIds, setNewMessageIds] = useState<string[]>([]),
    /** The first message that was unread when the chat was opened; the divider goes above it. */
    [unreadFrom, setUnreadFrom] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [hasOlder, setHasOlder] = useState(false),
    [paging, setPaging] = useState(false);

  const conversationCache = useRef(new Map<string, CachedConversation>());
  const cacheOwner = useRef<string | null>(null);
  const cachedScroll = useRef<{
    id: string;
    top: number;
    following: boolean;
    messages: Message[];
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null),
    scroller = useRef<HTMLDivElement>(null),
    requestEpoch = useRef(0),
    lastRead = useRef<Record<string, string>>({}),
    messagesRef = useRef(messages),
    olderRequest = useRef<{ id: string; promise: Promise<boolean> } | null>(null),
    lastScrollTop = useRef(0),
    scrollRestore = useRef<{ id: string; top: number; height: number } | null>(null),
    followBottom = useRef(true),
    jumpingToLatest = useRef(false),
    autoScroll = useRef(false),
    glide = useRef<{ id: string | null; last?: string; height: number }>({
      id: null,
      height: 0,
    });
  const onChatOpenedRef = useRef(onChatOpened);
  onChatOpenedRef.current = onChatOpened;
  messagesRef.current = messages;

  const markRead = useCallback(
    async (id: string, lastMessageId: string) => {
      if (
        activeRef.current !== id ||
        !followBottom.current ||
        sectionRef.current !== 'chats' ||
        document.visibilityState !== 'visible' ||
        lastRead.current[id] === lastMessageId
      )
        return;
      lastRead.current[id] = lastMessageId;
      try {
        await api(`/chats/${id}/read`, 'POST', { lastMessageId });
        // Refresh instead of clearing the count blindly: a newer message may have arrived meanwhile.
        await refreshChats();
      } catch (e) {
        if (lastRead.current[id] === lastMessageId) delete lastRead.current[id];
        if (e instanceof ApiError && e.status === 401) report(e);
      }
    },
    [activeRef, sectionRef, refreshChats, report],
  );

  const loadMessages = useCallback(
    async (id: string, reset = false) => {
      if (activeRef.current !== id) return;
      const epoch = ++requestEpoch.current;
      const data = await api<Message[]>(`/chats/${id}/messages`);
      if (activeRef.current !== id || epoch !== requestEpoch.current) return;
      const previous = messagesRef.current;
      const latest = previous.at(-1);
      const freshIds =
        !reset && latest
          ? data
              .filter(
                (m) =>
                  !previous.some(
                    (old) => old.id === m.id || (old.pending && old.nonce === m.nonce),
                  ) && m.created_at >= latest.created_at,
              )
              .map((m) => m.id)
          : [];
      setNewMessageIds((previousIds) =>
        previousIds.length === freshIds.length &&
        previousIds.every((messageId, index) => messageId === freshIds[index])
          ? previousIds
          : freshIds,
      );
      const boundary = data.length ? previous.findIndex((m) => m.id === data[0].id) : -1;
      setMessages((prev) => {
        // Messages still on their way stay at the end until the server returns them.
        const local = prev.filter((m) => m.pending && !data.some((d) => d.nonce === m.nonce));
        if (reset || data.length < 60) return reconcileMessages(prev, [...data, ...local]);
        const overlap = prev.findIndex((m) => m.id === data[0].id);
        return reconcileMessages(prev, [
          ...(overlap > 0 ? prev.slice(0, overlap) : []),
          ...data,
          ...local,
        ]);
      });
      // A non-overlapping window means over 60 new messages arrived while offline.
      // Expose older history again; retaining the old "fully loaded" flag would hide it.
      if (reset || boundary < 0 || data.length < 60) setHasOlder(data.length === 60);
      if (data.length) await markRead(id, data.at(-1)!.id);
      return data;
    },
    [activeRef, markRead],
  );

  useEffect(() => {
    if (!activeId || (!infoOpen && !groupModalOpen) || !me) return;
    const controller = new AbortController();
    api<Person[]>(`/chats/${activeId}/members`, 'GET', undefined, { signal: controller.signal })
      .then(setMembers)
      .catch((error) => {
        if (!controller.signal.aborted) report(error);
      });
    return () => controller.abort();
  }, [activeId, active?.member_count, active?.owner_id, infoOpen, groupModalOpen, me?.id, report]);

  useLayoutEffect(() => {
    if (!activeId || !me) return;
    let valid = true;
    const cached = conversationCache.current.get(activeId);
    setLoading(!cached);
    setPaging(false);
    olderRequest.current = null;
    lastScrollTop.current = 0;
    setAwayFromBottom(cached ? !cached.following : false);
    setNewMessageIds([]);
    setUnreadFrom(null);
    onChatOpenedRef.current?.();
    const unread = chatsRef.current.find((chat) => chat.id === activeId)?.unread ?? 0;
    jumpingToLatest.current = false;
    scrollRestore.current = null;
    cachedScroll.current = cached
      ? { id: activeId, top: cached.top, following: cached.following, messages: cached.messages }
      : null;
    setMessages(cached?.messages || []);
    setHasOlder(cached?.hasOlder || false);
    setMembers([]);
    followBottom.current = cached?.following ?? true;
    const timer = setTimeout(() => {
      Promise.all([
        loadMessages(activeId, !cached),
        api<Person[]>(`/chats/${activeId}/members`).then((data) => {
          if (valid) setMembers(data);
        }),
      ])
        .then(([data]) => {
          if (!valid) return;
          if (unread && data) setUnreadFrom(firstUnread(data, unread, me.id));
          refreshChats().catch(() => {});
        })
        .catch((e) => {
          if (!valid) return;
          if (e instanceof ApiError && [403, 404].includes(e.status)) {
            conversationCache.current.delete(activeId);
            setMessages([]);
          }
          report(e);
        })
        .finally(() => {
          if (valid) setLoading(false);
        });
    }, 0);
    return () => {
      valid = false;
      clearTimeout(timer);
      ++requestEpoch.current;
    };
  }, [activeId, me?.id, chatsRef, loadMessages, refreshChats, report]);

  // Open on the first unread message when it would be above the screen at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    const divider = el?.querySelector<HTMLElement>('.unread-divider');
    if (!el || !divider || !followBottom.current) return;
    const top = el.scrollTop + divider.getBoundingClientRect().top - el.getBoundingClientRect().top;
    // Measured against the bottom position: this runs before the list sticks there.
    if (top - 8 >= el.scrollHeight - el.clientHeight) return;
    autoScroll.current = true;
    el.scrollTop = Math.max(0, top - 8);
    followBottom.current = false;
    setAwayFromBottom(true);
  }, [unreadFrom, loading]);

  /** Scroll to the bottom, marking it as ours so onScroll does not mistake it for the user. */
  function stickToBottom(el: HTMLElement) {
    const bottom = el.scrollHeight - el.clientHeight;
    if (Math.abs(el.scrollTop - bottom) < 1) return;
    autoScroll.current = true;
    el.scrollTop = bottom;
  }

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const cached = cachedScroll.current;
    if (cached && cached.id === activeId) {
      // The chat-change effect queues its messages first; wait for that DOM to commit.
      if (messages !== cached.messages) return;
      if (cached.following) stickToBottom(el);
      else el.scrollTop = cached.top;
      cachedScroll.current = null;
      return;
    }
    const restore = scrollRestore.current;
    const last = messages.at(-1)?.id;
    const previous = glide.current;
    glide.current = { id: activeId, last, height: el.scrollHeight };
    if (restore && restore.id === activeId) {
      const top = restore.top + el.scrollHeight - restore.height;
      if (Math.abs(el.scrollTop - top) >= 1) {
        autoScroll.current = true;
        el.scrollTop = top;
      }
      lastScrollTop.current = el.scrollTop;
      scrollRestore.current = null;
    } else if (followBottom.current) {
      stickToBottom(el);
      // A message arrived at the bottom: instead of jumping, the list slides up by the new
      // height. Quick bursts add up into one continuous movement rather than a series of jerks.
      const list = el.querySelector<HTMLElement>('.message-list');
      const grown = el.scrollHeight - previous.height;
      if (
        list &&
        previous.id === activeId &&
        previous.last !== last &&
        grown > 0 &&
        grown < el.clientHeight &&
        motionAllowed()
      ) {
        const running = list.getAnimations().find((animation) => animation.id === 'glide');
        const offset = running ? new DOMMatrixReadOnly(getComputedStyle(list).transform).m42 : 0;
        running?.cancel();
        const animation = list.animate(
          [{ transform: `translateY(${offset + grown}px)` }, { transform: 'none' }],
          { duration: 260, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
        );
        animation.id = 'glide';
      }
    }
  }, [messages, loading, section, activeId, composerLayoutKey]);

  useEffect(() => {
    if (!activeId || loading || messages.some((message) => message.chat_id !== activeId)) return;
    const cache = conversationCache.current;
    cache.delete(activeId);
    cache.set(activeId, {
      messages,
      hasOlder,
      top: scroller.current?.scrollTop ?? 0,
      following: followBottom.current,
    });
    let retained = [...cache.values()].reduce(
      (total, conversation) => total + conversation.messages.length,
      0,
    );
    while (cache.size > 20 || (cache.size > 1 && retained > 1000)) {
      const oldest = cache.keys().next().value!;
      retained -= cache.get(oldest)!.messages.length;
      cache.delete(oldest);
    }
  }, [activeId, messages, hasOlder, loading]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (followBottom.current) stickToBottom(el);
    });
    observer.observe(el);
    const content = el.querySelector('.message-list');
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [activeId, section, ready, me?.id, loading]);

  function jumpToLatest() {
    followBottom.current = true;
    setAwayFromBottom(false);
    const el = scroller.current;
    jumpingToLatest.current = !!el && el.scrollHeight - el.scrollTop - el.clientHeight >= 80;
    el?.scrollTo({
      top: el.scrollHeight,
      behavior:
        document.documentElement.dataset.motion === 'reduced' ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
    });
    const latest = messages.at(-1);
    if (!jumpingToLatest.current && activeId && latest) void markRead(activeId, latest.id);
  }

  /** Prepend one page of older history. Returns false when there is nothing older. */
  function loadOlder() {
    const id = activeRef.current;
    const oldest = messagesRef.current.find((message) => !message.pending);
    if (!id || !oldest) return Promise.resolve(false);
    if (olderRequest.current?.id === id) return olderRequest.current.promise;
    setPaging(true);
    const epoch = requestEpoch.current;
    const promise = api<Message[]>(`/chats/${id}/messages?before=${encodeURIComponent(oldest.id)}`)
      .then((data) => {
        if (activeRef.current !== id || epoch !== requestEpoch.current) return false;
        followBottom.current = false;
        setAwayFromBottom(true);
        const el = scroller.current;
        if (el) scrollRestore.current = { id, top: el.scrollTop, height: el.scrollHeight };
        // Committed at once, so a caller looking for a message finds it in the DOM.
        flushSync(() => {
          setMessages((prev) => [
            ...data.filter((m) => !prev.some((old) => old.id === m.id)),
            ...prev,
          ]);
          setHasOlder(data.length === 60);
        });
        return data.length > 0;
      })
      .catch((e) => {
        if (activeRef.current === id && epoch === requestEpoch.current) report(e);
        return false;
      })
      .finally(() => {
        if (olderRequest.current?.promise === promise) {
          olderRequest.current = null;
          setPaging(false);
        }
      });
    olderRequest.current = { id, promise };
    return promise;
  }

  /** Scroll to a message and light it up, loading older pages until it is on screen. */
  async function showMessage(messageId: string) {
    const id = activeRef.current;
    for (let page = 0; page < 40 && id === activeRef.current; page++) {
      let row = scroller.current?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
      if (!row && scroller.current) {
        const targetIndex = messagesRef.current.findIndex((m) => m.id === messageId);
        if (targetIndex >= 0) {
          followBottom.current = false;
          setAwayFromBottom(true);
          scroller.current.dispatchEvent(
            new CustomEvent('galinka:reveal', { detail: { index: targetIndex } }),
          );
          await new Promise((resolve) => setTimeout(resolve, 32));
          if (id !== activeRef.current) return;
          row = scroller.current?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
        }
      }
      if (row) {
        row.scrollIntoView({ block: 'center', behavior: motionAllowed() ? 'smooth' : 'auto' });
        row.classList.remove('flash');
        void row.offsetWidth;
        row.classList.add('flash');
        // The flash isolates the row; left on, it would trap the row's menu under its neighbours.
        setTimeout(() => row.classList.remove('flash'), 1200);
        return;
      }
      if (!(await loadOlder())) break;
    }
    if (id === activeRef.current) onError('Сообщение не найдено в истории.');
  }

  async function refreshMembers() {
    if (!active) return;
    const id = active.id;
    await refreshChats();
    const people = await api<Person[]>(`/chats/${id}/members`);
    if (activeRef.current === id) setMembers(people);
  }

  function syncCacheOwner(personId: string) {
    if (cacheOwner.current !== personId) conversationCache.current.clear();
    cacheOwner.current = personId;
  }

  function resetConversation(clearCache = false) {
    ++requestEpoch.current;
    if (clearCache) {
      conversationCache.current.clear();
      lastRead.current = {};
    }
    setMessages([]);
    setMembers([]);
  }

  function stickOnSend(chatId: string) {
    if (activeRef.current === chatId) {
      followBottom.current = true;
      setAwayFromBottom(false);
    }
  }

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    jumpingToLatest.current = false;
    if (hasOlder && !loading && event.deltaY < 0 && event.currentTarget.scrollTop <= 0)
      void loadOlder();
    // A floating message menu would stay put while its message scrolls away.
    document.querySelectorAll('details.message-menu[open]').forEach((menu) => closeMenu(menu));
  }

  function onTouchStart() {
    jumpingToLatest.current = false;
  }

  function onScroll() {
    const el = scroller.current!;
    const upwards = el.scrollTop < lastScrollTop.current;
    lastScrollTop.current = el.scrollTop;
    // Our own jump to the bottom: content may have grown meanwhile (a photo
    // decoding), which must not read as the user scrolling up.
    if (autoScroll.current) {
      autoScroll.current = false;
      return;
    }
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (jumpingToLatest.current && !atBottom) return;
    jumpingToLatest.current = false;
    followBottom.current = atBottom;
    const cached = activeId ? conversationCache.current.get(activeId) : undefined;
    if (cached) {
      cached.top = el.scrollTop;
      cached.following = atBottom;
    }
    setAwayFromBottom(!atBottom);
    if (upwards && el.scrollTop < 180 && hasOlder && !loading) void loadOlder();
    const latest = messages.at(-1);
    if (followBottom.current && activeId && latest) void markRead(activeId, latest.id);
  }

  return {
    messages,
    setMessages,
    members,
    setMembers,
    awayFromBottom,
    newMessageIds,
    setNewMessageIds,
    unreadFrom,
    loading,
    hasOlder,
    paging,
    scroller,
    bottomRef,
    conversationCache,
    requestEpoch,
    messagesRef,
    markRead,
    loadMessages,
    loadOlder,
    showMessage,
    jumpToLatest,
    refreshMembers,
    syncCacheOwner,
    resetConversation,
    stickOnSend,
    onWheel,
    onTouchStart,
    onScroll,
  };
}
