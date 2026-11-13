import type { Message } from './types';

// Reuse unchanged API objects so receipts/polling do not repaint every message.
export function reconcileMessages(previous: Message[], incoming: Message[]) {
  const byId = new Map(previous.map((message) => [message.id, message]));
  const next = incoming.map((message) => {
    const old = byId.get(message.id);
    return old && JSON.stringify(old) === JSON.stringify(message) ? old : message;
  });
  return next.length === previous.length &&
    next.every((message, index) => message === previous[index])
    ? previous
    : next;
}
/** Swap in an updated message and refresh the quotes of replies to it. */
export function withUpdated(list: Message[], message: Message) {
  return list.map((m) =>
    m.id === message.id
      ? message
      : m.reply?.id === message.id
        ? { ...m, reply: { ...m.reply, body: message.body, file_name: message.file?.name } }
        : m,
  );
}
/** Id of the oldest of the last `count` messages from others, as far as `messages` reach. */
export function firstUnread(messages: Message[], count: number, meId: string) {
  let found: string | null = null;
  for (let i = messages.length - 1; i >= 0 && count > 0; i--)
    if (messages[i].sender_id !== meId) {
      found = messages[i].id;
      count--;
    }
  return found;
}
export type CachedConversation = {
  messages: Message[];
  hasOlder: boolean;
  top: number;
  following: boolean;
};
