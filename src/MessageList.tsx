import { memo, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock3,
  Copy,
  Download,
  MoreHorizontal,
  Pencil,
  Reply,
  RotateCw,
  Trash2,
  X,
} from 'lucide-react';
import { Avatar } from './Avatar';
import { fileLabel, MediaAttachment } from './MediaAttachment';
import { MessageText } from './MessageText';
import { closeMenu, openMenu as showMenu } from './ui';
import type { Attachment, Chat, Message, Person } from './types';

const timeFormatter = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' });
const dayFormatter = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' });
const time = (date: string) => timeFormatter.format(new Date(date));
const sameDay = (left: Message, right: Message) =>
  new Date(left.created_at).toDateString() === new Date(right.created_at).toDateString();
const grouped = (left: Message | undefined, right: Message | undefined) =>
  Boolean(
    left &&
    right &&
    left.sender_id === right.sender_id &&
    sameDay(left, right) &&
    Math.abs(Date.parse(left.created_at) - Date.parse(right.created_at)) < 300000,
  );

export type MessageActions = {
  reply: (message: Message) => void;
  edit: (message: Message) => void;
  copy: (message: Message) => void;
  react: (message: Message, emoji: string) => void;
  remove: (message: Message) => void;
  download: (file: Attachment) => void;
  /** Place an open menu next to its message, or at the pointer for right click and long press. */
  menu: (details: HTMLDetailsElement, point?: { x: number; y: number }) => void;
  jump: (messageId: string) => void;
  profile: (person: Person) => void;
  retry: (message: Message) => void;
  discard: (message: Message) => void;
};
type RowProps = {
  message: Message;
  own: boolean;
  kind: Chat['kind'];
  continued: boolean;
  showAvatar: boolean;
  fresh: boolean;
  copied: boolean;
  sending: boolean;
  savingEdit: boolean;
  actions: MessageActions;
  highlight?: string;
};
const interactive =
  'button, a, input, textarea, audio, video, details, [role="button"], [role="slider"]';

