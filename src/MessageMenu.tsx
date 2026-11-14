import { useEffect, useLayoutEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Copy,
  Download,
  Forward,
  Pencil,
  Pin,
  PinOff,
  Reply,
  Trash2,
} from 'lucide-react';
import { api } from './api';
import { Avatar } from './Avatar';
import { EmojiPicker } from './EmojiPicker';
import type { MessageActions } from './MessageList';
import type { Chat, Message, MessageDetails, Person } from './types';

export const QUICK_REACTIONS = ['❤', '👍', '😂', '🔥', '🥳', '😭'];
/** Up to this many people are listed right in the menu; more fold into one row. */
const INLINE_PEOPLE = 3;

const clock = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' });
const dayClock = new Intl.DateTimeFormat('ru', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const when = (iso: string) => {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? clock.format(date)
    : dayClock.format(date);
};
const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11
    ? one
    : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)
      ? few
      : many;

type Row = { person: Person; at?: string; emoji?: string };

// Opening the same menu twice should not ask again unless something changed.
const detailsCache = new Map<string, Promise<MessageDetails>>();
function loadDetails(m: Message) {
  const key = `${m.id}:${m.read_by ?? 0}:${m.reactions.map((r) => r.emoji + r.count).join()}`;
  let found = detailsCache.get(key);
  if (!found) {
    found = api<MessageDetails>(`/chats/${m.chat_id}/messages/${m.id}/details`);
    found.catch(() => detailsCache.delete(key));
    detailsCache.set(key, found);
  }
  return found;
}

/**
 * The message menu as in Telegram: quick reactions, then who read or reacted (listed
 * outright when there are few), then the actions.
 */
