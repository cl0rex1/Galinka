import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { api } from './api';
import { reconcileMessages, withUpdated, type CachedConversation } from './conversation';
import { useSync, type Refetch, type SyncEvent, type Typing } from './useSync';
import type { Chat, Message, Person } from './types';

/** What live events need from the app: its state, refs and setters, passed in, not owned here. */
export type LiveContext = {
  enabled: boolean;
  meId?: string;
  refs: {
    active: MutableRefObject<string | null>;
    section: MutableRefObject<string>;
    messages: MutableRefObject<Message[]>;
    chats: MutableRefObject<Chat[]>;
    cache: MutableRefObject<Map<string, CachedConversation>>;
    requestEpoch: MutableRefObject<number>;
    chatRequestEpoch: MutableRefObject<number>;
    notification: MutableRefObject<{ notify: (chatId: string, messageId?: string) => void }>;
  };
  set: {
    messages: Dispatch<SetStateAction<Message[]>>;
    newMessageIds: Dispatch<SetStateAction<string[]>>;
    replies: Dispatch<SetStateAction<Record<string, Message>>>;
    editing: Dispatch<SetStateAction<{ message: Message; body: string } | null>>;
    chats: Dispatch<SetStateAction<Chat[]>>;
    members: Dispatch<SetStateAction<Person[]>>;
    activeId: Dispatch<SetStateAction<string | null>>;
    infoOpen: Dispatch<SetStateAction<boolean>>;
    modal: Dispatch<SetStateAction<any>>;
    error: Dispatch<SetStateAction<string>>;
    connected: Dispatch<SetStateAction<boolean>>;
    typing: Dispatch<SetStateAction<Typing>>;
  };
  refreshChats: () => Promise<Chat[]>;
  loadMessages: (id: string) => Promise<unknown>;
  markRead: (id: string, lastMessageId: string) => Promise<void>;
  report: (error: unknown) => void;
};

/**
 * Applies live events to the open conversation, the cache and the chat list in place,
 * and refetches only what an event cannot describe.
 */