const MessageRow = memo(function MessageRow({
  message: m,
  own,
  kind,
  continued,
  showAvatar,
  fresh,
  copied,
  sending,
  savingEdit,
  actions,
  highlight,
}: RowProps) {
  const menu = useRef<HTMLDetailsElement>(null);
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const held = useRef(false);
  const bot = !m.sender_id;
  // Reactions seen on the previous render: new ones rise in, changed counts roll.
  const seen = useRef<Map<string, number> | null>(null);
  const previous = seen.current;
  useEffect(() => {
    seen.current = new Map(m.reactions.map((r) => [r.emoji, r.count]));
  }, [m.reactions]);
  function cancelPress() {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  }
  useEffect(() => cancelPress, []);
  function openMenu(point?: { x: number; y: number }) {
    document.querySelectorAll('details.message-menu[open]').forEach((element) => {
      if (element !== menu.current) closeMenu(element);
    });
    if (menu.current) {
      showMenu(menu.current);
      actions.menu(menu.current, point);
    }
  }
  function pointerDown(event: ReactPointerEvent<HTMLElement>) {
    cancelPress();
    held.current = false;
    if (
      event.pointerType === 'mouse' ||
      !event.isPrimary ||
      !(event.target instanceof Element) ||
      event.target.closest(interactive)
    )
      return;
    press.current = {
      x: event.clientX,
      y: event.clientY,
      timer: setTimeout(() => {
        held.current = true;
        navigator.vibrate?.(8);
        window.getSelection()?.removeAllRanges();
        openMenu(press.current ? { x: press.current.x, y: press.current.y } : undefined);
      }, 450),
    };
  }
  return (
    <div className="message-group-item">
      <article
        data-message-id={m.id}
        className={`message-row ${fresh ? 'is-new' : ''} ${own ? 'own' : ''} ${bot ? 'bot' : ''} ${continued ? 'continued' : ''} ${showAvatar ? 'last' : ''}`}
        onPointerDown={pointerDown}
        onPointerMove={(event) => {
          if (
            press.current &&
            Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 10
          )
            cancelPress();
        }}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onClickCapture={(event) => {
          if (held.current) {
            held.current = false;
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onDoubleClick={(event) => {
          // Touch screens: double tap is the quick ❤ reaction, as in Telegram.
          if (
            !matchMedia('(pointer: coarse)').matches ||
            !(event.target instanceof Element) ||
            event.target.closest(interactive)
          )
            return;
          actions.react(m, '❤');
        }}
        onContextMenu={(event) => {
          if (!(event.target instanceof Element) || event.target.closest(interactive)) return;
          event.preventDefault();
          cancelPress();
          openMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <span className="swipe-reply-indicator" aria-hidden="true">
          <Reply size={17} />
        </span>
        {!own && (
          <div className="message-avatar">
            {showAvatar &&
              (bot ? (
                <Avatar person={m.sender} size="small" />
              ) : (
                <button
                  type="button"
                  aria-label={`Профиль: ${m.sender.name}`}
                  onClick={() => actions.profile(m.sender)}
                >
                  <Avatar person={m.sender} size="small" />
                </button>
              ))}
          </div>
        )}
        <div className="message-content">
          <div className="bubble">
            {!own && !continued && kind === 'group' && (
              <div className={`sender-name tone-text-${(m.sender.color ?? 2) % 6}`}>
                {m.sender.name}
                {bot && <span className="bot-tag">бот</span>}
              </div>
            )}
            {m.reply && (
              <blockquote
                className="message-quote"
                role="button"
                tabIndex={0}
                aria-label={`Перейти к сообщению ${m.reply.sender.name}`}
                onClick={() => actions.jump(m.reply!.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    actions.jump(m.reply!.id);
                  }
                }}
              >
                <Reply size={14} />
                <div>
                  <strong>{m.reply.sender.name}</strong>
                  <span>
                    {m.reply.body ||
                      (m.reply.file_name && fileLabel(m.reply.file_name)) ||
                      'Сообщение'}
                  </span>
                </div>
              </blockquote>
            )}
            {m.file && (
              <MediaAttachment file={m.file} onDownload={() => actions.download(m.file!)} />
            )}
            {m.body && <MessageText text={m.body} highlight={highlight} />}
            <span className="message-time">
              {m.edited_at && (
                <span className="message-edited" title={`Изменено ${time(m.edited_at)}`}>
                  изменено
                </span>
              )}
              <time dateTime={m.created_at}>{time(m.created_at)}</time>
              {own &&
                (m.failed ? (
                  <AlertCircle size={14} className="failed-mark" aria-label="Не отправлено" />
                ) : m.pending ? (
                  <Clock3 size={13} className="pending-mark" aria-label="Отправляется" />
                ) : (m.read_by || 0) > 0 ? (
                  <span
                    className="read-receipt"
                    title={kind === 'direct' ? 'Прочитано' : `Прочитали: ${m.read_by}`}
                    aria-label={kind === 'direct' ? 'Прочитано' : `Прочитали: ${m.read_by}`}
                  >
                    <CheckCheck size={15} />
                  </span>
                ) : (
                  <Check size={14} aria-label="Отправлено" />
                ))}
            </span>
          </div>
          {m.reactions.length > 0 && (
            <div className="reactions">
              {m.reactions.map((reaction) => (
                <button
                  key={reaction.emoji}
                  className={`${reaction.mine ? 'mine' : ''} ${previous && !previous.has(reaction.emoji) ? 'pop' : ''}`}
                  aria-label={`${reaction.emoji}: ${reaction.count}, ${reaction.mine ? 'убрать' : 'добавить'} реакцию`}
                  onClick={() => actions.react(m, reaction.emoji)}
                >
                  {reaction.emoji}
                  <span
                    key={reaction.count}
                    className={
                      previous?.has(reaction.emoji) &&
                      previous.get(reaction.emoji) !== reaction.count
                        ? 'bump'
                        : ''
                    }
                  >
                    {reaction.count}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        {m.failed && (
          <div className="failed-actions">
            <button type="button" onClick={() => actions.retry(m)}>
              <RotateCw size={14} />
              Повторить
            </button>
            <button
              type="button"
              aria-label="Убрать неотправленное"
              onClick={() => actions.discard(m)}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {!m.pending && (
          <details ref={menu} className="message-menu">
            <summary
              aria-label="Действия с сообщением"
              onClick={(event) => {
                event.preventDefault();
                if (menu.current?.open && !menu.current.hasAttribute('data-closing'))
                  closeMenu(menu.current);
                else openMenu();
              }}
            >
              <MoreHorizontal size={18} />
            </summary>
            <div className="message-menu-content">
              <span>Реакция</span>
              <div>
                {['❤', '👍', '😂', '🔥'].map((emoji) => (
                  <button
                    key={emoji}
                    aria-label={`Реакция ${emoji}`}
                    onClick={(event) => {
                      actions.react(m, emoji);
                      const details = event.currentTarget.closest('details');
                      if (details) closeMenu(details);
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <button
                className="message-action"
                disabled={sending}
                onClick={() => actions.reply(m)}
              >
                <Reply size={16} />
                Ответить
              </button>
              {m.body && (
                <button className="message-action" onClick={() => actions.copy(m)}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  {copied ? 'Скопировано' : 'Копировать'}
                </button>
              )}
              {m.file && (
                <button
                  className="message-action"
                  onClick={() => {
                    actions.download(m.file!);
                    if (menu.current) closeMenu(menu.current);
                  }}
                >
                  <Download size={16} />
                  Скачать
                </button>
              )}
              {own && (
                <button
                  className="message-action"
                  disabled={sending || savingEdit}
                  onClick={() => actions.edit(m)}
                >
                  <Pencil size={16} />
                  Редактировать
                </button>
              )}
              {own && (
                <button className="delete-action" onClick={() => actions.remove(m)}>
                  <Trash2 size={15} />
                  Удалить
                </button>
              )}
            </div>
          </details>
        )}
      </article>
    </div>
  );
});

export const MessageList = memo(function MessageList({
  messages,
  meId,
  kind,
  newMessageIds,
  copiedId,
  sending,
  savingEdit,
  actions,
  highlight,
}: {
  messages: Message[];
  meId: string;
  kind: Chat['kind'];
  newMessageIds: string[];
  copiedId: string | null;
  sending: boolean;
  savingEdit: boolean;
  actions: MessageActions;
  highlight?: string;
}) {
  const fresh = new Set(newMessageIds);
  const today = new Date().toDateString();
  // One section per day so the date pill can stick to the top while that day scrolls by.
  const days: { key: string; label: string; items: number[] }[] = [];
  messages.forEach((message, index) => {
    if (!index || !sameDay(messages[index - 1], message)) {
      const date = new Date(message.created_at);
      days.push({
        key: date.toDateString(),
        label: date.toDateString() === today ? 'Сегодня' : dayFormatter.format(date),
        items: [],
      });
    }
    days.at(-1)!.items.push(index);
  });
  return (
    <div className={`message-list kind-${kind}`}>
      {days.map((day) => (
        <section className="message-day" key={day.key}>
          <div className="date-divider">
            <span>{day.label}</span>
          </div>
          {day.items.map((index) => {
            const message = messages[index];
            return (
              <MessageRow
                // Keyed by nonce: the server's copy replaces a just-sent bubble without a remount.
                key={message.nonce ? `n:${message.nonce}` : message.id}
                message={message}
                own={message.sender_id === meId}
                kind={kind}
                continued={grouped(messages[index - 1], message)}
                showAvatar={!grouped(message, messages[index + 1])}
                fresh={fresh.has(message.id)}
                copied={copiedId === message.id}
                sending={sending}
                savingEdit={savingEdit}
                actions={actions}
                highlight={highlight}
              />
            );
          })}
        </section>
      ))}
    </div>
  );
});
