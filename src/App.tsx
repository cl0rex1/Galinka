import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useMemo,
  useId,
  Fragment,
  type ReactNode,
  type FormEvent,
} from 'react';
import {
  MessageCircle,
  Search,
  Plus,
  Users,
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  Settings,
  LogOut,
  Download,
  Bookmark,
  SlidersHorizontal,
  X,
  Paperclip,
  Smile,
  Check,
  Reply,
  Pencil,
  Pin,
  PinOff,
  Bell,
  BellOff,
  Archive,
  ArchiveRestore,
  ChevronDown,
  Info,
  Sparkles,
  Leaf,
  Lock,
  MoreHorizontal,
  Copy,
  Link,
  LoaderCircle,
  WifiOff,
  Compass,
  Puzzle,
  ArrowUp,
  ArrowDown,
  Megaphone,
} from 'lucide-react';
import { useConversationGestures } from './gestures';
import { Avatar } from './Avatar';
import { MessageList, type MessageActions } from './MessageList';
import { AttachmentPreview, type Transfer } from './AttachmentPreview';
import { GroupSettings } from './GroupSettings';
import { VoiceRecorder } from './VoiceRecorder';
import { getDemoFileUrl } from './demo';
import { Announcements } from './Announcements';
import { api, upload, ApiError, isDemo, API_BASE } from './api';
import { Updates, useUpdates } from './updates';
import { MotionSettings } from './motion';
import { ThemePicker, ThemeToggle } from './theme';
import { NotificationSettings, useNotifications, isNative, clearPushDevice } from './notifications';
import { App as NativeApp } from '@capacitor/app';
import type { Person, Chat, Message, Attachment } from './types';

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
type ModalKind = 'new' | 'install' | 'profile' | 'invite' | 'delete' | 'group' | null;
const timeFormatter = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' });
const time = (date: string) => timeFormatter.format(new Date(date));
// Reuse unchanged API objects so receipts/polling do not repaint every message.
function reconcileMessages(previous: Message[], incoming: Message[]) {
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
type CachedConversation = {
  messages: Message[];
  hasOlder: boolean;
  top: number;
  following: boolean;
};
const plural = (n: number) =>
  n % 10 === 1 && n % 100 !== 11
    ? 'участник'
    : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
      ? 'участника'
      : 'участников';
function IconButton({
  label,
  children,
  onClick,
  className = '',
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function Modal({
  title,
  onClose,
  children,
  error,
  closeDisabled = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  error?: string;
  closeDisabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!closeDisabled) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !closeDisabled) onClose();
      }}
      className="modal"
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <IconButton label="Закрыть" disabled={closeDisabled} onClick={onClose}>
          <X size={20} />
        </IconButton>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {children}
    </dialog>
  );
}
export function Auth({
  onLogin,
  onDemo,
}: {
  onLogin: (person: Person) => void;
  onDemo?: () => void;
}) {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError('');
    try {
      onLogin(await api<Person>(register ? '/auth/register' : '/auth/login', 'POST', data));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-story">
        <a className="brand" href="/app">
          <img src="/icon.svg" alt="" />
          galinka
        </a>
        <div className="auth-intro">
          <span className="small-label">
            <span className="status-dot" /> Для вашей компании
          </span>
          <h1>
            Место,
            <br />
            где свои.
          </h1>
          <p>
            Те самые разговоры до ночи.
            <br />
            Спонтанные планы. И просто «как ты?».
          </p>
          <div className="auth-note">
            <Leaf size={22} />
            <span>
              Маленький мессенджер.
              <br />
              <strong>Большая дружба.</strong>
            </span>
          </div>
        </div>
        <div className="auth-bottom">
          <span>Ваши люди. Ваши разговоры.</span>
          <span>Galinka · {__APP_VERSION__}</span>
        </div>
      </section>
      <section className="auth-form-side">
        <div className="auth-theme">
          <ThemeToggle />
        </div>
        <div className="auth-form-wrap">
          <span className="auth-icon">
            <MessageCircle size={28} />
          </span>
          <h2>{register ? 'Регистрация' : 'С возвращением'}</h2>
          <p className="muted">
            {register ? 'Создайте аккаунт по приглашению.' : 'Войдите, чтобы продолжить.'}
          </p>
          {onDemo && (
            <div className="auth-tabs">
              <button
                className={!register ? 'selected' : ''}
                onClick={() => {
                  setRegister(false);
                  setError('');
                }}
              >
                Войти
              </button>
              <button
                className={register ? 'selected' : ''}
                onClick={() => {
                  setRegister(true);
                  setError('');
                }}
              >
                Создать аккаунт
              </button>
            </div>
          )}
          <form onSubmit={submit}>
            {register && (
              <label>
                Имя
                <input
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={40}
                  placeholder="Например, Саша"
                />
              </label>
            )}
            <label>
              Логин
              <input
                name="username"
                autoComplete="username"
                required
                minLength={3}
                maxLength={24}
                pattern="[a-zA-Z0-9_]{3,24}"
                placeholder="sasha"
                autoCapitalize="none"
                spellCheck={false}
              />
            </label>
            <label>
              Пароль
              <input
                name="password"
                type="password"
                autoComplete={register ? 'new-password' : 'current-password'}
                required
                minLength={10}
                maxLength={128}
                placeholder="Не менее 10 символов"
              />
            </label>
            {register && (
              <label>
                Код приглашения
                <input name="invite" required autoComplete="off" placeholder="Код приглашения" />
                <small>Galinka пока для друзей. Попросите код у того, кто вас позвал.</small>
              </label>
            )}
            <p className="form-error" role="alert">
              {error}
            </p>
            <button className="primary wide" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <>
                  {register ? 'Создать аккаунт' : 'Войти'}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          {onDemo && (
            <>
              <div className="auth-divider">
                <span>или</span>
              </div>
              <button className="secondary wide" onClick={onDemo}>
                Открыть демо
                <ArrowUpRight size={17} />
              </button>
            </>
          )}
          <p className="auth-footnote">
            <Lock size={13} /> Войдите, чтобы продолжить общение.
          </p>
        </div>
      </section>
    </main>
  );
}
function NewChat({
  onCreated,
  onClose,
}: {
  onCreated: (id: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<'direct' | 'group'>('direct'),
    [query, setQuery] = useState(''),
    [title, setTitle] = useState(''),
    [results, setResults] = useState<Person[]>([]),
    [selected, setSelected] = useState<Person[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [searching, setSearching] = useState(false);
  useEffect(() => {
    let valid = true;
    setError('');
    if (query.trim().length < 2) {
      setSearching(false);
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      api<Person[]>(`/users?q=${encodeURIComponent(query)}`)
        .then((data) => {
          if (valid) setResults(data);
        })
        .catch((e) => {
          if (valid) setError(e.message);
        })
        .finally(() => {
          if (valid) setSearching(false);
        });
    }, 250);
    return () => {
      valid = false;
      clearTimeout(timer);
    };
  }, [query]);
  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ id: string }>('/chats', 'POST', {
        kind,
        title: kind === 'group' ? title : undefined,
        userIds: selected.map((p) => p.id),
      });
      await onCreated(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Новый чат" onClose={onClose}>
      <div className="segmented">
        <button
          className={kind === 'direct' ? 'selected' : ''}
          onClick={() => {
            setKind('direct');
            setSelected([]);
          }}
        >
          Личный чат
        </button>
        <button
          className={kind === 'group' ? 'selected' : ''}
          onClick={() => {
            setKind('group');
            setSelected([]);
          }}
        >
          Новая группа
        </button>
      </div>
      <form onSubmit={create}>
        {kind === 'group' && (
          <label>
            Название группы
            <input
              required
              maxLength={70}
              placeholder="Например, На выходные"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
        )}
        <label>
          Найти пользователя
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Имя или логин"
          />
        </label>
        {selected.length > 0 && (
          <div className="selected-people">
            {selected.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => setSelected((s) => s.filter((v) => v.id !== p.id))}
              >
                {p.name}
                <X size={14} />
              </button>
            ))}
          </div>
        )}
        <div className="people-results">
          {searching && <span className="muted">Ищем друзей…</span>}
          {results.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() =>
                setSelected((s) =>
                  kind === 'direct'
                    ? [p]
                    : s.some((v) => v.id === p.id)
                      ? s.filter((v) => v.id !== p.id)
                      : [...s, p],
                )
              }
            >
              <Avatar person={p} />
              <span>
                <strong>{p.name}</strong>
                <small>@{p.username}</small>
              </span>
              {selected.some((v) => v.id === p.id) && <Check size={19} />}
            </button>
          ))}
          {query.length >= 2 && !searching && results.length === 0 && (
            <p className="muted">Никого не найдено.</p>
          )}
          {query.length < 2 && (
            <p className="muted">
              Введите не менее 2 символов.
              {kind === 'group' ? ' Участников также можно пригласить ссылкой.' : ''}
            </p>
          )}
        </div>
        <p className="form-error" role="alert">
          {error}
        </p>
        <button className="primary wide" disabled={busy || (kind === 'direct' && !selected.length)}>
          {busy ? (
            <LoaderCircle className="spin" size={18} />
          ) : (
            <>
              {kind === 'group' ? 'Создать группу' : 'Написать'}
              <ArrowRight size={18} />
            </>
          )}
        </button>
      </form>
    </Modal>
  );
}
export default function App() {
  const updates = useUpdates();
  const [me, setMe] = useState<Person | null>(null),
    [ready, setReady] = useState(false),
    [demo, setDemo] = useState(isDemo),
    [chats, setChats] = useState<Chat[]>([]),
    [activeId, setActiveId] = useState<string | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [members, setMembers] = useState<Person[]>([]),
    [section, setSection] = useState<'chats' | 'modules' | 'announcements' | 'settings'>('chats'),
    [modal, setModal] = useState<ModalKind>(null),
    [filter, setFilter] = useState('Все'),
    [listQuery, setListQuery] = useState(''),
    [searchOpen, setSearchOpen] = useState(false),
    [messageQuery, setMessageQuery] = useState(''),
    [infoOpen, setInfoOpen] = useState(false),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [replies, setReplies] = useState<Record<string, Message>>({}),
    [editing, setEditing] = useState<{ message: Message; body: string } | null>(null),
    [savingEdit, setSavingEdit] = useState(false),
    [copiedMessageId, setCopiedMessageId] = useState<string | null>(null),
    [preferenceBusy, setPreferenceBusy] = useState(false),
    [sendingIds, setSendingIds] = useState<string[]>([]),
    [transfers, setTransfers] = useState<Record<string, Transfer>>({}),
    [attachments, setAttachments] = useState<Record<string, { file: File; uploaded?: Attachment }>>(
      {},
    ),
    [awayFromBottom, setAwayFromBottom] = useState(false),
    [newMessageIds, setNewMessageIds] = useState<string[]>([]),
    [error, setError] = useState(''),
    [connected, setConnected] = useState(true),
    [loading, setLoading] = useState(false),
    [hasOlder, setHasOlder] = useState(false),
    [paging, setPaging] = useState(false),
    [install, setInstall] = useState<InstallEvent | null>(null),
    [inviteUrl, setInviteUrl] = useState(''),
    [deleteId, setDeleteId] = useState(''),
    [name, setName] = useState(''),
    [copied, setCopied] = useState(false),
    [emojiOpen, setEmojiOpen] = useState(false),
    [working, setWorking] = useState(false);
  const initialized = useRef(false);
  const conversationCache = useRef(new Map<string, CachedConversation>());
  const cacheOwner = useRef<string | null>(null);
  const cachedScroll = useRef<{
    id: string;
    top: number;
    following: boolean;
    messages: Message[];
  } | null>(null);
  const draftSnapshot = useRef<{ id: string; drafts: Record<string, string> } | null>(null);
  if (me) draftSnapshot.current = { id: me.id, drafts };
  const sectionRef = useRef(section);
  sectionRef.current = section;
  const activeRef = useRef(activeId),
    queryRef = useRef(messageQuery),
    bottomRef = useRef<HTMLDivElement>(null),
    scroller = useRef<HTMLDivElement>(null),
    textarea = useRef<HTMLTextAreaElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    requestEpoch = useRef(0),
    chatRequestEpoch = useRef(0),
    nonces = useRef<Record<string, string>>({}),
    sendingChats = useRef(new Set<string>()),
    lastRead = useRef<Record<string, string>>({}),
    messagesRef = useRef(messages),
    scrollRestore = useRef<{ id: string; top: number; height: number } | null>(null),
    joined = useRef(false),
    followBottom = useRef(true),
    jumpingToLatest = useRef(false),
    editRequest = useRef(false);
  activeRef.current = activeId;
  queryRef.current = messageQuery;
  messagesRef.current = messages;
  const active = chats.find((c) => c.id === activeId),
    draft = activeId ? drafts[activeId] || '' : '',
    attachment = activeId ? attachments[activeId]?.file : undefined,
    sending = activeId ? sendingIds.includes(activeId) : false,
    reply = activeId ? replies[activeId] : undefined,
    edit = editing?.message.chat_id === activeId ? editing : null,
    composerValue = edit ? edit.body : draft,
    savingCurrentEdit = Boolean(edit && savingEdit);
  const report = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) {
      // A revoked/expired session must stop rendering private conversation data.
      ++requestEpoch.current;
      ++chatRequestEpoch.current;
      initialized.current = false;
      conversationCache.current.clear();
      lastRead.current = {};
      nonces.current = {};
      setMe(null);
      setActiveId(null);
      setChats([]);
      setMessages([]);
      setMembers([]);
      setAttachments({});
      setTransfers({});
      setDrafts({});
      setReplies({});
      setEditing(null);
      setModal(null);
      setInfoOpen(false);
      setSearchOpen(false);
      setMessageQuery('');
      setSection('chats');
      setError(
        'Сессия завершена. Войдите снова — ваши текстовые черновики сохранены на этом устройстве.',
      );
      return;
    }
    setError((e as Error).message || 'Не удалось выполнить действие.');
  }, []);
  const handleLogin = useCallback((person: Person) => {
    if (cacheOwner.current !== person.id) conversationCache.current.clear();
    cacheOwner.current = person.id;
    let saved: Record<string, string> = {};
    try {
      const value = JSON.parse(localStorage.getItem(`galinka-drafts:${person.id}`) || '{}');
      if (value && typeof value === 'object' && !Array.isArray(value))
        saved = Object.fromEntries(
          Object.entries(value)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
            .slice(0, 200)
            .map(([id, text]) => [id, text.slice(0, 8000)]),
        );
    } catch {
      /* Private browsing may disable local storage. */
    }
    setError('');
    setConnected(navigator.onLine);
    setDrafts(saved);
    setMe(person);
  }, []);
  const persistDrafts = useCallback(() => {
    const snapshot = draftSnapshot.current;
    if (!snapshot) return;
    try {
      const saved = Object.fromEntries(
        Object.entries(snapshot.drafts).filter(([, value]) => value.length > 0),
      );
      if (Object.keys(saved).length)
        localStorage.setItem(`galinka-drafts:${snapshot.id}`, JSON.stringify(saved));
      else localStorage.removeItem(`galinka-drafts:${snapshot.id}`);
    } catch {
      /* Storage limits must not interrupt typing or sending. */
    }
  }, []);
  useEffect(() => {
    if (!me) {
      persistDrafts();
      return;
    }
    const timer = setTimeout(persistDrafts, 200);
    return () => clearTimeout(timer);
  }, [drafts, me?.id, persistDrafts]);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) persistDrafts();
    };
    window.addEventListener('pagehide', persistDrafts);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', persistDrafts);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [persistDrafts]);
  const notifications = useNotifications(me?.id, demo, (id) => {
    setActiveId(id);
    setSection('chats');
    setSearchOpen(false);
    setMessageQuery('');
  });
  const notificationRef = useRef(notifications);
  notificationRef.current = notifications;
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const gestures = useConversationGestures({
    enabled: Boolean(activeId && !sending && !modal && !editing && !searchOpen),
    chatId: activeId,
    onReply: (id) => {
      const message = messagesRef.current.find((item) => item.id === id);
      if (message) startReply(message);
    },
    onBack: () => {
      setActiveId(null);
      setInfoOpen(false);
    },
  });
  const unreadCount = chats
    .filter((chat) => !chat.muted)
    .reduce((total, chat) => total + chat.unread, 0);
  useEffect(() => {
    document.title = unreadCount ? `(${unreadCount}) Galinka` : 'Galinka';
    const badge = navigator as Navigator & {
      setAppBadge?: (count: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (!demo) {
      const result = unreadCount ? badge.setAppBadge?.(unreadCount) : badge.clearAppBadge?.();
      void result?.catch(() => {});
    }
  }, [unreadCount, demo]);
  useEffect(() => {
    if (!isNative) return;
    const back = NativeApp.addListener('backButton', () => {
      if (modal) setModal(null);
      else if (emojiOpen) setEmojiOpen(false);
      else if (edit) setEditing(null);
      else if (document.querySelector('details.message-menu[open], details.chat-actions[open]'))
        document
          .querySelectorAll('details.message-menu[open], details.chat-actions[open]')
          .forEach((menu) => menu.removeAttribute('open'));
      else if (infoOpen) setInfoOpen(false);
      else if (searchOpen) {
        setSearchOpen(false);
        setMessageQuery('');
      } else if (section !== 'chats') setSection('chats');
      else if (activeId) setActiveId(null);
      else void NativeApp.minimizeApp();
    });
    return () => {
      void back.then((handle) => handle.remove());
    };
  }, [modal, emojiOpen, infoOpen, searchOpen, section, activeId, edit]);
  useEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = 'auto';
    textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 160)}px`;
  }, [composerValue]);
  useEffect(() => {
    if (new URLSearchParams(location.search).has('demo')) {
      sessionStorage.setItem('galinka-demo', 'true');
      setDemo(true);
    }
    api<Person>('/me')
      .then(handleLogin)
      .catch((e) => {
        if (!(e instanceof ApiError) || e.status !== 401)
          setError('Не удалось подключиться к серверу. Демоверсия доступна ниже.');
      })
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    const handle = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', handle);
    return () => window.removeEventListener('beforeinstallprompt', handle);
  }, []);
  const refreshChats = useCallback(async () => {
    const epoch = ++chatRequestEpoch.current;
    const data = await api<Chat[]>('/chats');
    if (epoch !== chatRequestEpoch.current) return data;
    setChats(data);
    if (!initialized.current) {
      initialized.current = true;
      if (
        !window.matchMedia(
          '(max-width: 800px), (max-width: 960px) and (max-height: 500px) and (pointer: coarse)',
        ).matches
      )
        setActiveId((id) => id || data.find((chat) => !chat.archived)?.id || null);
    }
    return data;
  }, []);
  const markRead = useCallback(
    async (id: string, lastMessageId: string) => {
      if (
        queryRef.current ||
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
    [refreshChats, report],
  );
  const loadMessages = useCallback(
    async (id: string, reset = false) => {
      if (activeRef.current !== id) return;
      const epoch = ++requestEpoch.current,
        q = queryRef.current;
      const data = await api<Message[]>(
        `/chats/${id}/messages${q ? `?q=${encodeURIComponent(q)}` : ''}`,
      );
      if (activeRef.current !== id || epoch !== requestEpoch.current || queryRef.current !== q)
        return;
      const previous = messagesRef.current;
      const latest = previous.at(-1);
      const freshIds =
        !reset && !q && latest
          ? data
              .filter(
                (m) =>
                  !previous.some((old) => old.id === m.id) && m.created_at >= latest.created_at,
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
        if (reset || q || data.length < 60) return reconcileMessages(prev, data);
        const overlap = prev.findIndex((m) => m.id === data[0].id);
        return reconcileMessages(prev, overlap > 0 ? [...prev.slice(0, overlap), ...data] : data);
      });
      // A non-overlapping window means over 60 new messages arrived while offline.
      // Expose older history again; retaining the old "fully loaded" flag would hide it.
      if (reset || q || boundary < 0 || data.length < 60) setHasOlder(data.length === 60);
      if (!q && data.length) await markRead(id, data.at(-1)!.id);
    },
    [markRead],
  );
  useEffect(() => {
    if (!me) return;
    let live = true;
    const reportLive = (error: unknown) => {
      if (live) report(error);
    };
    refreshChats().catch(reportLive);
    const token = new URLSearchParams(location.search).get('join');
    if (token && !joined.current && !demo) {
      joined.current = true;
      api<{ id: string }>('/join', 'POST', { token })
        .then(async (r) => {
          await refreshChats();
          setActiveId(r.id);
          history.replaceState({}, '', location.pathname);
        })
        .catch(reportLive);
    }
    if (demo)
      return () => {
        live = false;
      };
    const events = new EventSource(`${API_BASE}/events`, { withCredentials: true });
    let syncTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingList = false,
      pendingMessages = false;
    const sync = (chatId?: string, readOnly = false) => {
      if (!live) return;
      pendingList ||= !readOnly;
      pendingMessages ||= Boolean(activeRef.current && (!chatId || chatId === activeRef.current));
      if (syncTimer) return;
      syncTimer = setTimeout(() => {
        syncTimer = undefined;
        if (!live) return;
        const list = pendingList,
          conversation = pendingMessages;
        pendingList = pendingMessages = false;
        if (list) refreshChats().catch(reportLive);
        if (conversation && activeRef.current) loadMessages(activeRef.current).catch(reportLive);
      }, 100);
    };
    events.onmessage = (event) => {
      if (!live) return;
      setConnected(true);
      try {
        const change = JSON.parse(event.data) as {
          type: string;
          chatId?: string;
          event?: string;
          senderId?: string;
          messageId?: string;
          deletedId?: string;
          removedUserId?: string;
        };
        if (change.event === 'message.created' && change.chatId && change.senderId !== me.id) {
          const target = chatsRef.current.find((chat) => chat.id === change.chatId);
          const notifyIncoming = (chat: Chat | undefined) => {
            if (
              live &&
              chat &&
              !chat.muted &&
              !(
                document.visibilityState === 'visible' &&
                document.hasFocus() &&
                activeRef.current === chat.id &&
                sectionRef.current === 'chats'
              )
            )
              notificationRef.current.notify(chat.id);
          };
          if (target) notifyIncoming(target);
          else if (window.galinkaDesktop)
            void refreshChats()
              .then((items) => notifyIncoming(items.find((chat) => chat.id === change.chatId)))
              .catch(reportLive);
        }
        if (change.removedUserId === me.id && change.chatId) {
          const removedId = change.chatId;
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
        if (change.deletedId) {
          setMessages((prev) => prev.filter((m) => m.id !== change.deletedId));
          setEditing((previous) => (previous?.message.id === change.deletedId ? null : previous));
          setReplies((previous) =>
            Object.fromEntries(
              Object.entries(previous).filter(([, message]) => message.id !== change.deletedId),
            ),
          );
        }
        sync(change.chatId, change.type === 'read');
      } catch {
        sync();
      }
    };
    let checkingSession = false;
    events.onerror = () => {
      if (!live) return;
      setConnected(false);
      if (checkingSession) return;
      checkingSession = true;
      api<Person>('/me')
        .catch((e) => {
          if (live && e instanceof ApiError && e.status === 401) report(e);
        })
        .finally(() => {
          checkingSession = false;
        });
    };
    const visible = () => {
      if (document.visibilityState === 'visible') sync();
    };
    const online = () => sync();
    const offline = () => setConnected(false);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    // Recover missed events and unread state after background suspension or a proxy interruption.
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') sync();
    }, 30000);
    return () => {
      live = false;
      events.close();
      clearTimeout(syncTimer);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [me?.id, demo, refreshChats, loadMessages, report]);
  useEffect(() => {
    if (!activeId || (!infoOpen && modal !== 'group') || !me) return;
    const controller = new AbortController();
    api<Person[]>(`/chats/${activeId}/members`, 'GET', undefined, { signal: controller.signal })
      .then(setMembers)
      .catch((error) => {
        if (!controller.signal.aborted) report(error);
      });
    return () => controller.abort();
  }, [activeId, active?.member_count, active?.owner_id, infoOpen, modal, me?.id, report]);
  useLayoutEffect(() => {
    if (!activeId || !me) return;
    let valid = true;
    const cached = !messageQuery ? conversationCache.current.get(activeId) : undefined;
    setLoading(!cached);
    setPaging(false);
    setAwayFromBottom(cached ? !cached.following : false);
    setNewMessageIds([]);
    jumpingToLatest.current = false;
    scrollRestore.current = null;
    cachedScroll.current = cached
      ? { id: activeId, top: cached.top, following: cached.following, messages: cached.messages }
      : null;
    setMessages(cached?.messages || []);
    setHasOlder(cached?.hasOlder || false);
    setMembers([]);
    followBottom.current = cached?.following ?? true;
    const timer = setTimeout(
      () => {
        Promise.all([
          loadMessages(activeId, !cached),
          api<Person[]>(`/chats/${activeId}/members`).then((data) => {
            if (valid) setMembers(data);
          }),
        ])
          .then(() => {
            if (valid) refreshChats().catch(() => {});
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
      },
      messageQuery ? 250 : 0,
    );
    return () => {
      valid = false;
      clearTimeout(timer);
      ++requestEpoch.current;
    };
  }, [activeId, messageQuery, me?.id, loadMessages, refreshChats, report]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const cached = cachedScroll.current;
    if (cached && cached.id === activeId) {
      // The chat-change effect queues its messages first; wait for that DOM to commit.
      if (messages !== cached.messages) return;
      el.scrollTop = cached.following ? el.scrollHeight : cached.top;
      cachedScroll.current = null;
      return;
    }
    const restore = scrollRestore.current;
    if (restore && restore.id === activeId) {
      el.scrollTop = restore.top + el.scrollHeight - restore.height;
      scrollRestore.current = null;
    } else if (followBottom.current && !messageQuery) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, messageQuery, loading, section, activeId, reply?.id, edit?.message.id, attachment]);
  useEffect(() => {
    if (
      !activeId ||
      messageQuery ||
      loading ||
      messages.some((message) => message.chat_id !== activeId)
    )
      return;
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
  }, [activeId, messageQuery, messages, hasOlder, loading]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Element;
      document
        .querySelectorAll('details.message-menu[open], details.chat-actions[open]')
        .forEach((menu) => {
          if (!menu.contains(target)) menu.removeAttribute('open');
        });
      if (!target.closest('.emoji-wrap')) setEmojiOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      const menus = document.querySelectorAll(
        'details.message-menu[open], details.chat-actions[open]',
      );
      if (menus.length) {
        menus.forEach((menu) => menu.removeAttribute('open'));
        return;
      }
      if (!editRequest.current) setEditing(null);
      setEmojiOpen(false);
      setInfoOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, []);
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
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (followBottom.current && !queryRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    const content = el.querySelector('.message-list');
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [activeId, section, ready, me?.id, loading]);
  function select(id: string) {
    if (window.innerWidth <= 1080) setInfoOpen(false);
    setActiveId(id);
    setSection('chats');
    setMessageQuery('');
    setSearchOpen(false);
    setError('');
    setEmojiOpen(false);
    setEditing(null);
    setCopiedMessageId(null);
    closeMenus();
  }
  function changeDraft(value: string) {
    if (edit) {
      setEditing((previous) => (previous ? { ...previous, body: value } : null));
      return;
    }
    if (activeId) setDrafts((prev) => ({ ...prev, [activeId]: value }));
    if (activeId) delete nonces.current[activeId];
  }
  function closeMenus() {
    document
      .querySelectorAll('details.message-menu[open], details.chat-actions[open]')
      .forEach((menu) => menu.removeAttribute('open'));
  }
  function positionMessageMenu(details: HTMLDetailsElement) {
    if (!details.open) return;
    setCopiedMessageId(null);
    const menu = details.querySelector<HTMLElement>('.message-menu-content');
    const summary = details.querySelector('summary');
    if (!menu || !summary) return;
    const viewport = window.visualViewport;
    const width = Math.min(240, window.innerWidth - 24);
    const height = Math.min(menu.scrollHeight, (viewport?.height ?? window.innerHeight) - 24);
    const origin = viewport?.offsetTop ?? 0;
    const rect = summary.getBoundingClientRect();
    const desiredLeft = details.closest('.own') ? rect.left : rect.right - width;
    const desiredTop =
      rect.top - height - 8 >= origin + 12 ? rect.top - height - 8 : rect.bottom + 8;
    menu.style.setProperty(
      '--message-menu-x',
      `${Math.max(12, Math.min(desiredLeft, window.innerWidth - width - 12))}px`,
    );
    menu.style.setProperty(
      '--message-menu-y',
      `${Math.max(origin + 12, Math.min(desiredTop, origin + (viewport?.height ?? window.innerHeight) - height - 12))}px`,
    );
  }
  function startReply(message: Message) {
    if (sendingChats.current.has(message.chat_id)) return;
    setEditing(null);
    setReplies((previous) => ({ ...previous, [message.chat_id]: message }));
    delete nonces.current[message.chat_id];
    closeMenus();
    textarea.current?.focus({ preventScroll: true });
  }
  function startEdit(message: Message) {
    if (sendingChats.current.has(message.chat_id) || editRequest.current) return;
    setEditing({ message, body: message.body });
    setEmojiOpen(false);
    closeMenus();
    textarea.current?.focus({ preventScroll: true });
  }
  async function saveEdit() {
    if (!edit || editRequest.current || (!edit.body.trim() && !edit.message.file)) return;
    const target = edit;
    editRequest.current = true;
    setSavingEdit(true);
    setError('');
    try {
      await api(`/chats/${target.message.chat_id}/messages/${target.message.id}`, 'PATCH', {
        body: target.body.trim(),
      });
      setEditing((previous) => (previous?.message.id === target.message.id ? null : previous));
      await Promise.all([loadMessages(target.message.chat_id), refreshChats()]);
    } catch (error) {
      report(error);
    } finally {
      editRequest.current = false;
      setSavingEdit(false);
    }
  }
  async function copyMessage(message: Message) {
    try {
      await navigator.clipboard.writeText(message.body || message.file?.name || '');
      setCopiedMessageId(message.id);
    } catch {
      setError('Не удалось скопировать. Выделите текст сообщения и скопируйте вручную.');
    }
  }
  function attachFile(file: File) {
    if (!activeId || edit || sending) return;
    if (file.size > 20 * 1024 * 1024) {
      setError('Максимальный размер файла — 20 МБ.');
      return;
    }
    setAttachments((previous) => ({ ...previous, [activeId]: { file } }));
    setTransfers((previous) => {
      const next = { ...previous };
      delete next[activeId];
      return next;
    });
    delete nonces.current[activeId];
  }
  async function setChatPreference(
    chat: Chat,
    changes: { pinned?: boolean; muted?: boolean; archived?: boolean },
  ) {
    if (preferenceBusy) return;
    setPreferenceBusy(true);
    closeMenus();
    try {
      await api(`/chats/${chat.id}/preferences`, 'PATCH', changes);
      await refreshChats();
      if (changes.archived && activeRef.current === chat.id) {
        setActiveId(null);
        setInfoOpen(false);
        setEditing(null);
      }
    } catch (error) {
      report(error);
    } finally {
      setPreferenceBusy(false);
    }
  }
  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (edit) {
      await saveEdit();
      return;
    }
    if (!activeId || sendingChats.current.has(activeId) || (!draft.trim() && !attachment)) return;
    const id = activeId,
      text = draft.trim(),
      originalDraft = draft,
      fileDraft = attachments[id],
      replyDraft = replies[id];
    // Each chat owns its retry nonce and upload; changing chats cannot mix attachments.
    const messageNonce = (nonces.current[id] ??= crypto.randomUUID());
    sendingChats.current.add(id);
    setSendingIds([...sendingChats.current]);
    setError('');
    let delivered = false;
    try {
      let file = fileDraft?.uploaded;
      if (fileDraft && !file) {
        const form = new FormData();
        form.append('file', fileDraft.file);
        setTransfers((previous) => ({ ...previous, [id]: { phase: 'uploading', progress: 0 } }));
        file = await upload<Attachment>(`/chats/${id}/files`, form, (progress) => {
          setTransfers((previous) => ({ ...previous, [id]: { phase: 'uploading', progress } }));
        });
        setAttachments((prev) =>
          prev[id]?.file === fileDraft.file
            ? { ...prev, [id]: { ...fileDraft, uploaded: file } }
            : prev,
        );
      }
      setTransfers((previous) => ({ ...previous, [id]: { phase: 'sending', progress: 100 } }));
      await api(`/chats/${id}/messages`, 'POST', {
        body: text,
        nonce: messageNonce,
        fileId: file?.id,
        demoFile: demo ? file : undefined,
        replyTo: replyDraft?.id,
      });
      delivered = true;
      setTransfers((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
      setDrafts((prev) => (prev[id] === originalDraft ? { ...prev, [id]: '' } : prev));
      setReplies((previous) => {
        if (previous[id]?.id !== replyDraft?.id) return previous;
        const next = { ...previous };
        delete next[id];
        return next;
      });
      setAttachments((prev) => {
        if (prev[id]?.file !== fileDraft?.file) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (nonces.current[id] === messageNonce) delete nonces.current[id];
      if (activeRef.current === id) {
        followBottom.current = true;
        setAwayFromBottom(false);
      }
      await Promise.all([loadMessages(id), refreshChats()]);
      if (activeRef.current === id && sectionRef.current === 'chats')
        textarea.current?.focus({ preventScroll: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        report(e);
        return;
      }
      if (!delivered)
        setTransfers((previous) => ({ ...previous, [id]: { phase: 'error', progress: 0 } }));
      setError(
        delivered
          ? 'Сообщение отправлено. Переписка обновится после восстановления соединения.'
          : `${activeRef.current === id ? '' : `Чат «${chats.find((chat) => chat.id === id)?.title || 'Переписка'}»: `}${(e as Error).message}`,
      );
    } finally {
      sendingChats.current.delete(id);
      setSendingIds([...sendingChats.current]);
    }
  }
  async function react(message: Message, emoji: string) {
    try {
      await api(`/chats/${message.chat_id}/messages/${message.id}/reactions`, 'POST', { emoji });
      await loadMessages(message.chat_id);
    } catch (e) {
      report(e);
    }
  }
  async function toggleNelya(chat: Chat) {
    setWorking(true);
    try {
      await api(`/chats/${chat.id}`, 'PATCH', { nelya: !chat.nelya });
      await refreshChats();
    } catch (e) {
      report(e);
    } finally {
      setWorking(false);
    }
  }
  async function invite() {
    if (!activeId) return;
    setInviteUrl('');
    setModal('invite');
    try {
      const r = await api<{ url: string }>(`/chats/${activeId}/invite`, 'POST');
      setInviteUrl(r.url);
    } catch (e) {
      report(e);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Не удалось скопировать. Выделите ссылку и скопируйте вручную.');
    }
  }
  async function logout() {
    try {
      if (!demo) await clearPushDevice().catch(() => {});
      if (!demo) await api('/auth/logout', 'POST');
      draftSnapshot.current = null;
      try {
        if (me) localStorage.removeItem(`galinka-drafts:${me.id}`);
      } catch {
        /* Storage may be unavailable. */
      }
      sessionStorage.removeItem('galinka-demo');
      location.href = '/app';
    } catch (e) {
      report(e);
    }
  }
  async function loadOlder() {
    if (!activeId || !messages.length || paging) return;
    setPaging(true);
    const id = activeId,
      q = messageQuery,
      epoch = requestEpoch.current;
    try {
      const data = await api<Message[]>(
        `/chats/${id}/messages?before=${encodeURIComponent(messages[0].id)}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      );
      if (activeRef.current !== id || queryRef.current !== q || epoch !== requestEpoch.current)
        return;
      followBottom.current = false;
      setAwayFromBottom(true);
      const el = scroller.current;
      if (el) scrollRestore.current = { id, top: el.scrollTop, height: el.scrollHeight };
      setMessages((prev) => [...data.filter((m) => !prev.some((old) => old.id === m.id)), ...prev]);
      setHasOlder(data.length === 60);
    } catch (e) {
      if (activeRef.current === id && queryRef.current === q) report(e);
    } finally {
      if (activeRef.current === id && queryRef.current === q) setPaging(false);
    }
  }
  async function downloadFile(file: Attachment) {
    if (demo) {
      const mediaUrl = getDemoFileUrl(file.id);
      if (mediaUrl) {
        const link = document.createElement('a');
        link.href = mediaUrl;
        link.download = file.name;
        link.click();
        return;
      }
      const blob = new Blob(
        [`Демонстрационный файл: ${file.name}\nВ реальном чате здесь будет ваш файл.`],
        { type: 'text/plain' },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else {
      try {
        const response = await fetch(`${API_BASE}/files/${file.id}`, { credentials: 'include' });
        if (!response.ok) throw Error('Не удалось скачать файл.');
        const blob = await response.blob();
        if (isNative) {
          const [{ Filesystem, Directory }, { Share }] = await Promise.all([
            import('@capacitor/filesystem'),
            import('@capacitor/share'),
          ]);
          const data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = () => reject(Error('Не удалось прочитать файл.'));
            reader.readAsDataURL(blob);
          });
          const safeName = file.name.replace(/[^\p{L}\p{N}._ -]/gu, '_');
          const { uri } = await Filesystem.writeFile({
            path: `attachments/${crypto.randomUUID()}-${safeName}`,
            data,
            directory: Directory.Cache,
            recursive: true,
          });
          await Share.share({ title: file.name, url: uri });
        } else {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = file.name;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      } catch (error) {
        report(error);
      }
    }
  }
  const filtered = chats
    .filter(
      (c) =>
        (filter === 'Архив' ? c.archived : !c.archived) &&
        (filter === 'Все' ||
          filter === 'Архив' ||
          (filter === 'Личные' && c.kind === 'direct') ||
          (filter === 'Группы' && c.kind === 'group') ||
          (filter === 'Непрочитанные' && c.unread > 0)) &&
        c.title.toLowerCase().includes(listQuery.toLowerCase()),
    )
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
  const archivedCount = chats.filter((chat) => chat.archived).length;
  const unread = chats
    .filter((chat) => !chat.muted && !chat.archived)
    .reduce((n, c) => n + c.unread, 0);
  const latestMessageActions = useRef<MessageActions>(null!);
  latestMessageActions.current = {
    reply: startReply,
    edit: startEdit,
    copy: copyMessage,
    react,
    download: downloadFile,
    menu: positionMessageMenu,
    remove: (message) => {
      setDeleteId(message.id);
      closeMenus();
      setModal('delete');
    },
  };
  // Keep the timeline independent from composer keystrokes while callbacks see current state.
  const messageActions = useMemo<MessageActions>(
    () => ({
      reply: (message) => latestMessageActions.current.reply(message),
      edit: (message) => latestMessageActions.current.edit(message),
      copy: (message) => latestMessageActions.current.copy(message),
      react: (message, emoji) => latestMessageActions.current.react(message, emoji),
      download: (file) => latestMessageActions.current.download(file),
      menu: (details) => latestMessageActions.current.menu(details),
      remove: (message) => latestMessageActions.current.remove(message),
    }),
    [],
  );
  if (!ready)
    return (
      <div className="boot">
        <img src="/icon.svg" alt="Galinka" />
        <p>Загрузка…</p>
      </div>
    );
  if (!me)
    return (
      <>
        <Auth
          onLogin={handleLogin}
          onDemo={() => {
            sessionStorage.setItem('galinka-demo', 'true');
            location.href = '/app?demo=1';
          }}
        />
        {error && (
          <div className="auth-error" role="alert">
            {error}
            <button onClick={() => setError('')} aria-label="Закрыть">
              <X size={16} />
            </button>
          </div>
        )}
      </>
    );
  return (
    <div className={`app-shell ${activeId && section === 'chats' ? 'has-active' : ''}`}>
      <nav className="rail" aria-label="Основная навигация">
        <a className="rail-logo" href="/app" aria-label="Galinka">
          <img src="/icon.svg" alt="" />
        </a>
        <div className="rail-links">
          <IconButton
            label="Чаты"
            className={section === 'chats' ? 'active' : ''}
            onClick={() => setSection('chats')}
          >
            <MessageCircle size={23} />
            {unread > 0 && <span className="rail-dot" />}
          </IconButton>
          <IconButton
            label="Модули"
            className={section === 'modules' ? 'active' : ''}
            onClick={() => setSection('modules')}
          >
            <Puzzle size={23} />
          </IconButton>
          <IconButton
            label="Избранное"
            onClick={() => {
              const c = chats.find((c) => c.kind === 'saved');
              if (c) select(c.id);
            }}
          >
            <Bookmark size={23} />
          </IconButton>
          <IconButton
            label="Объявления"
            className={section === 'announcements' ? 'active' : ''}
            onClick={() => setSection('announcements')}
          >
            <Megaphone size={23} />
          </IconButton>
        </div>
        <div className="rail-bottom">
          <ThemeToggle />
          <>
            {updates.available && (
              <IconButton label="Доступно обновление" onClick={() => setSection('settings')}>
                <Download size={21} />
              </IconButton>
            )}
          </>
          <IconButton
            label="Настройки"
            className={section === 'settings' ? 'active' : ''}
            onClick={() => setSection('settings')}
          >
            <Settings size={22} />
          </IconButton>
          <button
            className="profile-button"
            aria-label="Мой профиль"
            onClick={() => {
              setName(me.name);
              setModal('profile');
            }}
          >
            <Avatar person={me} size="small" />
          </button>
        </div>
      </nav>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <a className="brand" href="/app">
            galinka<span className="brand-dot">.</span>
          </a>
          <span className="sidebar-status">
            <span className={`status-dot ${!connected ? 'offline' : ''}`} />
            {demo ? 'Демо' : connected ? 'В сети' : 'Нет связи'}
          </span>
        </div>
        <div className="sidebar-heading">
          <h1>
            {filter === 'Архив' ? 'Архив' : 'Чаты'}
            <span>{filter === 'Архив' ? archivedCount : chats.length - archivedCount}</span>
          </h1>
          <IconButton label="Новый чат" className="new-chat" onClick={() => setModal('new')}>
            <Plus size={21} />
          </IconButton>
        </div>
        <label className="search-field">
          <Search size={18} />
          <input
            aria-label="Найти чат"
            placeholder="Поиск"
            value={listQuery}
            onChange={(e) => setListQuery(e.target.value)}
          />
          {listQuery && (
            <button aria-label="Очистить поиск" onClick={() => setListQuery('')}>
              <X size={16} />
            </button>
          )}
        </label>
        <div className="chat-filters" aria-label="Фильтр чатов">
          {['Все', 'Личные', 'Группы'].map((f) => (
            <button key={f} className={filter === f ? 'selected' : ''} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
          <IconButton
            label="Непрочитанные"
            className={filter === 'Непрочитанные' ? 'selected' : ''}
            onClick={() => setFilter(filter === 'Непрочитанные' ? 'Все' : 'Непрочитанные')}
          >
            <SlidersHorizontal size={16} />
          </IconButton>
        </div>
        {(archivedCount > 0 || filter === 'Архив') && (
          <div className="sidebar-tools">
            <button
              className={filter === 'Архив' ? 'archive-link selected' : 'archive-link'}
              aria-pressed={filter === 'Архив'}
              onClick={() => setFilter(filter === 'Архив' ? 'Все' : 'Архив')}
            >
              {filter === 'Архив' ? <ArrowLeft size={16} /> : <Archive size={16} />}
              {filter === 'Архив' ? 'Все чаты' : 'Архив'}
              <span>{archivedCount}</span>
            </button>
            <span>
              {filter === 'Непрочитанные'
                ? 'Непрочитанные'
                : filter === 'Архив'
                  ? 'Скрытые разговоры'
                  : 'Ваши разговоры'}
            </span>
          </div>
        )}
        <div className="chat-list">
          {filtered.map((c, index) => (
            <Fragment key={c.id}>
              {((index === 0 && c.pinned) ||
                (index > 0 && filtered[index - 1].pinned && !c.pinned)) && (
                <div className="chat-list-label">{c.pinned ? 'Закреплённые' : 'Другие чаты'}</div>
              )}
              <button
                className={`chat-item ${activeId === c.id && section === 'chats' ? 'selected' : ''}`}
                onClick={() => select(c.id)}
              >
                <Avatar chat={c} person={c.peer} />
                <span className="chat-item-content">
                  <span className="chat-item-title">
                    <strong>{c.title}</strong>
                    <span className="chat-flags">
                      {c.pinned && <Pin size={12} aria-label="Закреплён" />}
                      {c.muted && <BellOff size={12} aria-label="Без уведомлений" />}
                    </span>
                    <time>{c.last_message ? time(c.last_message.created_at) : ''}</time>
                  </span>
                  <span className="chat-item-preview">
                    <span>
                      {drafts[c.id] || attachments[c.id] ? (
                        <span className="chat-draft">
                          Черновик: {drafts[c.id] || attachments[c.id].file.name}
                        </span>
                      ) : (
                        <>
                          {c.last_message?.sender_id === me.id && (
                            <Check size={13} aria-label="Отправлено" />
                          )}{' '}
                          {c.last_message?.body ||
                            (c.last_message?.file?.mime?.startsWith('audio/')
                              ? 'Голосовое сообщение'
                              : c.last_message?.file?.mime?.startsWith('image/')
                                ? 'Фотография'
                                : c.last_message?.file?.name ||
                                  (c.last_message?.file_id ? 'Файл' : 'Нет сообщений'))}
                        </>
                      )}
                    </span>
                    {c.unread > 0 && (
                      <b className={`unread ${c.muted ? 'muted-unread' : ''}`}>
                        {c.unread > 99 ? '99+' : c.unread}
                      </b>
                    )}
                  </span>
                </span>
              </button>
            </Fragment>
          ))}
          {!filtered.length && (
            <div className="list-empty">
              <MessageCircle size={24} />
              <p>
                {listQuery
                  ? 'Чат не найден'
                  : filter === 'Архив'
                    ? 'В архиве пока пусто'
                    : 'Пока нет чатов'}
              </p>
              <button className="text-button" onClick={() => setModal('new')}>
                Написать другу <Plus size={16} />
              </button>
            </div>
          )}
        </div>
      </aside>
      <main className="workspace">
        {demo && (
          <div className="demo-bar">
            <span>
              <span className="status-dot" /> Демо · данные в браузере
            </span>
            <button onClick={logout}>
              Войти <ArrowUpRight size={14} />
            </button>
          </div>
        )}
        {!connected && !demo && (
          <div className="connection-bar" role="status">
            <WifiOff size={16} /> Соединение потеряно. Переписка обновится после подключения.
          </div>
        )}
        {error && (
          <div className="error-bar" role="alert">
            <span>{error}</span>
            <IconButton label="Закрыть ошибку" onClick={() => setError('')}>
              <X size={17} />
            </IconButton>
          </div>
        )}
        {section === 'chats' && active ? (
          <>
            <header className="chat-header">
              <IconButton
                label="Назад к чатам"
                className="mobile-back"
                onClick={() => setActiveId(null)}
              >
                <ArrowLeft size={22} />
              </IconButton>
              <Avatar person={active.peer} chat={active} />
              <button className="chat-heading" onClick={() => setInfoOpen((v) => !v)}>
                <h2>
                  {active.title}
                  {active.kind === 'group' && <ChevronDown size={16} />}
                </h2>
                <p>
                  {active.kind === 'saved'
                    ? 'Личные заметки'
                    : active.kind === 'group'
                      ? `${active.member_count} ${plural(active.member_count)}`
                      : `@${active.peer?.username || ''}`}
                </p>
              </button>
              <div className="header-actions">
                <IconButton
                  label="Поиск по сообщениям"
                  className={searchOpen ? 'active' : ''}
                  onClick={() => {
                    setSearchOpen((v) => !v);
                    setMessageQuery('');
                  }}
                >
                  <Search size={21} />
                </IconButton>
                <IconButton
                  label="О чате"
                  className={`info-toggle ${infoOpen ? 'active' : ''}`}
                  onClick={() => setInfoOpen((v) => !v)}
                >
                  <Info size={21} />
                </IconButton>
                <details className="chat-actions">
                  <summary
                    className="icon-button"
                    aria-label="Действия с чатом"
                    title="Действия с чатом"
                  >
                    <MoreHorizontal size={22} />
                  </summary>
                  <div className="chat-actions-menu">
                    <button
                      type="button"
                      disabled={preferenceBusy}
                      onClick={() => void setChatPreference(active, { pinned: !active.pinned })}
                    >
                      {active.pinned ? <PinOff size={17} /> : <Pin size={17} />}
                      {active.pinned ? 'Открепить чат' : 'Закрепить чат'}
                    </button>
                    <button
                      type="button"
                      disabled={preferenceBusy}
                      onClick={() => void setChatPreference(active, { muted: !active.muted })}
                    >
                      {active.muted ? <Bell size={17} /> : <BellOff size={17} />}
                      {active.muted ? 'Включить уведомления' : 'Без уведомлений'}
                    </button>
                    <button
                      type="button"
                      disabled={preferenceBusy}
                      onClick={() => void setChatPreference(active, { archived: !active.archived })}
                    >
                      {active.archived ? <ArchiveRestore size={17} /> : <Archive size={17} />}
                      {active.archived ? 'Вернуть из архива' : 'В архив'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        closeMenus();
                        setInfoOpen(true);
                      }}
                    >
                      <Info size={17} />
                      Информация о чате
                    </button>
                    {active.kind === 'group' && (
                      <button
                        type="button"
                        onClick={() => {
                          closeMenus();
                          setModal('group');
                        }}
                      >
                        <Users size={17} />
                        Управление группой
                      </button>
                    )}
                  </div>
                </details>
              </div>
            </header>
            {searchOpen && (
              <div className="message-search">
                <Search size={18} />
                <input
                  aria-label="Поиск по сообщениям"
                  placeholder="Поиск по всей переписке"
                  value={messageQuery}
                  onChange={(e) => setMessageQuery(e.target.value)}
                  autoFocus
                />
                <IconButton
                  label="Закрыть поиск"
                  onClick={() => {
                    setSearchOpen(false);
                    setMessageQuery('');
                  }}
                >
                  <X size={18} />
                </IconButton>
              </div>
            )}
            <div className="conversation-layout">
              <section className="conversation" aria-label="Переписка">
                <div
                  className="messages"
                  ref={scroller}
                  {...gestures}
                  onWheel={() => {
                    jumpingToLatest.current = false;
                  }}
                  onTouchStart={() => {
                    jumpingToLatest.current = false;
                  }}
                  onScroll={() => {
                    const el = scroller.current!;
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
                    const latest = messages.at(-1);
                    if (followBottom.current && activeId && latest)
                      void markRead(activeId, latest.id);
                  }}
                >
                  {loading ? (
                    <div className="messages-loading" role="status">
                      <span />
                      <span />
                      <span />
                      <p>Загрузка…</p>
                    </div>
                  ) : (
                    <>
                      {hasOlder && (
                        <button className="older-button" onClick={loadOlder} disabled={paging}>
                          {paging ? 'Загружаем…' : 'Более ранние сообщения'}
                        </button>
                      )}
                      {!messages.length && (
                        <div className="conversation-empty">
                          <span className="empty-mark">
                            <MessageCircle size={32} />
                          </span>
                          <h2>{messageQuery ? 'Ничего не нашлось' : 'Нет сообщений'}</h2>
                          <p>
                            {messageQuery
                              ? 'Попробуйте другое слово или очистите поиск.'
                              : 'Напишите первое сообщение.'}
                          </p>
                          {messageQuery && (
                            <button className="text-button" onClick={() => setMessageQuery('')}>
                              Очистить поиск
                            </button>
                          )}
                        </div>
                      )}
                      <MessageList
                        messages={messages}
                        meId={me.id}
                        kind={active.kind}
                        newMessageIds={newMessageIds}
                        copiedId={copiedMessageId}
                        sending={sending}
                        savingEdit={savingEdit}
                        actions={messageActions}
                      />
                      <div ref={bottomRef} />
                    </>
                  )}
                </div>
                {awayFromBottom && !messageQuery && (
                  <button
                    type="button"
                    className="jump-to-latest"
                    onClick={jumpToLatest}
                    aria-label="К последним сообщениям"
                  >
                    <ArrowDown size={18} />
                    <span>К последним</span>
                    {active.unread > 0 && <b>{active.unread}</b>}
                  </button>
                )}
                <div className="composer-wrap">
                  {(edit || reply) && (
                    <div className={`composer-context ${edit ? 'editing' : ''}`}>
                      <span className="composer-context-icon">
                        {edit ? <Pencil size={19} /> : <Reply size={19} />}
                      </span>
                      <div>
                        <strong>
                          {edit ? 'Редактирование сообщения' : `Ответ для ${reply!.sender.name}`}
                        </strong>
                        <p>
                          {edit
                            ? edit.message.body || edit.message.file?.name
                            : reply!.body || reply!.file?.name || 'Сообщение'}
                        </p>
                      </div>
                      <IconButton
                        label={edit ? 'Отменить редактирование' : 'Отменить ответ'}
                        disabled={savingCurrentEdit || sending}
                        onClick={() => {
                          if (edit) setEditing(null);
                          else if (activeId) {
                            setReplies((previous) => {
                              const next = { ...previous };
                              delete next[activeId];
                              return next;
                            });
                            delete nonces.current[activeId];
                          }
                        }}
                      >
                        <X size={18} />
                      </IconButton>
                    </div>
                  )}
                  {attachment && !edit && (
                    <AttachmentPreview
                      file={attachment}
                      transfer={activeId ? transfers[activeId] : undefined}
                      onRetry={() => void send()}
                      onRemove={() => {
                        if (!activeId) return;
                        setAttachments((previous) => {
                          const next = { ...previous };
                          delete next[activeId];
                          return next;
                        });
                        setTransfers((previous) => {
                          const next = { ...previous };
                          delete next[activeId];
                          return next;
                        });
                        delete nonces.current[activeId];
                      }}
                    />
                  )}
                  <form className="composer" onSubmit={send}>
                    <input
                      ref={fileInput}
                      type="file"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) attachFile(file);
                        e.target.value = '';
                      }}
                    />
                    <IconButton
                      label="Прикрепить файл"
                      disabled={sending || Boolean(edit)}
                      onClick={() => fileInput.current?.click()}
                    >
                      <Paperclip size={21} />
                    </IconButton>
                    <textarea
                      ref={textarea}
                      enterKeyHint="enter"
                      aria-label="Сообщение"
                      placeholder={
                        edit ? 'Измените сообщение…' : reply ? 'Написать ответ…' : 'Сообщение…'
                      }
                      rows={1}
                      value={composerValue}
                      maxLength={8000}
                      readOnly={sending || savingCurrentEdit}
                      aria-busy={sending || savingCurrentEdit}
                      onChange={(e) => changeDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (
                          e.key === 'Enter' &&
                          !e.shiftKey &&
                          !e.nativeEvent.isComposing &&
                          e.nativeEvent.keyCode !== 229 &&
                          window.matchMedia('(pointer:fine)').matches
                        ) {
                          e.preventDefault();
                          send();
                        }
                      }}
                    />
                    <div className="emoji-wrap">
                      {emojiOpen && (
                        <div className="emoji-picker">
                          {['😊', '❤', '🌿', '👍', '☕', '🎉', '😂', '🔥'].map((emoji) => (
                            <button
                              type="button"
                              key={emoji}
                              onClick={() => {
                                changeDraft(composerValue + emoji);
                                setEmojiOpen(false);
                                textarea.current?.focus();
                              }}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                      <IconButton
                        label="Добавить эмодзи"
                        disabled={sending || savingCurrentEdit}
                        onClick={() => setEmojiOpen((v) => !v)}
                      >
                        <Smile size={22} />
                      </IconButton>
                    </div>
                    {!edit && !draft.trim() && !attachment ? (
                      <VoiceRecorder
                        key={active.id}
                        disabled={sending}
                        onRecorded={attachFile}
                        onError={setError}
                      />
                    ) : (
                      <button
                        className="send-button"
                        onMouseDown={(e) => e.preventDefault()}
                        aria-label={edit ? 'Сохранить изменения' : 'Отправить сообщение'}
                        title={edit ? 'Сохранить изменения' : 'Отправить сообщение'}
                        disabled={
                          sending ||
                          savingCurrentEdit ||
                          (edit
                            ? !edit.body.trim() && !edit.message.file
                            : !draft.trim() && !attachment)
                        }
                      >
                        {sending || savingCurrentEdit ? (
                          <LoaderCircle size={20} className="spin" />
                        ) : edit ? (
                          <Check size={22} />
                        ) : (
                          <ArrowUp size={22} />
                        )}
                      </button>
                    )}
                  </form>
                  <div className="composer-foot">
                    <span className="desktop-hint">
                      Enter — отправить · Shift + Enter — перенос
                    </span>
                    <span className="mobile-hint">До 20 МБ на файл</span>
                  </div>
                </div>
              </section>
              {infoOpen && (
                <aside className="chat-info">
                  <div className="info-mobile-head">
                    <strong>О чате</strong>
                    <IconButton label="Закрыть информацию" onClick={() => setInfoOpen(false)}>
                      <X size={20} />
                    </IconButton>
                  </div>
                  <div className="info-profile">
                    <Avatar chat={active} person={active.peer} size="large" />
                    <h3>{active.title}</h3>
                    <p>
                      {active.kind === 'group'
                        ? `${active.member_count} ${plural(active.member_count)}`
                        : active.kind === 'saved'
                          ? 'Личные заметки'
                          : `@${active.peer?.username}`}
                    </p>
                    {active.kind === 'group' && active.owner_id === me.id && (
                      <button className="secondary" onClick={invite}>
                        <Link size={15} />
                        Пригласить друзей
                      </button>
                    )}
                  </div>
                  <div className="info-chat-preferences">
                    <button
                      type="button"
                      disabled={preferenceBusy}
                      onClick={() => void setChatPreference(active, { pinned: !active.pinned })}
                    >
                      {active.pinned ? <PinOff size={17} /> : <Pin size={17} />}
                      {active.pinned ? 'Открепить чат' : 'Закрепить чат'}
                    </button>
                    <button
                      type="button"
                      disabled={preferenceBusy}
                      onClick={() => void setChatPreference(active, { muted: !active.muted })}
                    >
                      {active.muted ? <Bell size={17} /> : <BellOff size={17} />}
                      {active.muted ? 'Включить уведомления' : 'Без уведомлений'}
                    </button>
                    <button
                      type="button"
                      disabled={preferenceBusy}
                      onClick={() => void setChatPreference(active, { archived: !active.archived })}
                    >
                      {active.archived ? <ArchiveRestore size={17} /> : <Archive size={17} />}
                      {active.archived ? 'Вернуть из архива' : 'В архив'}
                    </button>
                    {active.kind === 'group' && (
                      <button type="button" onClick={() => setModal('group')}>
                        <Users size={17} />
                        Управление группой
                      </button>
                    )}
                  </div>
                  <div className="info-section">
                    <div className="section-heading">
                      <h3>{active.kind === 'saved' ? 'Ваше пространство' : 'Участники'}</h3>
                      <span>{members.length}</span>
                    </div>
                    {members.map((p) => (
                      <div className="member" key={p.id}>
                        <Avatar person={p} size="small" />
                        <span>
                          {p.name}
                          {p.id === me.id && <small>это вы</small>}
                        </span>
                        {p.id === active.owner_id && <span className="owner-label">создатель</span>}
                      </div>
                    ))}
                  </div>
                  <div className="info-section">
                    <div className="section-heading">
                      <h3>Модули чата</h3>
                      <Puzzle size={15} />
                    </div>
                    <div className="module-switch-row">
                      <span className="nelya-small">
                        <Sparkles size={19} />
                      </span>
                      <div>
                        <strong>Неля</strong>
                        <p>Помощник для компании</p>
                      </div>
                      <button
                        className={`switch ${active.nelya ? 'on' : ''}`}
                        role="switch"
                        aria-checked={active.nelya}
                        aria-label="Модуль Неля"
                        disabled={working || active.owner_id !== me.id}
                        onClick={() => toggleNelya(active)}
                      >
                        <span />
                      </button>
                    </div>
                    {active.owner_id !== me.id && (
                      <p className="tiny muted">Модули подключает создатель чата.</p>
                    )}
                    <button
                      className="text-button all-modules"
                      onClick={() => setSection('modules')}
                    >
                      О модуле
                      <ArrowUpRight size={15} />
                    </button>
                  </div>
                  <div className="info-footer">
                    <Lock size={13} />
                    <span>
                      Ваша переписка
                      <br />
                      <small>Только для участников чата</small>
                    </span>
                  </div>
                </aside>
              )}
            </div>
          </>
        ) : section === 'chats' ? (
          <div className="workspace-empty">
            <Leaf size={44} />
            <h2>Выберите чат</h2>
            <p>Или начните новый разговор.</p>
            <button className="primary" onClick={() => setModal('new')}>
              <Plus size={18} />
              Написать другу
            </button>
          </div>
        ) : section === 'modules' ? (
          <div className="content-page" key={section}>
            <button className="text-button mobile-page-back" onClick={() => setSection('chats')}>
              <ArrowLeft size={17} />К чатам
            </button>
            <div className="page-top">
              <span className="page-symbol">
                <Puzzle size={25} />
              </span>
              <h1>Чуть больше, чем чат.</h1>
              <p>
                Маленькие дополнения для вашей большой компании.
                <br />
                Подключайте только то, что вам нравится.
              </p>
            </div>
            <section className="nelya-card">
              <div className="nelya-art" aria-hidden="true">
                <span className="nelya-face">
                  <i />
                  <i />
                  <b />
                </span>
                <Sparkles className="sparkle-one" size={28} />
                <Leaf className="sparkle-two" size={30} />
                <span className="art-caption">приятно познакомиться!</span>
              </div>
              <div className="nelya-description">
                <span className="module-label">Первый модуль Galinka</span>
                <h2>
                  Это Неля<span>.</span>
                </h2>
                <p>Подбросит монетку, выберет вариант или предложит план.</p>
                <span className="module-disclosure">
                  <Lock size={13} /> Монетка, идеи и выбор из ваших вариантов
                </span>
                <div className="command-examples">
                  <code>@неля монетка</code>
                  <code>@неля идея</code>
                  <code>@неля выбери чай | кофе</code>
                </div>
                <label>
                  Подключить к разговору
                  <select value={activeId || ''} onChange={(e) => setActiveId(e.target.value)}>
                    {chats.map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </label>
                {active && (
                  <button
                    className={active.nelya ? 'secondary' : 'primary'}
                    disabled={working || active.owner_id !== me.id}
                    onClick={() => toggleNelya(active)}
                  >
                    {active.nelya ? <Check size={17} /> : <Plus size={17} />}{' '}
                    {active.nelya ? 'Подключена · отключить' : 'Позвать Нелю'}
                  </button>
                )}
                {active?.owner_id !== me.id && (
                  <small className="muted">Подключить модуль может создатель чата.</small>
                )}
              </div>
            </section>
          </div>
        ) : section === 'announcements' ? (
          <div className="content-page" key={section}>
            <button className="text-button mobile-page-back" onClick={() => setSection('chats')}>
              <ArrowLeft size={17} />К чатам
            </button>
            <Announcements />
          </div>
        ) : (
          <div className="content-page settings-page" key="settings">
            <button className="text-button mobile-page-back" onClick={() => setSection('chats')}>
              <ArrowLeft size={17} />К чатам
            </button>
            <div className="page-top">
              <span className="page-symbol">
                <Settings size={25} />
              </span>
              <h1>Настройки</h1>
              <p>Профиль, оформление и уведомления</p>
            </div>
            <section className="settings-section">
              <div className="settings-profile">
                <Avatar person={me} size="large" />
                <div>
                  <h2>{me.name}</h2>
                  <p>@{me.username}</p>
                </div>
                <button
                  className="secondary"
                  onClick={() => {
                    setName(me.name);
                    setModal('profile');
                  }}
                >
                  Изменить имя
                </button>
              </div>
            </section>
            <section className="settings-section">
              <h3>Оформление</h3>
              <ThemePicker />
            </section>
            <MotionSettings />
            <NotificationSettings state={notifications} demo={demo} />
            <section className="settings-section gesture-note">
              <Reply size={22} />
              <div>
                <h3>Быстрее одним жестом</h3>
                <p>
                  Смахните сообщение вправо, чтобы ответить. Удерживайте сообщение или нажмите
                  правой кнопкой для действий. Свайп от левого края возвращает к чатам.
                </p>
              </div>
            </section>
            {me.role === 'admin' && !demo && (
              <section className="settings-section">
                <h3>Администрирование</h3>
                <p>Пользователи, роли и объявления.</p>
                <a className="secondary" href="/admin">
                  Панель администратора
                </a>
              </section>
            )}
            <section className="settings-section">
              <h3>Приложение</h3>
              <p>Для телефона и компьютера</p>
              <button className="primary" onClick={() => setModal('install')}>
                <Download size={18} />
                Установить Galinka
              </button>
              <div className="platforms">iOS · Android · Windows · macOS · Linux</div>
            </section>
            <section className="settings-section privacy-note">
              <Lock size={22} />
              <div>
                <h3>Конфиденциальность</h3>
                <p>
                  Чаты доступны участникам и администратору сервера. Сквозного шифрования пока нет.
                </p>
              </div>
            </section>
            <button className="logout-button" onClick={logout}>
              <LogOut size={18} />
              {demo ? 'Выйти из демоверсии' : 'Выйти из аккаунта'}
            </button>
            <section className="settings-section">
              <Updates
                hasDraft={
                  Object.keys(attachments).length > 0 || Boolean(editing) || sendingIds.length > 0
                }
              />
            </section>
            <p className="settings-version">Galinka {__APP_VERSION__} · Сделано для своих</p>
          </div>
        )}
      </main>
      <nav className="mobile-nav" aria-label="Навигация на телефоне">
        <button
          className={section === 'chats' ? 'active' : ''}
          aria-current={section === 'chats' ? 'page' : undefined}
          onClick={() => {
            setSection('chats');
            setActiveId(null);
          }}
        >
          <MessageCircle size={20} />
          Чаты
        </button>
        <button
          className={section === 'modules' ? 'active' : ''}
          aria-current={section === 'modules' ? 'page' : undefined}
          onClick={() => setSection('modules')}
        >
          <Puzzle size={20} />
          Модули
        </button>
        <button
          className={section === 'settings' ? 'active' : ''}
          aria-current={section === 'settings' ? 'page' : undefined}
          onClick={() => setSection('settings')}
        >
          <Settings size={20} />
          Настройки
        </button>
        <button
          className={section === 'announcements' ? 'active' : ''}
          aria-current={section === 'announcements' ? 'page' : undefined}
          onClick={() => setSection('announcements')}
        >
          <Megaphone size={20} />
          Объявления
        </button>
      </nav>
      {modal === 'new' && (
        <NewChat
          onClose={() => setModal(null)}
          onCreated={async (id) => {
            setModal(null);
            await refreshChats();
            select(id);
          }}
        />
      )}
      {modal === 'group' && active?.kind === 'group' && (
        <GroupSettings
          chat={active}
          me={me}
          members={members}
          onClose={() => setModal(null)}
          onUpdated={async () => {
            const id = active.id;
            await refreshChats();
            const people = await api<Person[]>(`/chats/${id}/members`);
            if (activeRef.current === id) setMembers(people);
          }}
          onLeft={async () => {
            setModal(null);
            setActiveId(null);
            setMessages([]);
            setMembers([]);
            setInfoOpen(false);
            setEditing(null);
            await refreshChats();
          }}
        />
      )}
      {modal === 'install' && (
        <Modal error={error} title="Установить Galinka" onClose={() => setModal(null)}>
          <div className="install-intro">
            <img src="/icon.svg" alt="" />
            <p>Выберите приложение для своего устройства.</p>
          </div>
          {install ? (
            <button
              className="primary wide"
              onClick={async () => {
                await install.prompt();
                await install.userChoice;
                setInstall(null);
              }}
            >
              Установить Galinka
              <Download size={18} />
            </button>
          ) : (
            <div className="install-steps">
              <div>
                <strong>iPhone и iPad</strong>
                <p>Откройте в Safari → «Поделиться» → «На экран Домой» → «Добавить».</p>
              </div>
              <div>
                <strong>Android</strong>
                <p>
                  Скачайте APK в разделе загрузок. Также можно установить веб-версию из меню Chrome.
                </p>
              </div>
              <div>
                <strong>Windows, macOS и Linux</strong>
                <p>Установщики и AppImage доступны в разделе загрузок.</p>
              </div>
            </div>
          )}
          <a
            className="primary wide"
            href={isNative ? 'https://mess.quiby.me/#download' : '/#download'}
          >
            Скачать приложение <Download size={18} />
          </a>
        </Modal>
      )}
      {modal === 'profile' && (
        <Modal error={error} title="Изменить имя" onClose={() => setModal(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setWorking(true);
              try {
                setMe(await api<Person>('/me', 'PATCH', { name }));
                setModal(null);
                await refreshChats();
              } catch (e) {
                report(e);
              } finally {
                setWorking(false);
              }
            }}
          >
            <label>
              Ваше имя
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                required
              />
            </label>
            <p className="muted tiny">Друзья увидят это имя в разговорах.</p>
            <button className="primary wide" disabled={working}>
              {working ? 'Сохраняем…' : 'Сохранить'}
            </button>
          </form>
        </Modal>
      )}
      {modal === 'invite' && (
        <Modal error={error} title="Пригласить в группу" onClose={() => setModal(null)}>
          <p className="muted">
            Ссылка добавит зарегистрированного друга в «{active?.title}». Действует 7 дней. Новому
            участнику также понадобится код регистрации по приглашению.
          </p>
          {inviteUrl ? (
            <>
              <label>
                Ссылка-приглашение
                <input readOnly value={inviteUrl} onFocus={(e) => e.target.select()} />
              </label>
              <button className="primary wide" onClick={copy}>
                {copied ? <Check size={18} /> : <Copy size={18} />}{' '}
                {copied ? 'Скопировано' : 'Скопировать ссылку'}
              </button>
              {demo && (
                <p className="tiny muted">В демоверсии ссылка открывает только деморежим.</p>
              )}
            </>
          ) : (
            <p className="muted">{error || 'Готовим ссылку…'}</p>
          )}
        </Modal>
      )}
      {modal === 'delete' && (
        <Modal error={error} title="Удалить сообщение?" onClose={() => setModal(null)}>
          <p className="muted">
            Оно исчезнет у всех участников чата. Восстановить сообщение не получится.
          </p>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setModal(null)}>
              Оставить
            </button>
            <button
              className="danger"
              disabled={working}
              onClick={async () => {
                setWorking(true);
                try {
                  await api(`/chats/${activeId}/messages/${deleteId}`, 'DELETE');
                  setMessages((prev) => prev.filter((m) => m.id !== deleteId));
                  setModal(null);
                  await refreshChats();
                } catch (e) {
                  report(e);
                } finally {
                  setWorking(false);
                }
              }}
            >
              Удалить
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
