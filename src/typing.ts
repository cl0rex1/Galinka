import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { plural } from './ui';
import type { Typing, TypingAction } from './useSync';

const verbs: Record<TypingAction, [string, string]> = {
  typing: ['печатает', 'печатают'],
  voice: ['записывает голосовое', 'записывают голосовое'],
  video: ['записывает кружок', 'записывают кружок'],
};

/** "печатает…", "Аня печатает…", "Аня и Макс печатают…", "3 человека печатают…". */
export function typingText(entries: Typing[string] | undefined, group: boolean) {
  if (!entries?.length) return '';
  const action = entries.at(-1)!.action;
  if (entries.length === 1) {
    const verb = verbs[action][0];
    return group ? `${entries[0].name} ${verb}…` : `${verb}…`;
  }
  const who =
    entries.length === 2
      ? `${entries[0].name} и ${entries[1].name}`
      : `${entries.length} ${plural(entries.length, 'человек', 'человека', 'человек')}`;
  return `${who} ${verbs[action][1]}…`;
}

/** Who is typing where; entries drop out when their sender goes quiet. */
export function useTyping() {
  const [typing, setTyping] = useState<Typing>({});
  useEffect(() => {
    const times = Object.values(typing).flatMap((entries) => entries.map((entry) => entry.until));
    if (!times.length) return;
    const timer = setTimeout(
      () =>
        setTyping((previous) => {
          const now = Date.now();
          const next: Typing = {};
          for (const [chat, entries] of Object.entries(previous)) {
            const alive = entries.filter((entry) => entry.until > now);
            if (alive.length) next[chat] = alive;
          }
          return next;
        }),
      Math.max(0, Math.min(...times) - Date.now()) + 50,
    );
    return () => clearTimeout(timer);
  }, [typing]);
  return [typing, setTyping] as const;
}

/** Tells the chat we are typing or recording, at most once every 3 seconds per chat. */
export function useTypingSender(enabled: boolean) {
  const last = useRef<Record<string, number>>({});
  return (chatId: string, action: TypingAction = 'typing') => {
    const key = `${chatId}:${action}`;
    if (!enabled || Date.now() - (last.current[key] ?? 0) < 3000) return;
    last.current[key] = Date.now();
    api(`/chats/${chatId}/typing`, 'POST', { action }).catch(() => {});
  };
}
