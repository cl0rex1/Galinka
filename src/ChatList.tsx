import { useLayoutEffect, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Bell,
  BellOff,
  CheckCheck,
  Pin,
  PinOff,
} from 'lucide-react';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { Avatar } from './Avatar';
import { isVideoNote } from './MediaAttachment';
import { plainText } from './MessageText';
import { listTime } from './SearchResults';
import { haptic, motionAllowed } from './ui';

export type ChatAction = 'read' | 'pin' | 'mute' | 'archive';
/** The quick actions of a chat row, offered on a long press or a right click. */
function chatActions(chat: Chat, act: (action: ChatAction) => void): MenuItem[] {
  return [
    ...(chat.unread > 0 && chat.last_message?.id
      ? [{ label: 'Отметить прочитанным', icon: CheckCheck, onSelect: () => act('read') }]
      : []),
    {
      label: chat.pinned ? 'Открепить' : 'Закрепить',
      icon: chat.pinned ? PinOff : Pin,
      onSelect: () => act('pin'),
    },
    {
      label: chat.muted ? 'Включить звук' : 'Без звука',
      icon: chat.muted ? Bell : BellOff,
      onSelect: () => act('mute'),
    },
    {
      label: chat.archived ? 'Вернуть из архива' : 'В архив',
      icon: chat.archived ? ArchiveRestore : Archive,
      onSelect: () => act('archive'),
    },
  ];
}
import type { Chat } from './types';

export const folders = ['Все', 'Непрочитанные', 'Личные', 'Группы', 'Архив'];

/** The last message as one line: its text, or what kind of attachment it was. */
function preview(chat: Chat) {
  const file = chat.last_message?.file;
  return (
    plainText(chat.last_message?.body || '') ||
    (file?.as_file
      ? file.name
      : file?.mime?.startsWith('audio/')
        ? 'Голосовое сообщение'
        : file && isVideoNote(file)
          ? 'Кружок'
          : file?.mime?.startsWith('video/')
            ? 'Видео'
            : file?.mime?.startsWith('image/')
              ? 'Фотография'
              : file?.name || (chat.last_message?.file_id ? 'Файл' : 'Нет сообщений'))
  );
}