export function MessageMenuBody({
  m,
  own,
  kind,
  pinned,
  copied,
  sending,
  savingEdit,
  open,
  actions,
  close,
  reposition,
}: {
  m: Message;
  own: boolean;
  kind: Chat['kind'];
  pinned: boolean | null;
  copied: boolean;
  sending: boolean;
  savingEdit: boolean;
  open: boolean;
  actions: MessageActions;
  close: () => void;
  reposition: () => void;
}) {
  const [view, setView] = useState<'main' | 'react' | 'people'>('main');
  const [details, setDetails] = useState<MessageDetails | null>(null);
  const wantsPeople =
    kind !== 'saved' &&
    ((own && (m.read_by ?? 0) > 0) || (kind === 'group' && m.reactions.length > 0));

  useEffect(() => {
    if (open) setView('main');
    if (!open || !wantsPeople) return;
    let live = true;
    loadDetails(m)
      .then((data) => {
        if (live) setDetails(data);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, wantsPeople, m.id, m.read_by, m.reactions]);

  // From the keyboard: a letter runs its action, arrows step through the buttons.
  useEffect(() => {
    if (!open || view !== 'main') return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        target?.closest('input, textarea, [contenteditable="true"]')
      )
        return;
      const content = document.querySelector<HTMLElement>(
        '.message-menu[open] .message-menu-content',
      );
      if (!content) return;
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight'
      ) {
        const buttons = [...content.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
        const next = at < 0 ? (forward ? 0 : buttons.length - 1) : at + (forward ? 1 : -1);
        buttons[(next + buttons.length) % buttons.length]?.focus();
        event.preventDefault();
        return;
      }
      // `code` follows the key's place, so it works in any keyboard layout.
      const raw =
        event.code || (/^[a-z]$/i.test(event.key) ? `Key${event.key.toUpperCase()}` : event.key);
      const code = raw === 'Backspace' ? 'Delete' : raw;
      const button = content.querySelector<HTMLButtonElement>(
        `[data-key="${code}"]:not(:disabled)`,
      );
      if (!button) return;
      event.preventDefault();
      button.click();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, view]);

  // The menu changes size: keep it on screen.
  useLayoutEffect(() => {
    if (open) reposition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, details, open]);

  const reactedBy = new Map<string, string>();
  for (const group of details?.reactions ?? [])
    for (const person of group.users)
      if (!reactedBy.has(person.id)) reactedBy.set(person.id, group.emoji);
  const rows: Row[] = own
    ? (details?.readers ?? []).map((reader) => ({
        person: reader,
        at: reader.read_at,
        emoji: reactedBy.get(reader.id),
      }))
    : (details?.reactions ?? []).flatMap((group) =>
        group.users.map((person) => ({ person, emoji: group.emoji })),
      );
  const verb = own ? plural(rows.length, 'прочитал', 'прочитали', 'прочитали') : '';
  const summary = own
    ? `${rows.length} ${verb}`
    : `${rows.length} ${plural(rows.length, 'реакция', 'реакции', 'реакций')}`;

  const personRow = (row: Row) => (
    <div className="menu-person" key={`${row.person.id}${row.emoji ?? ''}`}>
      <Avatar person={row.person} size="small" showPresence={false} />
      <span className="menu-person-name">{row.person.name}</span>
      {row.emoji && <span className="menu-person-emoji">{row.emoji}</span>}
      {row.at && <time dateTime={row.at}>{when(row.at)}</time>}
    </div>
  );

  if (view === 'react')
    return (
      <>
        <div className="menu-subheader">
          <button type="button" aria-label="Назад" onClick={() => setView('main')}>
            <ArrowLeft size={18} />
          </button>
          <span>Реакция</span>
        </div>
        <EmojiPicker
          open
          mode="reaction"
          onSelectEmoji={(emoji) => {
            actions.react(m, emoji);
            close();
          }}
        />
      </>
    );

  if (view === 'people')
    return (
      <>
        <div className="menu-subheader">
          <button type="button" aria-label="Назад" onClick={() => setView('main')}>
            <ArrowLeft size={18} />
          </button>
          <span>{summary}</span>
        </div>
        <div className="menu-people scroll">{rows.map(personRow)}</div>
      </>
    );

  const directRead = own && kind === 'direct' && rows[0]?.at;
  return (
    <>
      <span>Реакция</span>
      <div className="reaction-bar">
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            aria-label={`Реакция ${emoji}`}
            className={m.reactions.some((r) => r.emoji === emoji && r.mine) ? 'mine' : ''}
            onClick={() => {
              actions.react(m, emoji);
              close();
            }}
          >
            {emoji}
          </button>
        ))}
        <button
          type="button"
          className="reaction-more-btn"
          aria-label="Ещё реакции"
          onClick={() => setView('react')}
        >
          <ChevronDown size={18} />
        </button>
      </div>
      {wantsPeople && details && rows.length > 0 && (
        <div className="menu-people">
          {directRead ? (
            <div className="menu-read-at">
              <CheckCheck size={16} />
              Прочитано {when(directRead)}
            </div>
          ) : rows.length <= INLINE_PEOPLE ? (
            rows.map(personRow)
          ) : (
            <button type="button" className="menu-people-summary" onClick={() => setView('people')}>
              {own ? (
                <CheckCheck size={16} />
              ) : (
                <span className="menu-person-emoji">{rows[0].emoji}</span>
              )}
              <span>{summary}</span>
              <span className="menu-avatar-stack" aria-hidden="true">
                {rows.slice(0, 3).map((row) => (
                  <Avatar
                    key={row.person.id}
                    person={row.person}
                    size="small"
                    showPresence={false}
                  />
                ))}
              </span>
              <ChevronRight size={16} />
            </button>
          )}
        </div>
      )}
      <div className="menu-actions">
        {/* What people do most, by hand: answer, pass on, copy. */}
        <div className="menu-group">
          <button
            className="message-action"
            data-key="KeyR"
            disabled={sending}
            onClick={() => actions.reply(m)}
          >
            <Reply size={18} />
            Ответить
            <kbd aria-hidden="true">R</kbd>
          </button>
          <button className="message-action" data-key="KeyF" onClick={() => actions.forward(m)}>
            <Forward size={18} />
            Переслать
            <kbd aria-hidden="true">F</kbd>
          </button>
          {m.body && !m.poll && (
            <button className="message-action" data-key="KeyC" onClick={() => actions.copy(m)}>
              {copied ? <Check size={18} /> : <Copy size={18} />}
              {copied ? 'Скопировано' : 'Копировать текст'}
              <kbd aria-hidden="true">C</kbd>
            </button>
          )}
          {m.file && (
            <button
              className="message-action"
              data-key="KeyD"
              onClick={() => {
                actions.download(m.file!);
                close();
              }}
            >
              <Download size={18} />
              Скачать
              <kbd aria-hidden="true">D</kbd>
            </button>
          )}
        </div>
        <div className="menu-group">
          {pinned !== null && (
            <button className="message-action" data-key="KeyP" onClick={() => actions.pin(m)}>
              {pinned ? <PinOff size={18} /> : <Pin size={18} />}
              {pinned ? 'Открепить' : 'Закрепить'}
              <kbd aria-hidden="true">P</kbd>
            </button>
          )}
          {own && !m.poll && (
            <button
              className="message-action"
              data-key="KeyE"
              disabled={sending || savingEdit}
              onClick={() => actions.edit(m)}
            >
              <Pencil size={18} />
              Изменить
              <kbd aria-hidden="true">E</kbd>
            </button>
          )}
          <button className="message-action" data-key="KeyS" onClick={() => actions.select(m)}>
            <CircleCheck size={18} />
            Выбрать
            <kbd aria-hidden="true">S</kbd>
          </button>
        </div>
        {/* Apart from the rest, last: the one action that cannot be taken back at once. */}
        <div className="menu-group">
          <button className="delete-action" data-key="Delete" onClick={() => actions.remove(m)}>
            <Trash2 size={18} />
            Удалить
            <kbd aria-hidden="true">Del</kbd>
          </button>
        </div>
      </div>
    </>
  );
}
