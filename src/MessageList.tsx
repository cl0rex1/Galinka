import {
  Fragment,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { flushSync } from 'react-dom';
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock3,
  Forward,
  MoreHorizontal,
  Pin,
  Reply,
  RotateCw,
  Timer,
  X,
} from 'lucide-react';

import { Avatar } from './Avatar';
import { MessageMenuBody } from './MessageMenu';
import { fileLabel, isVideoNote, MediaAttachment } from './MediaAttachment';
import { bareKind, mentionsUser, MessageText, plainText, SelfContext } from './MessageText';
import { LinkPreviewCard } from './LinkPreview';
import { GalleryContext } from './gallery';
import { closeMenu, openMenu as showMenu } from './ui';
import type { Attachment, Chat, Message, Person } from './types';

const VIRTUAL_THRESHOLD = 120;
const OVERSCAN = 35;
const MIN_WINDOW = 80;
const DEFAULT_ROW_HEIGHT = 48;
const itemKey = (message: Message) => (message.nonce ? `n:${message.nonce}` : message.id);

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

/** A photo or video that belongs to an album (several sent at once). */
const inAlbum = (m: Message | undefined) =>
  Boolean(
    m?.album_id && m.file && /^(image|video)\//.test(m.file.mime || '') && !isVideoNote(m.file),
  );
const sameAlbum = (left: Message | undefined, right: Message | undefined) =>
  inAlbum(left) && inAlbum(right) && left!.album_id === right!.album_id;

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
  mention: (username: string) => void;
  retry: (message: Message) => void;
  discard: (message: Message) => void;
  /** Pin this message, or unpin it when it is the pinned one. */
  pin: (message: Message) => void;
  forward: (message: Message) => void;
  /** Start selecting with this message, or toggle it while selecting. */
  select: (message: Message) => void;
  edits: (message: Message) => void;
  votePoll: (message: Message, optionIndices: number[]) => void;
  closePoll: (message: Message) => void;
};
type RowProps = {
  message: Message;
  /** The whole album when this message opens one; its text is the last message's. */
  album?: Message[];
  own: boolean;
  /** True if the user may delete this message for everyone (or moderate in group). */
  canDeleteForAll: boolean;
  /** null when this user may not pin in this chat. */
  pinned: boolean | null;
  /** In selection mode taps toggle the message instead of opening anything. */
  selecting: boolean;
  selected: boolean;
  kind: Chat['kind'];
  continued: boolean;
  showAvatar: boolean;
  fresh: boolean;
  copied: boolean;
  sending: boolean;
  savingEdit: boolean;
  actions: MessageActions;
  highlight?: string;
  itemKey: string;
};
const interactive =
  'button, a, input, textarea, audio, video, details, [role="button"], [role="slider"]';
// The message's own content (a photo, a file, a round video, a quote) is a button for a tap,
// but a long press or right click on it still opens the message menu. Real controls do not.
const content =
  '.image-preview, .file-attachment, .video-note, .video-player video, .message-quote';
const holdable = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return false;
  const control = target.closest(interactive);
  return !control || control.matches(content) || Boolean(control.closest(content));
};