/** Chats in the chosen folder, with drafts, typing, unread counts and pins. */
export function ChatList({
  chats,
  filter,
  onFilter,
  selectedId,
  meId,
  drafts,
  attachmentNames,
  typingIn,
  loaded,
  onSelect,
  onNew,
  onAction,
}: {
  chats: Chat[];
  filter: string;
  onFilter: (folder: string) => void;
  selectedId: string | null;
  meId: string;
  drafts: Record<string, string>;
  /** Name of a file waiting to be sent, per chat. */
  attachmentNames: Record<string, string>;
  typingIn: (chat: Chat) => string;
  /** False until the first list arrives: until then nothing is empty, only loading. */
  loaded: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onAction: (chat: Chat, action: ChatAction) => void;
}) {
  const [menu, setMenu] = useState<{ chat: Chat; point: { x: number; y: number } } | null>(null);
  // A long press on a phone opens the row's menu; the tap that ends it must not open the chat.
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(
    null,
  );
  const held = useRef(false);
  const release = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  const archive = filter === 'Архив';
  const shown = chats
    .filter(
      (c) =>
        (archive ? c.archived : !c.archived) &&
        (filter === 'Все' ||
          archive ||
          (filter === 'Личные' && c.kind === 'direct') ||
          (filter === 'Группы' && c.kind === 'group') ||
          (filter === 'Непрочитанные' && c.unread > 0)),
    )
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
  const archivedCount = chats.filter((chat) => chat.archived).length;
  // The list slides in from the side of the folder chosen.
  const folderMove = useRef({ filter, dir: '' });
  if (folderMove.current.filter !== filter)
    folderMove.current = {
      filter,
      dir: folders.indexOf(filter) > folders.indexOf(folderMove.current.filter) ? 'next' : 'prev',
    };
  const swipe = useRef<{ x: number; y: number } | null>(null);
  // When a conversation moves (new message, pin), slide rows to their new places.
  // A folder change rebuilds the list and is not animated.
  const list = useRef<HTMLDivElement>(null);
  const rowTops = useRef<{ key: string; tops: Map<string, number> }>({ key: '', tops: new Map() });
  const order = chats.map((c) => `${c.id}:${c.pinned ? 1 : 0}`).join();
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const previous = rowTops.current;
    const tops = new Map<string, number>();
    const animate = previous.key === filter && previous.tops.size > 0 && motionAllowed();
    element.querySelectorAll<HTMLElement>('[data-chat-id]').forEach((row) => {
      const id = row.dataset.chatId!;
      tops.set(id, row.offsetTop);
      if (!animate) return;
      const before = previous.tops.get(id);
      if (before === undefined)
        row.animate(
          [
            { opacity: 0, translate: '0 -8px' },
            { opacity: 1, translate: '0 0' },
          ],
          { duration: 240, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
        );
      else if (before !== row.offsetTop)
        row.animate([{ translate: `0 ${before - row.offsetTop}px` }, { translate: '0 0' }], {
          duration: 320,
          easing: 'cubic-bezier(0.77, 0, 0.175, 1)',
        });
    });
    rowTops.current = { key: filter, tops };
  }, [order, filter]);
  return (
    <div
      className="chat-list"
      ref={list}
      key={filter}
      data-dir={folderMove.current.dir}
      // Phones: a horizontal swipe moves to the next or previous folder.
      onTouchStart={(event) => {
        const touch = event.touches[0];
        swipe.current = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
      }}
      onTouchEnd={(event) => {
        const start = swipe.current;
        swipe.current = null;
        if (!start || archive) return;
        const touch = event.changedTouches[0];
        const dx = touch.clientX - start.x;
        if (Math.abs(dx) < 70 || Math.abs(dx) < 2 * Math.abs(touch.clientY - start.y)) return;
        const next = folders.indexOf(filter) + (dx < 0 ? 1 : -1);
        if (next >= 0 && next < 4) onFilter(folders[next]);
      }}
    >
      {(archivedCount > 0 || archive) && (
        <button
          className={archive ? 'archive-link selected' : 'archive-link'}
          aria-pressed={archive}
          onClick={() => onFilter(archive ? 'Все' : 'Архив')}
        >
          {archive ? <ArrowLeft size={18} /> : <Archive size={18} />}
          <span>{archive ? 'Все чаты' : 'Архив'}</span>
          {!archive && <small>{archivedCount}</small>}
        </button>
      )}
      {shown.map((c) => {
        const typing = typingIn(c);
        return (
          <button
            key={c.id}
            data-chat-id={c.id}
            className={`chat-item ${selectedId === c.id ? 'selected' : ''} ${menu?.chat.id === c.id ? 'menu-open' : ''}`}
            onClick={() => {
              if (held.current) {
                held.current = false;
                return;
              }
              onSelect(c.id);
            }}
            onPointerDown={(event) => {
              held.current = false;
              if (event.pointerType === 'mouse' || !event.isPrimary) return;
              const point = { x: event.clientX, y: event.clientY };
              release();
              press.current = {
                ...point,
                timer: setTimeout(() => {
                  press.current = null;
                  held.current = true;
                  haptic('press');
                  setMenu({ chat: c, point });
                }, 420),
              };
            }}
            onPointerMove={(event) => {
              const start = press.current;
              if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8)
                release();
            }}
            onPointerUp={release}
            onPointerCancel={release}
            onContextMenu={(event) => {
              event.preventDefault();
              release();
              if (held.current) return;
              setMenu({ chat: c, point: { x: event.clientX, y: event.clientY } });
            }}
          >
            <Avatar chat={c} person={c.peer} />
            <span className="chat-item-content">
              <span className="chat-item-title">
                <strong>{c.title}</strong>
                <span className="chat-flags">
                  {c.muted && <BellOff size={13} aria-label="Без уведомлений" />}
                </span>
                <time>{c.last_message ? listTime(c.last_message.created_at) : ''}</time>
              </span>
              <span className="chat-item-preview">
                <span>
                  {typing ? (
                    <span className="chat-typing">{typing}</span>
                  ) : drafts[c.id] || attachmentNames[c.id] ? (
                    <>
                      <span className="chat-draft">Черновик:</span>{' '}
                      {drafts[c.id] || attachmentNames[c.id]}
                    </>
                  ) : (
                    <>
                      {c.last_message?.sender_id === meId && <span className="chat-you">Вы: </span>}
                      {preview(c)}
                    </>
                  )}
                </span>
                {c.unread > 0 ? (
                  <>
                    {!!c.unread_mentions && (
                      <b className="unread mention-mark" role="img" aria-label="Вас упомянули">
                        @
                      </b>
                    )}
                    <b key={c.unread} className={`unread ${c.muted ? 'muted-unread' : ''}`}>
                      {c.unread > 99 ? '99+' : c.unread}
                    </b>
                  </>
                ) : (
                  c.pinned && <Pin size={13} className="pin-mark" aria-label="Закреплён" />
                )}
              </span>
            </span>
          </button>
        );
      })}
      {!loaded &&
        !chats.length &&
        Array.from({ length: 7 }, (_, index) => (
          <div className="chat-skeleton" key={index} aria-hidden="true">
            <span />
            <span>
              <i style={{ width: `${46 + ((index * 17) % 30)}%` }} />
              <i style={{ width: `${64 + ((index * 23) % 28)}%` }} />
            </span>
          </div>
        ))}
      {menu && (
        <ContextMenu
          point={menu.point}
          label={`Чат «${menu.chat.title}»`}
          items={chatActions(menu.chat, (action) => onAction(menu.chat, action))}
          onClose={() => setMenu(null)}
        />
      )}
      {!shown.length && loaded && (
        <div className="list-empty">
          <p>
            {archive
              ? 'Архив пуст'
              : filter === 'Непрочитанные'
                ? 'Всё прочитано'
                : 'Чатов пока нет'}
          </p>
          {filter === 'Все' && (
            <button className="secondary" onClick={onNew}>
              Новый чат
            </button>
          )}
        </div>
      )}
    </div>
  );
}