export function useLiveMessages(c: LiveContext) {
  const { meId, refs, set, refreshChats, loadMessages, markRead, report } = c;
  const activeRef = refs.active,
    sectionRef = refs.section,
    messagesRef = refs.messages,
    chatsRef = refs.chats,
    conversationCache = refs.cache,
    requestEpoch = refs.requestEpoch,
    chatRequestEpoch = refs.chatRequestEpoch,
    notificationRef = refs.notification;
  const me = meId ? { id: meId } : undefined;
  const setMessages = set.messages,
    setNewMessageIds = set.newMessageIds,
    setReplies = set.replies,
    setEditing = set.editing,
    setChats = set.chats,
    setMembers = set.members,
    setActiveId = set.activeId,
    setInfoOpen = set.infoOpen,
    setModal = set.modal,
    setError = set.error,
    setTyping = set.typing;
  /** Someone stopped typing (sent the message) or started: keep one entry per person. */
  const typingChanged = (chatId: string, userId: string, entry?: Typing[string][number]) =>
    setTyping((previous) => {
      if (!entry && !previous[chatId]?.some((item) => item.userId === userId)) return previous;
      const others = (previous[chatId] ?? []).filter((item) => item.userId !== userId);
      const next = { ...previous, [chatId]: entry ? [...others, entry] : others };
      if (!next[chatId].length) delete next[chatId];
      return next;
    });
  const notifyIncoming = (chatId: string, messageId: string) => {
    const show = (chat: Chat | undefined) => {
      if (
        chat &&
        !chat.muted &&
        !(
          document.visibilityState === 'visible' &&
          document.hasFocus() &&
          activeRef.current === chat.id &&
          sectionRef.current === 'chats'
        )
      )
        notificationRef.current.notify(chat.id, messageId);
    };
    const target = chatsRef.current.find((chat) => chat.id === chatId);
    if (target) show(target);
    else if (window.galinkaDesktop)
      void refreshChats()
        .then((items) => show(items.find((chat) => chat.id === chatId)))
        .catch(report);
  };
  /** Puts a server row into the open conversation; false when it cannot be placed locally. */
  const placeMessage = (message: Message, created: boolean) => {
    const current = messagesRef.current;
    if (current.some((m) => m.id === message.id)) {
      setMessages((prev) => reconcileMessages(prev, withUpdated(prev, message)));
      return true;
    }
    const confirmed = current.filter((m) => !m.pending);
    const latest = confirmed.at(-1);
    // Only a message newer than everything shown is appended; anything else is a gap.
    if (!created || (latest && message.created_at < latest.created_at)) return false;
    setMessages((prev) =>
      reconcileMessages(prev, [
        ...prev.filter((m) => !m.pending),
        message,
        ...prev.filter((m) => m.pending && m.nonce !== message.nonce),
      ]),
    );
    setNewMessageIds([message.id]);
    return true;
  };
  const applySyncEvent = (event: SyncEvent): Refetch => {
    const chatId = 'chatId' in event ? event.chatId : undefined;
    const open = Boolean(activeRef.current && (!chatId || chatId === activeRef.current));
    // Notify by the event name: a row is attached only when the viewer can still read it.
    if (
      chatId &&
      'event' in event &&
      event.event === 'message.created' &&
      event.senderId !== me?.id &&
      event.messageId
    )
      notifyIncoming(chatId, event.messageId);
    if (event.type === 'typing') {
      // Senders repeat the event every few seconds while they type; a gap means they stopped.
      typingChanged(event.chatId, event.userId, {
        userId: event.userId,
        name: event.name,
        action: event.action,
        until: Date.now() + 6000,
      });
      return { list: false, conversation: false };
    }
    if (chatId && 'event' in event && event.event === 'message.created' && event.senderId)
      typingChanged(chatId, event.senderId);
    if (event.type === 'presence') {
      // Someone in our chats came online or left: refresh statuses, not the conversation.
      const openId = activeRef.current;
      if (openId)
        api<Person[]>(`/chats/${openId}/members`)
          .then((people) => {
            if (activeRef.current === openId) setMembers(people);
          })
          .catch(() => {});
      return { list: true, conversation: false };
    }
    if (event.type === 'message') {
      const { message } = event;
      const created = event.event === 'message.created';
      const cached = conversationCache.current.get(event.chatId);
      if (cached?.messages.some((m) => m.id === message.id))
        conversationCache.current.set(event.chatId, {
          ...cached,
          messages: withUpdated(cached.messages, message),
        });
      // The list shows the last message: refresh it for a new one or an edit of the last one.
      const last = chatsRef.current.find((chat) => chat.id === event.chatId)?.last_message;
      const list = created || last?.created_at === message.created_at;
      if (!open) return { list, conversation: false };
      if (!placeMessage(message, created)) return { list, conversation: true };
      setReplies((previous) =>
        previous[event.chatId]?.id === message.id
          ? { ...previous, [event.chatId]: message }
          : previous,
      );
      if (created && event.senderId !== me?.id) void markRead(event.chatId, message.id);
      return { list, conversation: false };
    }
    if (event.type === 'refresh') {
      if (event.removedUserId === me?.id && event.chatId) {
        const removedId = event.chatId;
        conversationCache.current.delete(removedId);
        ++chatRequestEpoch.current;
        setChats((previous) => previous.filter((chat) => chat.id !== removedId));
        if (activeRef.current === removedId) {
          ++requestEpoch.current;
          activeRef.current = null;
          setActiveId(null);
          setMessages([]);
          setMembers([]);
          setInfoOpen(false);
          setModal(null);
          setEditing(null);
          setError('Вы больше не участвуете в этой группе.');
        }
      }
      if (event.deletedId) {
        setMessages((prev) => prev.filter((m) => m.id !== event.deletedId));
        setEditing((previous) => (previous?.message.id === event.deletedId ? null : previous));
        setReplies((previous) =>
          Object.fromEntries(
            Object.entries(previous).filter(([, message]) => message.id !== event.deletedId),
          ),
        );
      }
    }
    // Receipts change read_by on many rows; refetch the open conversation only.
    if (event.type === 'read') return { list: false, conversation: open };
    return { list: true, conversation: open };
  };
  useSync(c.enabled, {
    onEvent: applySyncEvent,
    refetch: ({ list, conversation }) => {
      if (list) refreshChats().catch(report);
      if (conversation && activeRef.current) loadMessages(activeRef.current).catch(report);
    },
    onConnected: set.connected,
    onSessionLost: report,
  });
}