const MessageRow = memo(function MessageRow({
  message: m,
  album,
  own,
  canDeleteForAll,
  pinned,
  selecting,
  selected,
  kind,
  continued,
  showAvatar,
  fresh,
  copied,
  sending,
  savingEdit,
  actions,
  highlight,
  itemKey: rowKey,
}: RowProps) {
  const menu = useRef<HTMLDetailsElement>(null);
  const self = useContext(SelfContext);
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const held = useRef(false);
  const bot = !m.sender_id;
  const text = album ? album[album.length - 1] : m;
  const bare = !m.file && !m.poll && !m.link_preview ? bareKind(m.body) : null;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuPoint = useRef<{ x: number; y: number } | undefined>(undefined);
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
    menuPoint.current = point;
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
    if (selecting || event.pointerType === 'mouse' || !event.isPrimary || !holdable(event.target))
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
    <div className="message-group-item" data-item-key={rowKey}>
      <article
        data-message-id={m.id}
        className={`message-row ${fresh ? 'is-new' : ''} ${own ? 'own' : ''} ${bot ? 'bot' : ''} ${continued ? 'continued' : ''} ${showAvatar ? 'last' : ''} ${selected ? 'selected' : ''}`}
        aria-selected={selecting ? selected : undefined}
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
          if (selecting && !m.pending) {
            event.preventDefault();
            event.stopPropagation();
            actions.select(m);
            return;
          }
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
          if (selecting) {
            event.preventDefault();
            return;
          }
          if (!holdable(event.target)) return;
          event.preventDefault();
          cancelPress();
          openMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <span className="swipe-reply-indicator" aria-hidden="true">
          <Reply size={17} />
        </span>
        {selecting && !m.pending && (
          <span className="select-mark" aria-hidden="true">
            {selected && <Check size={14} strokeWidth={3} />}
          </span>
        )}
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
          <div
            className={`bubble ${bare ? `bare bare-${bare}` : ''} ${!own && kind === 'group' && (text.mention_all || mentionsUser(text.body, self)) ? 'mentions-me' : ''}`}
          >
            {!own && !continued && kind === 'group' && (
              <div className={`sender-name tone-text-${(m.sender.color ?? 2) % 6}`}>
                {m.sender.name}
                {bot && <span className="bot-tag">бот</span>}
              </div>
            )}
            {m.forwarded_from && (
              <div className="forwarded-from">
                <Forward size={13} />
                Переслано от <strong>{m.forwarded_from}</strong>
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
                    {plainText(m.reply.body) ||
                      (m.reply.file_name && fileLabel(m.reply.file_name)) ||
                      'Сообщение'}
                  </span>
                </div>
              </blockquote>
            )}
            {album ? (
              <div className={`album-grid n${album.length}`}>
                {album.map((item) => (
                  <MediaAttachment
                    key={item.id}
                    file={item.file!}
                    onDownload={() => actions.download(item.file!)}
                  />
                ))}
              </div>
            ) : (
              m.file && (
                <MediaAttachment file={m.file} onDownload={() => actions.download(m.file!)} />
              )
            )}
            {text.body && !m.poll && (
              <MessageText text={text.body} highlight={highlight} onMention={actions.mention} />
            )}
            {text.link_preview && <LinkPreviewCard preview={text.link_preview} />}
            {m.poll && (
              <div className="poll-card" role="group" aria-label={`Опрос: ${m.poll.question}`}>
                <div className="poll-question">{m.poll.question}</div>
                <div className="poll-meta">
                  {m.poll.anonymous ? 'Анонимный опрос' : 'Опрос'}
                  {m.poll.multiple ? ' · несколько ответов' : ''}
                  {m.poll.closed ? ' · завершён' : ''}
                </div>
                <div className="poll-options">
                  {m.poll.options.map((opt) => {
                    const pct =
                      m.poll!.total_votes > 0
                        ? Math.round((opt.votes / m.poll!.total_votes) * 100)
                        : 0;
                    return (
                      <button
                        key={opt.index}
                        type="button"
                        disabled={m.poll!.closed || m.pending}
                        className={`poll-option ${opt.voted ? 'voted' : ''}`}
                        onClick={() => {
                          const currentlyVoted = m
                            .poll!.options.filter((o) => o.voted)
                            .map((o) => o.index);
                          const next = m.poll!.multiple
                            ? opt.voted
                              ? currentlyVoted.filter((i) => i !== opt.index)
                              : [...currentlyVoted, opt.index]
                            : opt.voted
                              ? []
                              : [opt.index];
                          actions.votePoll(m, next);
                        }}
                      >
                        <span className="poll-option-bar" style={{ width: `${pct}%` }} />
                        <span className="poll-option-row">
                          <span className="poll-option-text">
                            {opt.voted && <Check size={14} />}
                            {opt.text}
                          </span>
                          <span className="poll-option-pct">
                            {m.poll!.total_votes > 0 ? `${pct}% (${opt.votes})` : ''}
                          </span>
                        </span>
                        {!m.poll!.anonymous && opt.voters && opt.voters.length > 0 && (
                          <span className="poll-option-voters">
                            {opt.voters
                              .slice(0, 4)
                              .map((v) => v.name)
                              .join(', ')}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="poll-footer">
                  <span>Голосов: {m.poll.total_votes}</span>
                  {!m.poll.closed && canDeleteForAll && (
                    <button
                      type="button"
                      className="poll-close-btn"
                      onClick={() => actions.closePoll(m)}
                    >
                      Завершить опрос
                    </button>
                  )}
                </div>
              </div>
            )}
            <span className="message-time">
              {m.expires_at && (
                <span className="message-expires" title="Сообщение с таймером автоудаления">
                  <Timer size={12} />
                </span>
              )}
              {m.edited_at && (
                <button
                  type="button"
                  className="message-edited"
                  title={`Изменено ${time(m.edited_at)}`}
                  onClick={() => actions.edits(m)}
                >
                  изменено
                </button>
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
        {!m.pending && !selecting && (
          <details
            ref={menu}
            className="message-menu"
            onToggle={(event) => setMenuOpen(event.currentTarget.open)}
          >
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
              <MessageMenuBody
                m={m}
                own={own}
                kind={kind}
                pinned={pinned}
                copied={copied}
                sending={sending}
                savingEdit={savingEdit}
                open={menuOpen}
                actions={actions}
                close={() => menu.current && closeMenu(menu.current)}
                reposition={() => menu.current && actions.menu(menu.current, menuPoint.current)}
              />
            </div>
          </details>
        )}
      </article>
    </div>
  );
});

function computeRange(
  messages: Message[],
  heights: Map<string, number>,
  scroller: HTMLElement | null,
  listEl: HTMLElement | null,
  awayFromBottom: boolean | undefined,
  revealTarget: { index: number; until: number } | null,
) {
  const count = messages.length;
  if (count <= VIRTUAL_THRESHOLD) {
    return { start: 0, end: count, firstVisible: 0, lastVisible: count };
  }
  let start = 0;
  let end = count;
  let firstVisible = 0;
  let lastVisible = count;
  if (!scroller || !listEl || (awayFromBottom === false && scroller.scrollTop === 0)) {
    start = awayFromBottom === false ? Math.max(0, count - MIN_WINDOW) : 0;
    end = Math.min(count, start + MIN_WINDOW);
    firstVisible = start;
    lastVisible = end;
  } else {
    let total = 0;
    const offsets = new Float64Array(count + 1);
    for (let i = 0; i < count; i++) {
      offsets[i] = total;
      total += heights.get(itemKey(messages[i])) ?? DEFAULT_ROW_HEIGHT;
    }
    offsets[count] = total;

    const scrollerRect = scroller.getBoundingClientRect();
    const listRect = listEl.getBoundingClientRect();
    const listTop = listRect.top - scrollerRect.top + scroller.scrollTop;
    const viewTop = Math.max(0, scroller.scrollTop - listTop);
    const viewBottom = viewTop + Math.max(scroller.clientHeight, 480);

    while (firstVisible < count - 1 && offsets[firstVisible + 1] < viewTop) firstVisible++;
    lastVisible = firstVisible + 1;
    while (lastVisible < count && offsets[lastVisible] <= viewBottom) lastVisible++;

    start = Math.max(0, firstVisible - OVERSCAN);
    end = Math.min(count, lastVisible + OVERSCAN);
    if (end - start < MIN_WINDOW) {
      const deficit = MIN_WINDOW - (end - start);
      const addAfter = Math.min(count - end, Math.ceil(deficit / 2));
      end += addAfter;
      start = Math.max(0, start - (deficit - addAfter));
    }
  }
  if (revealTarget && Date.now() < revealTarget.until) {
    const idx = Math.max(0, Math.min(count - 1, revealTarget.index));
    if (idx < start + 10 || idx >= end - 10) {
      start = Math.max(0, Math.min(idx - Math.floor(MIN_WINDOW / 2), count - MIN_WINDOW));
      end = Math.min(count, start + MIN_WINDOW);
    }
  }
  return { start, end, firstVisible, lastVisible };
}

export const MessageList = memo(function MessageList({
  messages,
  meId,
  meUsername = '',
  kind,
  moderator,
  unreadFrom,
  pinnedId,
  canPin,
  selection,
  newMessageIds,
  copiedId,
  sending,
  savingEdit,
  awayFromBottom,
  actions,
  highlight,
}: {
  messages: Message[];
  meId: string;
  /** Login of the viewer: messages that name it are lit up. */
  meUsername?: string;
  kind: Chat['kind'];
  /** The group owner may delete anyone's messages. */
  moderator?: boolean;
  /** A "new messages" divider goes above this message. */
  unreadFrom?: string | null;
  pinnedId?: string | null;
  canPin: boolean;
  /** Selected message ids, or null outside selection mode. */
  selection: Set<string> | null;
  newMessageIds: string[];
  copiedId: string | null;
  sending: boolean;
  savingEdit: boolean;
  awayFromBottom?: boolean;
  actions: MessageActions;
  highlight?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const gallery = useMemo(
    () => ({
      photos: messages
        .filter(
          (m) => !m.pending && m.file && /^image\/(png|jpeg|gif|webp)$/.test(m.file.mime || ''),
        )
        .map((m) => ({
          file: m.file!,
          sender: m.sender,
          at: m.created_at,
          caption: plainText(m.body).trim() || undefined,
        })),
      download: (file: Attachment) => actions.download(file),
    }),
    [messages, actions],
  );
  const heightsRef = useRef<Map<string, number>>(new Map());
  const anchorRef = useRef<{ key: string; offset: number } | null>(null);
  const revealTargetRef = useRef<{ index: number; until: number } | null>(null);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const latestRef = useRef({ messages, awayFromBottom, range });
  latestRef.current = { messages, awayFromBottom, range };

  const measureRows = useCallback(() => {
    const listEl = listRef.current;
    if (!listEl) return;
    listEl.querySelectorAll<HTMLElement>('.message-group-item[data-item-key]').forEach((item) => {
      const key = item.dataset.itemKey;
      if (!key) return;
      const row = item.firstElementChild as HTMLElement | null;
      const margin = row ? parseFloat(getComputedStyle(row).marginTop) || 0 : 0;
      const h = item.offsetHeight + margin;
      if (h > 0) heightsRef.current.set(key, h);
    });
  }, []);

  const updateWindow = useCallback(() => {
    const listEl = listRef.current;
    const scroller = listEl?.closest<HTMLElement>('.messages') ?? null;
    const { messages: msgs, awayFromBottom: away, range: cur } = latestRef.current;
    if (!listEl || !scroller || msgs.length <= VIRTUAL_THRESHOLD) {
      if (cur !== null) setRange(null);
      return;
    }
    if (revealTargetRef.current && Date.now() >= revealTargetRef.current.until) {
      revealTargetRef.current = null;
    }
    const next = computeRange(
      msgs,
      heightsRef.current,
      scroller,
      listEl,
      away,
      revealTargetRef.current,
    );
    if (
      cur &&
      next.firstVisible >= cur.start + 10 &&
      next.lastVisible <= cur.end - 10 &&
      !(cur.start > 0 && next.firstVisible <= OVERSCAN) &&
      !(cur.end < msgs.length && next.lastVisible + OVERSCAN >= msgs.length)
    ) {
      return;
    }
    if (cur && next.start === cur.start && next.end === cur.end) return;
    if (away !== false && scroller.scrollTop > 0 && !revealTargetRef.current) {
      const scrollerTop = scroller.getBoundingClientRect().top;
      const items = listEl.querySelectorAll<HTMLElement>('.message-group-item[data-item-key]');
      for (const item of items) {
        const top = item.getBoundingClientRect().top - scrollerTop;
        if (top + item.offsetHeight > 0 && item.dataset.itemKey) {
          anchorRef.current = { key: item.dataset.itemKey, offset: top };
          break;
        }
      }
    }
    setRange({ start: next.start, end: next.end });
  }, []);

  useEffect(() => {
    const listEl = listRef.current;
    const scroller = listEl?.closest<HTMLElement>('.messages') ?? null;
    if (!listEl || !scroller) return;
    const onScroll = () => updateWindow();
    const onReveal = (event: Event) => {
      const index = (event as CustomEvent<{ index?: number }>).detail?.index;
      const msgs = latestRef.current.messages;
      if (
        typeof index !== 'number' ||
        index < 0 ||
        index >= msgs.length ||
        msgs.length <= VIRTUAL_THRESHOLD
      )
        return;
      anchorRef.current = null;
      const start = Math.max(
        0,
        Math.min(index - Math.floor(MIN_WINDOW / 2), msgs.length - MIN_WINDOW),
      );
      const end = Math.min(msgs.length, start + MIN_WINDOW);
      revealTargetRef.current = { index, until: Date.now() + 900 };
      flushSync(() => setRange({ start, end }));
    };
    const observer = new ResizeObserver(() => {
      measureRows();
      updateWindow();
    });
    observer.observe(listEl);
    observer.observe(scroller);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    scroller.addEventListener('galinka:reveal', onReveal);
    return () => {
      observer.disconnect();
      scroller.removeEventListener('scroll', onScroll);
      scroller.removeEventListener('galinka:reveal', onReveal);
    };
  }, [measureRows, updateWindow]);

  let start = 0;
  let end = messages.length;
  if (messages.length > VIRTUAL_THRESHOLD) {
    if (range) {
      start = Math.min(range.start, Math.max(0, messages.length - 1));
      end = Math.min(messages.length, range.end);
      if (awayFromBottom === false) {
        end = messages.length;
        start = Math.max(0, Math.min(start, end - MIN_WINDOW), end - (MIN_WINDOW + 30));
      } else if (end - start < MIN_WINDOW) {
        end = Math.min(messages.length, start + MIN_WINDOW);
        start = Math.max(0, end - MIN_WINDOW);
      }
    } else {
      start = awayFromBottom === false ? Math.max(0, messages.length - MIN_WINDOW) : 0;
      end = Math.min(messages.length, start + MIN_WINDOW);
    }
  }

  useLayoutEffect(() => {
    measureRows();
    const anchor = anchorRef.current;
    anchorRef.current = null;
    if (!anchor) return;
    const listEl = listRef.current;
    const scroller = listEl?.closest<HTMLElement>('.messages');
    if (!listEl || !scroller) return;
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(anchor.key) : anchor.key;
    const target = listEl.querySelector<HTMLElement>(
      `.message-group-item[data-item-key="${escaped}"]`,
    );
    if (!target) return;
    const actual = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    if (Math.abs(actual - anchor.offset) >= 1) {
      scroller.scrollTop += actual - anchor.offset;
    }
  }, [messages, start, end, selection, highlight, measureRows]);

  let topSpacer = 0;
  let bottomSpacer = 0;
  if (messages.length > VIRTUAL_THRESHOLD) {
    const heights = heightsRef.current;
    for (let i = 0; i < start; i++)
      topSpacer += heights.get(itemKey(messages[i])) ?? DEFAULT_ROW_HEIGHT;
    for (let i = end; i < messages.length; i++)
      bottomSpacer += heights.get(itemKey(messages[i])) ?? DEFAULT_ROW_HEIGHT;
  }

  const fresh = new Set(newMessageIds);
  const today = new Date().toDateString();
  // One section per day so the date pill can stick to the top while that day scrolls by.
  const days: { key: string; label: string; items: number[] }[] = [];
  for (let index = start; index < end; index++) {
    const message = messages[index];
    if (!days.length || !sameDay(messages[index - 1], message)) {
      const date = new Date(message.created_at);
      days.push({
        key: date.toDateString(),
        label: date.toDateString() === today ? 'Сегодня' : dayFormatter.format(date),
        items: [],
      });
    }
    days.at(-1)!.items.push(index);
  }
  return (
    <GalleryContext.Provider value={gallery}>
      <SelfContext.Provider value={meUsername}>
      <div ref={listRef} className={`message-list kind-${kind}`}>
        {topSpacer > 0 && (
          <div
            className="message-spacer"
            style={{ height: topSpacer, flexShrink: 0 }}
            aria-hidden="true"
          />
        )}
        {days.map((day) => (
          <section className="message-day" key={day.key}>
            <div className="date-divider">
              <span>{day.label}</span>
            </div>
            {day.items.map((index) => {
              const message = messages[index];
              const key = itemKey(message);
              // An album is drawn once, by its first message; the rest are folded into it.
              if (index > start && sameAlbum(messages[index - 1], message)) return null;
              let album: Message[] | undefined;
              if (inAlbum(message)) {
                album = [message];
                while (sameAlbum(album.at(-1), messages[index + album.length]))
                  album.push(messages[index + album.length]);
                if (album.length < 2) album = undefined;
              }
              const last = index + (album?.length ?? 1) - 1;
              return (
                // Keyed by nonce: the server's copy replaces a just-sent bubble without a remount.
                <Fragment key={key}>
                  {message.id === unreadFrom && (
                    <div className="unread-divider" role="separator">
                      <span>Новые сообщения</span>
                    </div>
                  )}
                  <MessageRow
                    message={message}
                    album={album}
                    itemKey={key}
                    own={message.sender_id === meId}
                    canDeleteForAll={message.sender_id === meId || Boolean(moderator)}
                    pinned={canPin ? message.id === pinnedId : null}
                    selecting={Boolean(selection)}
                    selected={Boolean(selection?.has(message.id))}
                    kind={kind}
                    continued={grouped(messages[index - 1], message)}
                    showAvatar={!grouped(messages[last], messages[last + 1])}
                    fresh={fresh.has(message.id)}
                    copied={copiedId === message.id}
                    sending={sending}
                    savingEdit={savingEdit}
                    actions={actions}
                    highlight={highlight}
                  />
                </Fragment>
              );
            })}
          </section>
        ))}
        {bottomSpacer > 0 && (
          <div
            className="message-spacer"
            style={{ height: bottomSpacer, flexShrink: 0 }}
            aria-hidden="true"
          />
        )}
      </div>
      </SelfContext.Provider>
    </GalleryContext.Provider>
  );
});
