import { useState, useEffect, useRef, useCallback, type ReactNode, type FormEvent } from 'react';
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
  CheckCheck,
  Check,
  ChevronDown,
  Info,
  Sparkles,
  Leaf,
  Lock,
  MoreHorizontal,
  FileText,
  Copy,
  Link,
  Trash2,
  LoaderCircle,
  WifiOff,
  Compass,
  Puzzle,
} from 'lucide-react';
import { api, ApiError, isDemo, API_BASE } from './api';
import { Updates } from './updates';
import type { Person, Chat, Message, Attachment } from './types';

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
type ModalKind = 'new' | 'install' | 'profile' | 'invite' | 'delete' | null;
const time = (date: string) =>
  new Date(date).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
const bytes = (n: number) =>
  n < 1024 * 1024
    ? `${Math.max(1, Math.round(n / 1024))} КБ`
    : `${(n / 1024 / 1024).toFixed(1)} МБ`;
const plural = (n: number) =>
  n % 10 === 1 && n % 100 !== 11
    ? 'участник'
    : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
      ? 'участника'
      : 'участников';
function Avatar({
  person,
  chat,
  size = 'normal',
}: {
  person?: Person | null;
  chat?: Chat;
  size?: 'small' | 'normal' | 'large';
}) {
  return (
    <span
      className={`avatar ${size} tone-${chat?.kind === 'saved' ? 0 : (person?.color ?? (chat?.id === 'weekend' ? 0 : 2))} ${chat?.kind === 'group' ? 'group-avatar' : ''}`}
      aria-hidden="true"
    >
      {chat?.kind === 'saved' ? (
        <Bookmark size={size === 'large' ? 28 : 20} />
      ) : chat?.kind === 'group' ? (
        <Users size={size === 'large' ? 30 : 22} />
      ) : person?.id === 'nelya' ? (
        <Sparkles size={20} />
      ) : (
        person?.name
          .split(' ')
          .map((s) => s[0])
          .slice(0, 2)
          .join('') || 'G'
      )}
    </span>
  );
}
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
function Modal({
  title,
  onClose,
  children,
  error,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  error?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="modal"
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <IconButton label="Закрыть" onClick={onClose}>
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
function Auth({ onLogin, onDemo }: { onLogin: (person: Person) => void; onDemo: () => void }) {
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
          galinka<span className="version">early days</span>
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
          <span>Ваш сервер. Ваш круг.</span>
          <span>Galinka · {__APP_VERSION__}</span>
        </div>
      </section>
      <section className="auth-form-side">
        <div className="auth-form-wrap">
          <span className="auth-icon">
            <MessageCircle size={28} />
          </span>
          <h2>{register ? 'Заходите, вы свои' : 'С возвращением'}</h2>
          <p className="muted">
            {register
              ? 'Пара деталей — и можно общаться.'
              : 'Здесь наверняка уже что-то обсуждают.'}
          </p>
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
          <form onSubmit={submit}>
            {register && (
              <label>
                Как вас зовут
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
                <input
                  name="invite"
                  required
                  autoComplete="off"
                  placeholder="У владельца сервера"
                />
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
                  {register ? 'Присоединиться' : 'Войти в Galinka'}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          <div className="auth-divider">
            <span>или сначала осмотритесь</span>
          </div>
          <button className="secondary wide" onClick={onDemo}>
            Попробовать демоверсию
            <ArrowUpRight size={17} />
          </button>
          <p className="auth-footnote">
            <Lock size={13} /> Пароли защищены. Данные хранятся на вашем сервере.
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
    <Modal title="Начать разговор" onClose={onClose}>
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
          Найти друзей
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Имя или логин, от 2 символов"
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
            <p className="muted">Никого не нашли. Друг уже зарегистрировался на этом сервере?</p>
          )}
          {query.length < 2 && (
            <p className="muted">
              Начните с имени друга.
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
  const [me, setMe] = useState<Person | null>(null),
    [ready, setReady] = useState(false),
    [demo, setDemo] = useState(isDemo),
    [chats, setChats] = useState<Chat[]>([]),
    [activeId, setActiveId] = useState<string | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [members, setMembers] = useState<Person[]>([]),
    [section, setSection] = useState<'chats' | 'modules' | 'settings'>('chats'),
    [modal, setModal] = useState<ModalKind>(null),
    [filter, setFilter] = useState('Все'),
    [listQuery, setListQuery] = useState(''),
    [searchOpen, setSearchOpen] = useState(false),
    [messageQuery, setMessageQuery] = useState(''),
    [infoOpen, setInfoOpen] = useState(() => window.innerWidth > 1080),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [sending, setSending] = useState(false),
    [attachment, setAttachment] = useState<File | null>(null),
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
  const sectionRef = useRef(section);
  sectionRef.current = section;
  const activeRef = useRef(activeId),
    queryRef = useRef(messageQuery),
    bottomRef = useRef<HTMLDivElement>(null),
    scroller = useRef<HTMLDivElement>(null),
    textarea = useRef<HTMLTextAreaElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    requestEpoch = useRef(0),
    nonce = useRef<string | null>(null),
    uploaded = useRef<Attachment | null>(null),
    joined = useRef(false),
    followBottom = useRef(true);
  activeRef.current = activeId;
  queryRef.current = messageQuery;
  const active = chats.find((c) => c.id === activeId),
    draft = activeId ? drafts[activeId] || '' : '';
  useEffect(() => {
    if (new URLSearchParams(location.search).has('demo')) {
      sessionStorage.setItem('galinka-demo', 'true');
      setDemo(true);
    }
    api<Person>('/me')
      .then(setMe)
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
    const data = await api<Chat[]>('/chats');
    setChats(data);
    if (!initialized.current) {
      initialized.current = true;
      if (window.innerWidth > 640) setActiveId((id) => id || data[0]?.id || null);
    }
    return data;
  }, []);
  const loadMessages = useCallback(async (id: string, reset = false) => {
    const epoch = ++requestEpoch.current,
      q = queryRef.current;
    const data = await api<Message[]>(
      `/chats/${id}/messages${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    );
    if (activeRef.current !== id || epoch !== requestEpoch.current) return;
    setMessages((prev) => {
      if (reset || q || !data.length) return data;
      const boundary = prev.findIndex((m) => m.id === data[0].id);
      return boundary > 0 ? [...prev.slice(0, boundary), ...data] : data;
    });
    setHasOlder(data.length === 60);
    if (
      !q &&
      data.length &&
      sectionRef.current === 'chats' &&
      document.visibilityState === 'visible'
    )
      await api(`/chats/${id}/read`, 'POST', { lastMessageId: data.at(-1)!.id });
  }, []);
  useEffect(() => {
    if (!me) return;
    refreshChats().catch((e) => setError(e.message));
    const token = new URLSearchParams(location.search).get('join');
    if (token && !joined.current && !demo) {
      joined.current = true;
      api<{ id: string }>('/join', 'POST', { token })
        .then(async (r) => {
          await refreshChats();
          setActiveId(r.id);
          history.replaceState({}, '', location.pathname);
        })
        .catch((e) => setError(e.message));
    }
    if (demo) return;
    const events = new EventSource(`${API_BASE}/events`, { withCredentials: true });
    const sync = (reset = false) => {
      refreshChats().catch((e) => setError(e.message));
      if (activeRef.current)
        loadMessages(activeRef.current, reset).catch((e) => setError(e.message));
    };
    events.onmessage = (event) => {
      setConnected(true);
      const change = JSON.parse(event.data) as { type: string; deletedId?: string };
      if (change.deletedId) setMessages((prev) => prev.filter((m) => m.id !== change.deletedId));
      sync(change.type === 'connected');
    };
    events.onerror = () => setConnected(false);
    const visible = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', visible);
    // Recover missed events and unread state after background suspension or a proxy interruption.
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') sync();
    }, 30000);
    return () => {
      events.close();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [me?.id, demo, refreshChats, loadMessages]);
  useEffect(() => {
    setAttachment(null);
    uploaded.current = null;
    nonce.current = null;
  }, [activeId]);
  useEffect(() => {
    if (!activeId || !me) return;
    let valid = true;
    setLoading(true);
    setMessages([]);
    setMembers([]);
    followBottom.current = true;
    const timer = setTimeout(
      () => {
        Promise.all([
          loadMessages(activeId, true),
          api<Person[]>(`/chats/${activeId}/members`).then((data) => {
            if (valid) setMembers(data);
          }),
        ])
          .then(() => {
            if (valid) refreshChats().catch(() => {});
          })
          .catch((e) => {
            if (valid) setError(e.message);
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
  }, [activeId, messageQuery, me?.id, loadMessages, refreshChats]);
  useEffect(() => {
    if (followBottom.current && !messageQuery) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, messageQuery]);
  function report(e: unknown) {
    setError((e as Error).message || 'Не удалось выполнить действие.');
  }
  function select(id: string) {
    if (window.innerWidth <= 1080) setInfoOpen(false);
    setActiveId(id);
    setSection('chats');
    setMessageQuery('');
    setSearchOpen(false);
    setError('');
    setEmojiOpen(false);
  }
  function changeDraft(value: string) {
    if (activeId) setDrafts((prev) => ({ ...prev, [activeId]: value }));
    nonce.current = null;
  }
  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (!activeId || sending || (!draft.trim() && !attachment)) return;
    const id = activeId,
      text = draft.trim();
    setSending(true);
    setError('');
    try {
      if (attachment && !uploaded.current) {
        const form = new FormData();
        form.append('file', attachment);
        uploaded.current = await api<Attachment>(`/chats/${id}/files`, 'POST', form);
      }
      nonce.current ??= crypto.randomUUID();
      await api(`/chats/${id}/messages`, 'POST', {
        body: text,
        nonce: nonce.current,
        fileId: uploaded.current?.id,
        demoFile: demo ? uploaded.current : undefined,
      });
      setDrafts((prev) => ({ ...prev, [id]: '' }));
      setAttachment(null);
      uploaded.current = null;
      nonce.current = null;
      followBottom.current = true;
      await Promise.all([loadMessages(id), refreshChats()]);
      textarea.current?.focus();
    } catch (e) {
      report(e);
    } finally {
      setSending(false);
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
      if (!demo) await api('/auth/logout', 'POST');
      sessionStorage.removeItem('galinka-demo');
      location.href = '/app';
    } catch (e) {
      report(e);
    }
  }
  async function loadOlder() {
    if (!activeId || !messages.length) return;
    setPaging(true);
    const id = activeId;
    const height = scroller.current?.scrollHeight || 0;
    try {
      const data = await api<Message[]>(
        `/chats/${id}/messages?before=${encodeURIComponent(messages[0].id)}${messageQuery ? `&q=${encodeURIComponent(messageQuery)}` : ''}`,
      );
      if (activeRef.current !== id) return;
      followBottom.current = false;
      setMessages((prev) => [...data, ...prev]);
      setHasOlder(data.length === 60);
      requestAnimationFrame(() => {
        if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight - height;
      });
    } catch (e) {
      report(e);
    } finally {
      setPaging(false);
    }
  }
  async function downloadFile(file: Attachment) {
    if (demo) {
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
    } else window.open(`${API_BASE}/files/${file.id}`, '_blank', 'noopener');
  }
  const filtered = chats.filter(
    (c) =>
      (filter === 'Все' ||
        (filter === 'Личные' && c.kind === 'direct') ||
        (filter === 'Группы' && c.kind === 'group') ||
        (filter === 'Непрочитанные' && c.unread > 0)) &&
      c.title.toLowerCase().includes(listQuery.toLowerCase()),
  );
  const unread = chats.reduce((n, c) => n + c.unread, 0);
  if (!ready)
    return (
      <div className="boot">
        <img src="/icon.svg" alt="Galinka" />
        <p>Собираем своих…</p>
      </div>
    );
  if (!me)
    return (
      <>
        <Auth
          onLogin={setMe}
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
        </div>
        <div className="rail-bottom">
          <IconButton label="Установить приложение" onClick={() => setModal('install')}>
            <Download size={21} />
          </IconButton>
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
          <span className="version">beta</span>
        </div>
        <div className="sidebar-heading">
          <h1>
            Разговоры<span>{chats.length}</span>
          </h1>
          <IconButton label="Новый чат" className="new-chat" onClick={() => setModal('new')}>
            <Plus size={21} />
          </IconButton>
        </div>
        <label className="search-field">
          <Search size={18} />
          <input
            aria-label="Найти чат"
            placeholder="Найти разговор"
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
        <div className="chat-list">
          {filtered.map((c) => (
            <button
              key={c.id}
              className={`chat-item ${activeId === c.id && section === 'chats' ? 'selected' : ''}`}
              onClick={() => select(c.id)}
            >
              <Avatar chat={c} person={c.peer} />
              <span className="chat-item-content">
                <span className="chat-item-title">
                  <strong>{c.title}</strong>
                  <time>{c.last_message ? time(c.last_message.created_at) : ''}</time>
                </span>
                <span className="chat-item-preview">
                  <span>
                    {c.last_message?.sender_id === me.id && <CheckCheck size={13} />}{' '}
                    {c.last_message?.body ||
                      (c.last_message?.file_id
                        ? 'Прикреплённый файл'
                        : 'Пока тихо. Начните разговор.')}
                  </span>
                  {c.unread > 0 && <b className="unread">{c.unread}</b>}
                </span>
              </span>
            </button>
          ))}
          {!filtered.length && (
            <div className="list-empty">
              <MessageCircle size={24} />
              <p>{listQuery ? 'Такого разговора пока нет' : 'Здесь начинаются разговоры'}</p>
              <button className="text-button" onClick={() => setModal('new')}>
                Написать другу <Plus size={16} />
              </button>
            </div>
          )}
        </div>
        <div className="sidebar-module">
          <span className="nelya-small">
            <Sparkles size={20} />
          </span>
          <div>
            <strong>Знакомьтесь, Неля</strong>
            <p>Ещё одна в вашей компании.</p>
          </div>
          <IconButton label="Познакомиться с Нелей" onClick={() => setSection('modules')}>
            <ArrowUpRight size={18} />
          </IconButton>
        </div>
        <div className="server-status">
          <span className={`status-dot ${!connected ? 'offline' : ''}`} />
          {demo
            ? 'Демо · только в этом браузере'
            : connected
              ? 'На связи с вашим сервером'
              : 'Восстанавливаем соединение'}
          <Lock size={12} />
        </div>
      </aside>
      <main className="workspace">
        {demo && (
          <div className="demo-bar">
            <span>
              <span className="status-dot" /> Демо: вымышленные чаты, данные только в браузере
            </span>
            <button onClick={logout}>
              К своему аккаунту <ArrowUpRight size={14} />
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
                    ? 'Только вы и ваши мысли'
                    : active.kind === 'group'
                      ? `${active.member_count} ${plural(active.member_count)} · ваш маленький круг`
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
                  className={infoOpen ? 'active' : ''}
                  onClick={() => setInfoOpen((v) => !v)}
                >
                  <Info size={21} />
                </IconButton>
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
                  onScroll={() => {
                    const el = scroller.current!;
                    followBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
                  }}
                >
                  {loading ? (
                    <div className="messages-loading" role="status">
                      <span />
                      <span />
                      <span />
                      <p>Загружаем разговор…</p>
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
                          <h2>{messageQuery ? 'Ничего не нашлось' : 'Скажите первое «привет»'}</h2>
                          <p>
                            {messageQuery
                              ? 'Попробуйте другое слово или очистите поиск.'
                              : 'Здесь будет ваша история. Начните её с сообщения.'}
                          </p>
                          {messageQuery && (
                            <button className="text-button" onClick={() => setMessageQuery('')}>
                              Очистить поиск
                            </button>
                          )}
                        </div>
                      )}
                      {messages.map((m, i) => {
                        const own = m.sender_id === me.id,
                          bot = !m.sender_id,
                          previous = messages[i - 1],
                          next = messages[i + 1],
                          same =
                            previous?.sender_id === m.sender_id &&
                            new Date(m.created_at).getTime() -
                              new Date(previous.created_at).getTime() <
                              300000,
                          newDay =
                            !previous ||
                            new Date(previous.created_at).toDateString() !==
                              new Date(m.created_at).toDateString();
                        return (
                          <div key={m.id}>
                            {newDay && (
                              <div className="date-divider">
                                <span>
                                  {new Date(m.created_at).toDateString() ===
                                  new Date().toDateString()
                                    ? 'Сегодня'
                                    : new Date(m.created_at).toLocaleDateString('ru', {
                                        day: 'numeric',
                                        month: 'long',
                                      })}
                                </span>
                              </div>
                            )}
                            <article
                              className={`message-row ${own ? 'own' : ''} ${bot ? 'bot' : ''} ${same && !newDay ? 'continued' : ''}`}
                            >
                              {!own && (
                                <div className="message-avatar">
                                  {(!next || next.sender_id !== m.sender_id || newDay) && (
                                    <Avatar person={m.sender} size="small" />
                                  )}
                                </div>
                              )}
                              <div className="message-content">
                                {!own && (!same || newDay) && (
                                  <div className="sender-name">
                                    {m.sender.name}
                                    {bot && <span className="bot-tag">модуль</span>}
                                  </div>
                                )}
                                <div className="bubble">
                                  {m.file && (
                                    <button
                                      className="file-attachment"
                                      onClick={() => downloadFile(m.file!)}
                                    >
                                      <FileText size={25} />
                                      <span>
                                        <strong>{m.file.name}</strong>
                                        <small>{bytes(m.file.size)} · Скачать</small>
                                      </span>
                                      <Download size={17} />
                                    </button>
                                  )}
                                  {m.body && <p>{m.body}</p>}
                                  <span className="message-time">
                                    <time>{time(m.created_at)}</time>
                                    {own && <Check size={14} aria-label="Сохранено на сервере" />}
                                  </span>
                                </div>
                                {m.reactions.length > 0 && (
                                  <div className="reactions">
                                    {m.reactions.map((r) => (
                                      <button
                                        key={r.emoji}
                                        className={r.mine ? 'mine' : ''}
                                        aria-label={`${r.emoji}: ${r.count}, ${r.mine ? 'убрать' : 'добавить'} реакцию`}
                                        onClick={() => react(m, r.emoji)}
                                      >
                                        {r.emoji}
                                        <span>{r.count}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <details className="message-menu">
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
                                        onClick={(e) => {
                                          react(m, emoji);
                                          e.currentTarget
                                            .closest('details')
                                            ?.removeAttribute('open');
                                        }}
                                      >
                                        {emoji}
                                      </button>
                                    ))}
                                  </div>
                                  {own && (
                                    <button
                                      className="delete-action"
                                      onClick={() => {
                                        setDeleteId(m.id);
                                        setModal('delete');
                                      }}
                                    >
                                      <Trash2 size={15} />
                                      Удалить
                                    </button>
                                  )}
                                </div>
                              </details>
                            </article>
                          </div>
                        );
                      })}
                      <div ref={bottomRef} />
                    </>
                  )}
                </div>
                <div className="composer-wrap">
                  {active.nelya && (
                    <div className="nelya-hint">
                      <Sparkles size={13} />
                      <span>Неля рядом.</span>
                      <button
                        onClick={() => {
                          changeDraft('@неля помощь');
                          textarea.current?.focus();
                        }}
                      >
                        Позовите через @неля
                      </button>
                    </div>
                  )}
                  {attachment && (
                    <div className="pending-file">
                      <FileText size={18} />
                      <span>
                        {attachment.name} · {bytes(attachment.size)}
                      </span>
                      <IconButton
                        label="Убрать файл"
                        disabled={sending}
                        onClick={() => {
                          setAttachment(null);
                          uploaded.current = null;
                          nonce.current = null;
                        }}
                      >
                        <X size={16} />
                      </IconButton>
                    </div>
                  )}
                  <form className="composer" onSubmit={send}>
                    <input
                      ref={fileInput}
                      type="file"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          if (file.size > 20 * 1024 * 1024)
                            setError('Максимальный размер файла — 20 МБ.');
                          else {
                            setAttachment(file);
                            uploaded.current = null;
                            nonce.current = null;
                          }
                        }
                        e.target.value = '';
                      }}
                    />
                    <IconButton
                      label="Прикрепить файл"
                      disabled={sending}
                      onClick={() => fileInput.current?.click()}
                    >
                      <Paperclip size={21} />
                    </IconButton>
                    <textarea
                      ref={textarea}
                      aria-label="Сообщение"
                      placeholder="Сообщение для своих…"
                      rows={1}
                      value={draft}
                      maxLength={8000}
                      disabled={sending}
                      onChange={(e) => changeDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (
                          e.key === 'Enter' &&
                          !e.shiftKey &&
                          !e.nativeEvent.isComposing &&
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
                                changeDraft(draft + emoji);
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
                        disabled={sending}
                        onClick={() => setEmojiOpen((v) => !v)}
                      >
                        <Smile size={22} />
                      </IconButton>
                    </div>
                    <button
                      className="send-button"
                      aria-label="Отправить сообщение"
                      title="Отправить сообщение"
                      disabled={sending || (!draft.trim() && !attachment)}
                    >
                      {sending ? (
                        <LoaderCircle size={20} className="spin" />
                      ) : (
                        <ArrowRight size={22} />
                      )}
                    </button>
                  </form>
                  <div className="composer-foot">
                    <span>Будьте собой. Вы среди своих.</span>
                    <span className="desktop-hint">
                      Enter — отправить · Shift + Enter — новая строка
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
                        ? 'Хорошо, когда есть свои.'
                        : active.kind === 'saved'
                          ? 'Чтобы ничего не потерялось.'
                          : `@${active.peer?.username}`}
                    </p>
                    {active.kind === 'group' && active.owner_id === me.id && (
                      <button className="secondary" onClick={invite}>
                        <Link size={15} />
                        Пригласить друзей
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
                  <div className="little-note">
                    <div className="botanical" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                      <span />
                      <i />
                    </div>
                    <p>
                      Ближе,
                      <br />
                      даже когда далеко.
                    </p>
                    <small>Для разговоров, которые важны.</small>
                  </div>
                  <div className="info-footer">
                    <Lock size={13} />
                    <span>
                      На вашем сервере
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
            <h2>Ваши люди — рядом.</h2>
            <p>Выберите разговор или начните новый.</p>
            <button className="primary" onClick={() => setModal('new')}>
              <Plus size={18} />
              Написать другу
            </button>
          </div>
        ) : section === 'modules' ? (
          <div className="content-page">
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
                <p>
                  Поможет определиться с ужином, придумает план на вечер или честно подбросит
                  монетку. Ещё одна в вашей компании.
                </p>
                <span className="module-disclosure">
                  <Lock size={13} /> Работает на вашем сервере · без ИИ и внешних API
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
            <div className="modules-future">
              <span>
                <Compass size={23} />
              </span>
              <div>
                <h3>Дальше — придумаем вместе</h3>
                <p>Место для будущих модулей: от совместных планов до маленьких игр.</p>
              </div>
              <span className="coming-soon">Ещё не доступны</span>
            </div>
          </div>
        ) : (
          <div className="content-page settings-page">
            <button className="text-button mobile-page-back" onClick={() => setSection('chats')}>
              <ArrowLeft size={17} />К чатам
            </button>
            <div className="page-top">
              <span className="page-symbol">
                <Settings size={25} />
              </span>
              <h1>Как вам удобно.</h1>
              <p>Ваш профиль и приложение.</p>
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
              <h3>Galinka на ваших устройствах</h3>
              <p>Установите приложение из браузера. Один аккаунт, все ваши разговоры.</p>
              <button className="primary" onClick={() => setModal('install')}>
                <Download size={18} />
                Установить Galinka
              </button>
              <div className="platforms">iOS · Android · Windows · macOS · Linux</div>
            </section>
            <section className="settings-section privacy-note">
              <Lock size={22} />
              <div>
                <h3>Ваш сервер — ваш круг</h3>
                <p>
                  Сообщения и файлы доступны участникам чата. MVP использует защищённое соединение
                  при настройке HTTPS. Сквозного шифрования в этой версии нет: администратор сервера
                  имеет доступ к данным.
                </p>
              </div>
            </section>
            <button className="logout-button" onClick={logout}>
              <LogOut size={18} />
              {demo ? 'Выйти из демоверсии' : 'Выйти из аккаунта'}
            </button>
            <section className="settings-section">
              <Updates hasDraft={Object.values(drafts).some((v) => v.trim().length > 0)} />
            </section>
            <p className="settings-version">Galinka {__APP_VERSION__} · Сделано для своих</p>
          </div>
        )}
      </main>
      <nav className="mobile-nav" aria-label="Навигация на телефоне">
        <button
          className={section === 'chats' ? 'active' : ''}
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
          onClick={() => setSection('modules')}
        >
          <Puzzle size={20} />
          Модули
        </button>
        <button
          className={section === 'settings' ? 'active' : ''}
          onClick={() => setSection('settings')}
        >
          <Settings size={20} />
          Настройки
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
      {modal === 'install' && (
        <Modal error={error} title="Свои всегда под рукой" onClose={() => setModal(null)}>
          <div className="install-intro">
            <img src="/icon.svg" alt="" />
            <p>Galinka устанавливается прямо из браузера — без магазина приложений.</p>
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
                <p>Откройте в Chrome → меню ⋮ → «Добавить на главный экран» → «Установить».</p>
              </div>
              <div>
                <strong>Windows, macOS и Linux</strong>
                <p>
                  Откройте в Chrome или Edge → меню → «Установить Galinka». В Safari на Mac: «Файл»
                  → «Добавить в Dock».
                </p>
              </div>
            </div>
          )}
          <p className="tiny muted">
            Для установки нужен адрес сервера с HTTPS. Для локальной разработки подходит localhost.
            Отдельных APK и EXE в MVP пока нет.
          </p>
        </Modal>
      )}
      {modal === 'profile' && (
        <Modal error={error} title="Как вас называть?" onClose={() => setModal(null)}>
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
        <Modal error={error} title="Пригласить своих" onClose={() => setModal(null)}>
          <p className="muted">
            Ссылка добавит зарегистрированного друга в «{active?.title}». Действует 7 дней. Новому
            участнику также понадобится код регистрации от владельца сервера.
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
