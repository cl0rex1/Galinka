import { memo, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, CheckCheck, Copy, MoreHorizontal, Pencil, Reply, Trash2 } from 'lucide-react';
import { Avatar } from './Avatar';
import { MediaAttachment } from './MediaAttachment';
import { MessageText } from './MessageText';
import type { Attachment, Chat, Message } from './types';

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
  menu: (details: HTMLDetailsElement) => void;
};
type RowProps = {
  message: Message;
  own: boolean;
  kind: Chat['kind'];
  continued: boolean;
  showAvatar: boolean;
  date: string | null;
  fresh: boolean;
  copied: boolean;
  sending: boolean;
  savingEdit: boolean;
  actions: MessageActions;
};
const interactive =
  'button, a, input, textarea, audio, video, details, [role="button"], [role="slider"]';

const MessageRow = memo(function MessageRow({
  message: m,
  own,
  kind,
  continued,
  showAvatar,
  date,
  fresh,
  copied,
  sending,
  savingEdit,
  actions,
}: RowProps) {
  const menu = useRef<HTMLDetailsElement>(null);
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const held = useRef(false);
  const bot = !m.sender_id;
  function cancelPress() {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  }
  useEffect(() => cancelPress, []);
  function openMenu() {
    document.querySelectorAll('details.message-menu[open]').forEach((element) => {
      if (element !== menu.current) element.removeAttribute('open');
    });
    if (menu.current) {
      menu.current.open = true;
      actions.menu(menu.current);
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
        window.getSelection()?.removeAllRanges();
        openMenu();
      }, 450),
    };
  }
  return (
    <div className="message-group-item">
      {date && (
        <div className="date-divider">
          <span>{date}</span>
        </div>
      )}
      <article
        data-message-id={m.id}
        className={`message-row ${fresh ? 'is-new' : ''} ${own ? 'own' : ''} ${bot ? 'bot' : ''} ${continued ? 'continued' : ''}`}
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
        onContextMenu={(event) => {
          if (!(event.target instanceof Element) || event.target.closest(interactive)) return;
          event.preventDefault();
          cancelPress();
          openMenu();
        }}
      >
        <span className="swipe-reply-indicator" aria-hidden="true">
          <Reply size={17} />
        </span>
        {!own && (
          <div className="message-avatar">
            {showAvatar && <Avatar person={m.sender} size="small" />}
          </div>
        )}
        <div className="message-content">
          {!own && !continued && kind === 'group' && (
            <div className="sender-name">
              {m.sender.name}
              {bot && <span className="bot-tag">модуль</span>}
            </div>
          )}
          <div className="bubble">
            {m.reply && (
              <blockquote className="message-quote">
                <Reply size={14} />
                <div>
                  <strong>{m.reply.sender.name}</strong>
                  <span>{m.reply.body || m.reply.file_name || 'Сообщение'}</span>
                </div>
              </blockquote>
            )}
            {m.file && (
              <MediaAttachment file={m.file} onDownload={() => actions.download(m.file!)} />
            )}
            {m.body && <MessageText text={m.body} />}
            <span className="message-time">
              {m.edited_at && (
                <span className="message-edited" title={`Изменено ${time(m.edited_at)}`}>
                  изменено
                </span>
              )}
              <time dateTime={m.created_at}>{time(m.created_at)}</time>
              {own &&
                ((m.read_by || 0) > 0 ? (
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
                  className={reaction.mine ? 'mine' : ''}
                  aria-label={`${reaction.emoji}: ${reaction.count}, ${reaction.mine ? 'убрать' : 'добавить'} реакцию`}
                  onClick={() => actions.react(m, reaction.emoji)}
                >
                  {reaction.emoji}
                  <span>{reaction.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <details
          ref={menu}
          className="message-menu"
          name="message-actions"
          onToggle={(event) => actions.menu(event.currentTarget)}
        >
          <summary aria-label="Действия с сообщением">
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
                    event.currentTarget.closest('details')?.removeAttribute('open');
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <button className="message-action" disabled={sending} onClick={() => actions.reply(m)}>
              <Reply size={16} />
              Ответить
            </button>
            <button className="message-action" onClick={() => actions.copy(m)}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Скопировано' : 'Копировать'}
            </button>
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
}: {
  messages: Message[];
  meId: string;
  kind: Chat['kind'];
  newMessageIds: string[];
  copiedId: string | null;
  sending: boolean;
  savingEdit: boolean;
  actions: MessageActions;
}) {
  const fresh = new Set(newMessageIds);
  const today = new Date().toDateString();
  return (
    <div className="message-list">
      {messages.map((message, index) => {
        const previous = messages[index - 1],
          next = messages[index + 1];
        const newDay = !previous || !sameDay(previous, message);
        return (
          <MessageRow
            key={message.id}
            message={message}
            own={message.sender_id === meId}
            kind={kind}
            continued={grouped(previous, message)}
            showAvatar={!grouped(message, next)}
            date={
              newDay
                ? new Date(message.created_at).toDateString() === today
                  ? 'Сегодня'
                  : dayFormatter.format(new Date(message.created_at))
                : null
            }
            fresh={fresh.has(message.id)}
            copied={copiedId === message.id}
            sending={sending}
            savingEdit={savingEdit}
            actions={actions}
          />
        );
      })}
    </div>
  );
});
