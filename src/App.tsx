import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useMemo,
  type FormEvent,
} from 'react';
import {
  MessageCircle,
  Search,
  Users,
  ArrowLeft,
  Settings2,
  Download,
  X,
  Paperclip,
  Images,
  FileText,
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
  Info,
  MoreVertical,
  Copy,
  QrCode,
  ScanLine,
  LoaderCircle,
  WifiOff,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronUp,
  Megaphone,
  SquarePen,
} from 'lucide-react';
import { useConversationGestures } from './gestures';
import { Avatar, seenText } from './Avatar';
import { MessageList, type MessageActions } from './MessageList';
import { AttachmentPreview, type Transfer } from './AttachmentPreview';
import { GroupSettings } from './GroupSettings';
import { VoiceRecorder } from './VoiceRecorder';
import { VideoNoteRecorder } from './VideoNoteRecorder';
import { fileLabel, isVideoNote } from './MediaAttachment';
import { getDemoFileUrl } from './demo';
import { Announcements } from './Announcements';
import { api, upload, ApiError, isDemo, API_BASE } from './api';
import { useUpdates } from './updates';
import { useNotifications, isNative, clearPushDevice } from './notifications';
import { Auth } from './Auth';
import { Settings } from './Settings';
import { ProfileHero } from './ProfileHero';
import { PersonCard } from './PersonCard';
import { listTime, SearchResults } from './SearchResults';
import { installedApp, touchDevice } from './platform';
import { currentAccent, ShareSheet } from './Share';
import { lookPrefs, ThemeImport } from './Appearance';
import { LoginApprove } from './QrLogin';
import { QrScanner, ScannedText } from './QrScanner';
import { decodeTheme, type CustomTheme } from './theme';
import {
  closeMenu,
  CloseButton,
  IconButton,
  Modal,
  motionAllowed,
  plural,
  toggleMenu,
  usePresence,
  useTabIndicator,
} from './ui';
import { compressImage } from './image';
import { App as NativeApp } from '@capacitor/app';
import { flushSync } from 'react-dom';
import type { Person, Chat, Message, Attachment, SearchHit } from './types';

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
type ModalKind = 'new' | 'install' | 'profile' | 'invite' | 'delete' | 'group' | null;
const skeletonBubbles: [boolean, string][] = [
  [false, '52%'],
  [false, '34%'],
  [true, '46%'],
  [false, '62%'],
  [true, '30%'],
  [true, '55%'],
  [false, '40%'],
];
const folders = ['Все', 'Непрочитанные', 'Личные', 'Группы', 'Архив'];
type Section = 'chats' | 'announcements' | 'settings';
// Keep in sync with the one-pane breakpoint in styles.css.
const narrowLayout =
  '(max-width: 800px), (max-width: 960px) and (max-height: 500px) and (pointer: coarse)';
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
      <form className="stack" onSubmit={create}>
        <div className="fold" data-open={kind === 'group'} inert={kind !== 'group'}>
          <div>
            <label>
              Название группы
              <input
                required
                maxLength={70}
                value={title}
                disabled={kind !== 'group'}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
          </div>
        </div>
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
          {searching && <span className="muted">Поиск…</span>}
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
          {query.length < 2 && <p className="muted">Минимум 2 символа.</p>}
        </div>
        <p className="form-error" role="alert">
          {error}
        </p>
        <button className="primary wide" disabled={busy || (kind === 'direct' && !selected.length)}>
          {busy ? (
            <LoaderCircle className="spin" size={18} />
          ) : kind === 'group' ? (
            'Создать группу'
          ) : (
            'Написать'
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
    [section, setSection] = useState<Section>('chats'),
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
    [attachments, setAttachments] = useState<
      Record<string, { file: File; source?: File; uploaded?: Attachment }>
    >({}),
    [awayFromBottom, setAwayFromBottom] = useState(false),
    [newMessageIds, setNewMessageIds] = useState<string[]>([]),
    [error, setError] = useState(''),
    [connected, setConnected] = useState(true),
    [loading, setLoading] = useState(false),
    [hasOlder, setHasOlder] = useState(false),
    [paging, setPaging] = useState(false),
    [mentionCursor, setMentionCursor] = useState<number | null>(null),
    [mentionIndex, setMentionIndex] = useState(0),
    [install, setInstall] = useState<InstallEvent | null>(null),
    [inviteUrl, setInviteUrl] = useState(''),
    [deleteId, setDeleteId] = useState(''),
    [name, setName] = useState(''),
    [emojiOpen, setEmojiOpen] = useState(false),
    [person, setPerson] = useState<Person | null>(null),
    [dropping, setDropping] = useState(false),
    [hits, setHits] = useState<string[] | null>(null),
    [hitIndex, setHitIndex] = useState(0),
    [found, setFound] = useState<{ query: string; messages: SearchHit[]; people: Person[] } | null>(
      null,
    ),
    [jumpTarget, setJumpTarget] = useState<{ chat: string; id: string } | null>(null),
    [themeImport, setThemeImport] = useState<CustomTheme | null>(null),
    [loginRequest, setLoginRequest] = useState(''),
    [scanning, setScanning] = useState(false),
    [scanned, setScanned] = useState(''),
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
    bottomRef = useRef<HTMLDivElement>(null),
    scroller = useRef<HTMLDivElement>(null),
    textarea = useRef<HTMLTextAreaElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    requestEpoch = useRef(0),
    chatRequestEpoch = useRef(0),
    nonces = useRef<Record<string, string>>({}),
    sendingChats = useRef(new Set<string>()),
    textQueue = useRef<Record<string, Promise<unknown>>>({}),
    lastRead = useRef<Record<string, string>>({}),
    messagesRef = useRef(messages),
    olderRequest = useRef<{ id: string; promise: Promise<boolean> } | null>(null),
    lastScrollTop = useRef(0),
    scrollRestore = useRef<{ id: string; top: number; height: number } | null>(null),
    joined = useRef(false),
    followBottom = useRef(true),
    jumpingToLatest = useRef(false),
    editRequest = useRef(false);
  activeRef.current = activeId;
  messagesRef.current = messages;
  const active = chats.find((c) => c.id === activeId),
    draft = activeId ? drafts[activeId] || '' : '',
    attachment = activeId ? attachments[activeId]?.file : undefined,
    sending = activeId ? sendingIds.includes(activeId) : false,
    reply = activeId ? replies[activeId] : undefined,
    edit = editing?.message.chat_id === activeId ? editing : null,
    composerValue = edit ? edit.body : draft,
    savingCurrentEdit = Boolean(edit && savingEdit);
  const mention =
    mentionCursor === null || sending || savingCurrentEdit
      ? null
      : /(?:^|\s)@([\p{L}\p{N}_]{0,24})$/u.exec(composerValue.slice(0, mentionCursor));
  const mentionOptions = mention
    ? members
        .filter(
          (member) =>
            member.id !== me?.id &&
            member.username &&
            (member.username.toLowerCase().startsWith(mention[1].toLowerCase()) ||
              member.name.toLowerCase().startsWith(mention[1].toLowerCase())),
        )
        .slice(0, 6)
    : [];
  const mentionPanel = usePresence(mentionOptions.length > 0, 160);
  const previousMentionOptions = useRef(mentionOptions);
  if (mentionOptions.length) previousMentionOptions.current = mentionOptions;
  const shownMentionOptions = mentionPanel.closing
    ? previousMentionOptions.current
    : mentionOptions;
  const mentionList = useRef<HTMLDivElement>(null);
  const selectedMention = mentionOptions[mentionIndex % mentionOptions.length];
  useEffect(() => {
    const list = mentionList.current;
    const selected = list?.querySelector<HTMLElement>('.selected');
    if (!list || !selected) return;
    const top = selected.offsetTop;
    const bottom = top + selected.offsetHeight;
    const visibleBottom = list.scrollTop + list.clientHeight;
    if (top < list.scrollTop || bottom > visibleBottom)
      list.scrollTo({
        top: top < list.scrollTop ? top : bottom - list.clientHeight,
        behavior: 'auto',
      });
  }, [selectedMention?.id]);
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
          .forEach((menu) => closeMenu(menu));
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
      if (!window.matchMedia(narrowLayout).matches)
        setActiveId((id) => id || data.find((chat) => !chat.archived)?.id || null);
    }
    return data;
  }, []);
  const markRead = useCallback(
    async (id: string, lastMessageId: string) => {
      if (
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
      const epoch = ++requestEpoch.current;
      const data = await api<Message[]>(`/chats/${id}/messages`);
      if (activeRef.current !== id || epoch !== requestEpoch.current) return;
      const previous = messagesRef.current;
      const latest = previous.at(-1);
      const freshIds =
        !reset && latest
          ? data
              .filter(
                (m) =>
                  !previous.some(
                    (old) => old.id === m.id || (old.pending && old.nonce === m.nonce),
                  ) && m.created_at >= latest.created_at,
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
        // Messages still on their way stay at the end until the server returns them.
        const local = prev.filter((m) => m.pending && !data.some((d) => d.nonce === m.nonce));
        if (reset || data.length < 60) return reconcileMessages(prev, [...data, ...local]);
        const overlap = prev.findIndex((m) => m.id === data[0].id);
        return reconcileMessages(prev, [
          ...(overlap > 0 ? prev.slice(0, overlap) : []),
          ...data,
          ...local,
        ]);
      });
      // A non-overlapping window means over 60 new messages arrived while offline.
      // Expose older history again; retaining the old "fully loaded" flag would hide it.
      if (reset || boundary < 0 || data.length < 60) setHasOlder(data.length === 60);
      if (data.length) await markRead(id, data.at(-1)!.id);
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
        // Someone in our chats came online or left: refresh statuses, not the conversation.
        if (change.type === 'presence') {
          refreshChats().catch(reportLive);
          const open = activeRef.current;
          if (open)
            api<Person[]>(`/chats/${open}/members`)
              .then((people) => {
                if (live && activeRef.current === open) setMembers(people);
              })
              .catch(() => {});
          return;
        }
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
              notificationRef.current.notify(chat.id, change.messageId);
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
    const cached = conversationCache.current.get(activeId);
    setLoading(!cached);
    setPaging(false);
    olderRequest.current = null;
    lastScrollTop.current = 0;
    setMentionCursor(null);
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
    const timer = setTimeout(() => {
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
    }, 0);
    return () => {
      valid = false;
      clearTimeout(timer);
      ++requestEpoch.current;
    };
  }, [activeId, me?.id, loadMessages, refreshChats, report]);
  /** Scroll to the bottom, marking it as ours so onScroll does not mistake it for the user. */
  const autoScroll = useRef(false);
  function stickToBottom(el: HTMLElement) {
    const bottom = el.scrollHeight - el.clientHeight;
    if (Math.abs(el.scrollTop - bottom) < 1) return;
    autoScroll.current = true;
    el.scrollTop = bottom;
  }
  const glide = useRef<{ id: string | null; last?: string; height: number }>({
    id: null,
    height: 0,
  });
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const cached = cachedScroll.current;
    if (cached && cached.id === activeId) {
      // The chat-change effect queues its messages first; wait for that DOM to commit.
      if (messages !== cached.messages) return;
      if (cached.following) stickToBottom(el);
      else el.scrollTop = cached.top;
      cachedScroll.current = null;
      return;
    }
    const restore = scrollRestore.current;
    const last = messages.at(-1)?.id;
    const previous = glide.current;
    glide.current = { id: activeId, last, height: el.scrollHeight };
    if (restore && restore.id === activeId) {
      const top = restore.top + el.scrollHeight - restore.height;
      if (Math.abs(el.scrollTop - top) >= 1) {
        autoScroll.current = true;
        el.scrollTop = top;
      }
      lastScrollTop.current = el.scrollTop;
      scrollRestore.current = null;
    } else if (followBottom.current) {
      stickToBottom(el);
      // A message arrived at the bottom: instead of jumping, the list slides up by the new
      // height. Quick bursts add up into one continuous movement rather than a series of jerks.
      const list = el.querySelector<HTMLElement>('.message-list');
      const grown = el.scrollHeight - previous.height;
      if (
        list &&
        previous.id === activeId &&
        previous.last !== last &&
        grown > 0 &&
        grown < el.clientHeight &&
        motionAllowed()
      ) {
        const running = list.getAnimations().find((animation) => animation.id === 'glide');
        const offset = running ? new DOMMatrixReadOnly(getComputedStyle(list).transform).m42 : 0;
        running?.cancel();
        const animation = list.animate(
          [{ transform: `translateY(${offset + grown}px)` }, { transform: 'none' }],
          { duration: 260, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
        );
        animation.id = 'glide';
      }
    }
  }, [messages, loading, section, activeId, reply?.id, edit?.message.id, attachment]);
  useEffect(() => {
    if (!activeId || loading || messages.some((message) => message.chat_id !== activeId)) return;
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
  }, [activeId, messages, hasOlder, loading]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Element;
      document
        .querySelectorAll('details.message-menu[open], details.chat-actions[open]')
        .forEach((menu) => {
          if (!menu.contains(target)) closeMenu(menu);
        });
      if (!target.closest('.emoji-wrap')) setEmojiOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        document.querySelector('dialog:modal')
      )
        return;
      const menus = document.querySelectorAll(
        'details.message-menu[open], details.chat-actions[open]',
      );
      if (menus.length) {
        menus.forEach((menu) => closeMenu(menu));
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
      if (followBottom.current) stickToBottom(el);
    });
    observer.observe(el);
    const content = el.querySelector('.message-list');
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [activeId, section, ready, me?.id, loading]);
  // Chat list: when a conversation moves (new message, pin), slide rows to their new places.
  // Filter and search changes rebuild the list and are not animated.
  const chatList = useRef<HTMLDivElement>(null);
  const chatTops = useRef<{ key: string; tops: Map<string, number> }>({ key: '', tops: new Map() });
  const listKey = `${filter}|${listQuery}`;
  const listOrder = chats.map((c) => `${c.id}:${c.pinned ? 1 : 0}`).join();
  useLayoutEffect(() => {
    const list = chatList.current;
    if (!list) return;
    const previous = chatTops.current;
    const tops = new Map<string, number>();
    const animate = previous.key === listKey && previous.tops.size > 0 && motionAllowed();
    list.querySelectorAll<HTMLElement>('[data-chat-id]').forEach((row) => {
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
          {
            duration: 240,
            easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
          },
        );
      else if (before !== row.offsetTop)
        row.animate([{ translate: `0 ${before - row.offsetTop}px` }, { translate: '0 0' }], {
          duration: 320,
          easing: 'cubic-bezier(0.77, 0, 0.175, 1)',
        });
    });
    chatTops.current = { key: listKey, tops };
  }, [listOrder, listKey]);
  /**
   * Galinka links, opened from the address bar or the QR scanner: sign-in approval, a shared
   * theme, someone's profile, a group invite. Returns false for anything else.
   */
  function openLink(href: string) {
    let url: URL;
    try {
      url = new URL(href, location.href);
    } catch {
      return false;
    }
    if (url.origin !== location.origin && url.hostname !== 'mess.quiby.me') return false;
    const params = url.searchParams;
    const login = params.get('login'),
      theme = params.get('theme'),
      username = params.get('u'),
      join = params.get('join');
    if (login) setLoginRequest(login);
    else if (theme) {
      const decoded = decodeTheme(theme);
      if (decoded) setThemeImport(decoded);
      else setError('Ссылка на тему повреждена.');
    } else if (username) {
      if (username === me?.username) setSection('settings');
      else
        api<Person[]>(`/users?q=${encodeURIComponent(username)}`)
          .then((people) => {
            const match = people.find((person) => person.username === username);
            if (match) setPerson(match);
            else setError('Пользователь из ссылки не найден.');
          })
          .catch(report);
    } else if (join) {
      if (demo) setError('Приглашения в группы недоступны в демоверсии.');
      else
        api<{ id: string }>('/join', 'POST', { token: join })
          .then(async (result) => {
            await refreshChats();
            select(result.id);
          })
          .catch(report);
    } else return false;
    return true;
  }
  // Links in the address bar; ?join= on first load is handled with the chat list above.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!me || params.has('join') || !['login', 'theme', 'u'].some((key) => params.has(key)))
      return;
    openLink(location.href);
    ['login', 'theme', 'u'].forEach((key) => params.delete(key));
    history.replaceState({}, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
  }, [me?.id]);
  // Search in a chat, as in Telegram: the conversation stays whole; arrows walk the matches
  // from newest to oldest, loading older history when a match is further up.
  useEffect(() => {
    setHits(null);
    const query = messageQuery.trim();
    if (!activeId || !searchOpen || query.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<Message[]>(
        `/chats/${activeId}/messages?q=${encodeURIComponent(query)}`,
        'GET',
        undefined,
        { signal: controller.signal },
      )
        .then((matches) => {
          const ids = matches.map((message) => message.id).reverse();
          setHits(ids);
          setHitIndex(0);
          if (ids[0]) void showMessage(ids[0]);
        })
        .catch((cause) => {
          if (!controller.signal.aborted) report(cause);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [messageQuery, activeId, searchOpen]);
  function stepHit(delta: number) {
    if (!hits?.length) return;
    const next = Math.max(0, Math.min(hits.length - 1, hitIndex + delta));
    setHitIndex(next);
    void showMessage(hits[next]);
  }
  // Search in the sidebar: chats, people and messages from every chat, as in Telegram.
  useEffect(() => {
    const query = listQuery.trim();
    if (query.length < 2) {
      setFound(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const options = { signal: controller.signal };
      Promise.all([
        api<SearchHit[]>(`/search?q=${encodeURIComponent(query)}`, 'GET', undefined, options),
        api<Person[]>(`/users?q=${encodeURIComponent(query)}`, 'GET', undefined, options),
      ])
        .then(([messages, people]) => setFound({ query, messages, people }))
        .catch((cause) => {
          if (!controller.signal.aborted) report(cause);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [listQuery]);
  // A message picked in search opens once its chat has loaded.
  useEffect(() => {
    if (
      !jumpTarget ||
      loading ||
      activeId !== jumpTarget.chat ||
      !messages.some((message) => message.chat_id === jumpTarget.chat)
    )
      return;
    setJumpTarget(null);
    void showMessage(jumpTarget.id);
  }, [jumpTarget, loading, activeId, messages]);
  // Folders: the list slides in from the side of the folder chosen, the underline follows.
  const folderTabs = useTabIndicator(filter);
  const folderMove = useRef({ filter, dir: '' });
  if (folderMove.current.filter !== filter)
    folderMove.current = {
      filter,
      dir: folders.indexOf(filter) > folders.indexOf(folderMove.current.filter) ? 'next' : 'prev',
    };
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const info = usePresence(infoOpen, 260);
  const search = usePresence(searchOpen, 160);
  // Keep the last reply, edit and error on screen while their bars fold away.
  const context = edit || reply ? { edit, reply } : null;
  const lastContext = useRef(context);
  if (context) lastContext.current = context;
  const contextBar = usePresence(Boolean(context), 160);
  const shownContext = context || lastContext.current;
  const lastError = useRef(error);
  if (error) lastError.current = error;
  const errorBar = usePresence(Boolean(error), 160);
  // Phone layout: animate list → chat as a push and chat → list as a pop; tabs switch instantly.
  const shell = useRef<HTMLDivElement>(null);
  const pane = activeId && section === 'chats' ? 'chat' : section;
  const lastPane = useRef(pane);
  useLayoutEffect(() => {
    const el = shell.current;
    if (el && lastPane.current !== pane)
      el.dataset.nav = pane === 'chat' ? 'push' : lastPane.current === 'chat' ? 'pop' : '';
    lastPane.current = pane;
  }, [pane]);
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
  function chooseMention(member: Person) {
    const field = textarea.current;
    if (!field || !mention || mentionCursor === null) return;
    const start = mentionCursor - mention[1].length - 1;
    const tail = composerValue.slice(mentionCursor);
    const rest = tail.replace(/^[\p{L}\p{N}_]+/u, '');
    const inserted = `@${member.username}${/^\s/.test(rest) ? '' : ' '}`;
    const value = composerValue.slice(0, start) + inserted + rest;
    if (value.length > 8000) return;
    changeDraft(value);
    setMentionCursor(null);
    requestAnimationFrame(() => {
      if (field !== textarea.current || activeId !== activeRef.current) return;
      field.focus({ preventScroll: true });
      const cursor = start + inserted.length + (/^\s/.test(rest) ? 1 : 0);
      field.setSelectionRange(cursor, cursor);
    });
  }
  function closeMenus() {
    document
      .querySelectorAll('details.message-menu[open], details.chat-actions[open]')
      .forEach((menu) => closeMenu(menu));
  }
  function positionMessageMenu(details: HTMLDetailsElement, point?: { x: number; y: number }) {
    if (!details.open) return;
    setCopiedMessageId(null);
    const menu = details.querySelector<HTMLElement>('.message-menu-content');
    const summary = details.querySelector('summary');
    if (!menu || !summary) return;
    const viewport = window.visualViewport;
    const width = Math.min(240, window.innerWidth - 24);
    const height = Math.min(menu.scrollHeight, (viewport?.height ?? window.innerHeight) - 24);
    const origin = viewport?.offsetTop ?? 0;
    const bottom = origin + (viewport?.height ?? window.innerHeight);
    const own = Boolean(details.closest('.own'));
    // Right click and long press open at the pointer; the handle opens next to itself.
    const rect = point
      ? { left: point.x, right: point.x, top: point.y, bottom: point.y }
      : summary.getBoundingClientRect();
    const left = Math.max(
      12,
      Math.min(
        point ? (own ? rect.left - width : rect.left) : own ? rect.left : rect.right - width,
        window.innerWidth - width - 12,
      ),
    );
    const above = rect.top - height - 8 >= origin + 12;
    const top = Math.max(
      origin + 12,
      Math.min(above ? rect.top - height - 8 : rect.bottom + 8, bottom - height - 12),
    );
    menu.style.setProperty('--message-menu-x', `${left}px`);
    menu.style.setProperty('--message-menu-y', `${top}px`);
    // Grow out of the point it was opened from.
    const anchorX = Math.max(0, Math.min(width, (point || own ? rect.left : rect.right) - left));
    menu.style.transformOrigin = `${anchorX}px ${above ? '100%' : '0'}`;
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
  async function attachFile(source: File, original = false) {
    const id = activeId;
    if (!id || edit || sending) return;
    const file = original ? source : await compressImage(source);
    if (file.size > 20 * 1024 * 1024) {
      setError('Файл больше 20 МБ.');
      return;
    }
    setAttachments((previous) => ({
      ...previous,
      [id]: { file, source: file === source ? undefined : source },
    }));
    setTransfers((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
    delete nonces.current[id];
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
    if (!activeId || (!draft.trim() && !attachment)) return;
    if (!attachment) {
      sendText(activeId, draft.trim(), replies[activeId]);
      return;
    }
    if (sendingChats.current.has(activeId)) return;
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
  /**
   * Text goes out optimistically, as in Telegram: the bubble appears at once, the field clears and
   * stays usable, and sends in one chat queue up so they arrive in order. The server's copy
   * replaces the bubble by its nonce; a failed one stays with a retry button.
   */
  function sendText(id: string, text: string, replyTo?: Message, nonce?: string) {
    const messageNonce = nonce ?? nonces.current[id] ?? crypto.randomUUID();
    delete nonces.current[id];
    const local: Message = {
      id: `local-${messageNonce}`,
      chat_id: id,
      sender_id: me!.id,
      sender: me!,
      body: text,
      created_at: new Date().toISOString(),
      nonce: messageNonce,
      file: null,
      reactions: [],
      read_by: 0,
      reply: replyTo
        ? {
            id: replyTo.id,
            body: replyTo.body,
            sender: { id: replyTo.sender.id, name: replyTo.sender.name },
            file_name: replyTo.file?.name,
          }
        : null,
      pending: true,
    };
    if (activeRef.current === id) {
      followBottom.current = true;
      setAwayFromBottom(false);
      setNewMessageIds([local.id]);
      setMessages((previous) => [
        ...previous.filter((message) => message.nonce !== messageNonce),
        local,
      ]);
    }
    if (!nonce) {
      setDrafts((previous) => ({ ...previous, [id]: '' }));
      setReplies((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
    }
    const post = () =>
      api(`/chats/${id}/messages`, 'POST', {
        body: text,
        nonce: messageNonce,
        replyTo: replyTo?.id,
      });
    const queued = (textQueue.current[id] ?? Promise.resolve()).then(post);
    textQueue.current[id] = queued.catch(() => {});
    queued
      .then(() => Promise.all([loadMessages(id), refreshChats()]))
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) {
          report(error);
          return;
        }
        // Keep the bubble with a retry button; the same nonce makes the retry safe.
        setMessages((previous) =>
          previous.map((message) =>
            message.nonce === messageNonce && message.pending
              ? { ...message, failed: true }
              : message,
          ),
        );
      });
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
    try {
      const r = await api<{ url: string }>(`/chats/${activeId}/invite`, 'POST');
      setInviteUrl(r.url);
      setModal('invite');
    } catch (e) {
      report(e);
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
  /** Prepend one page of older history. Returns false when there is nothing older. */
  function loadOlder() {
    const id = activeRef.current;
    const oldest = messagesRef.current.find((message) => !message.pending);
    if (!id || !oldest) return Promise.resolve(false);
    if (olderRequest.current?.id === id) return olderRequest.current.promise;
    setPaging(true);
    const epoch = requestEpoch.current;
    const promise = api<Message[]>(`/chats/${id}/messages?before=${encodeURIComponent(oldest.id)}`)
      .then((data) => {
        if (activeRef.current !== id || epoch !== requestEpoch.current) return false;
        followBottom.current = false;
        setAwayFromBottom(true);
        const el = scroller.current;
        if (el) scrollRestore.current = { id, top: el.scrollTop, height: el.scrollHeight };
        // Committed at once, so a caller looking for a message finds it in the DOM.
        flushSync(() => {
          setMessages((prev) => [
            ...data.filter((m) => !prev.some((old) => old.id === m.id)),
            ...prev,
          ]);
          setHasOlder(data.length === 60);
        });
        return data.length > 0;
      })
      .catch((e) => {
        if (activeRef.current === id && epoch === requestEpoch.current) report(e);
        return false;
      })
      .finally(() => {
        if (olderRequest.current?.promise === promise) {
          olderRequest.current = null;
          setPaging(false);
        }
      });
    olderRequest.current = { id, promise };
    return promise;
  }
  /** Scroll to a message and light it up, loading older pages until it is on screen. */
  async function showMessage(messageId: string) {
    const id = activeRef.current;
    for (let page = 0; page < 40 && id === activeRef.current; page++) {
      const row = scroller.current?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
      if (row) {
        row.scrollIntoView({ block: 'center', behavior: motionAllowed() ? 'smooth' : 'auto' });
        row.classList.remove('flash');
        void row.offsetWidth;
        row.classList.add('flash');
        return;
      }
      if (!(await loadOlder())) break;
    }
    if (id === activeRef.current) setError('Сообщение не найдено в истории.');
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
    profile: (sender) => {
      closeMenus();
      setPerson(sender);
    },
    mention: (username) => {
      const member = members.find((person) => person.username === username);
      if (member) setPerson(member);
      else openLink(`/app?u=${encodeURIComponent(username)}`);
    },
    retry: (message) => {
      setMessages((previous) =>
        previous.map((item) => (item.id === message.id ? { ...item, failed: false } : item)),
      );
      const original = message.reply
        ? messagesRef.current.find((item) => item.id === message.reply!.id)
        : undefined;
      sendText(message.chat_id, message.body, original, message.nonce);
    },
    discard: (message) =>
      setMessages((previous) => previous.filter((item) => item.id !== message.id)),
    jump: (id) => void showMessage(id),
  };
  // Keep the timeline independent from composer keystrokes while callbacks see current state.
  const messageActions = useMemo<MessageActions>(
    () => ({
      reply: (message) => latestMessageActions.current.reply(message),
      edit: (message) => latestMessageActions.current.edit(message),
      copy: (message) => latestMessageActions.current.copy(message),
      react: (message, emoji) => latestMessageActions.current.react(message, emoji),
      download: (file) => latestMessageActions.current.download(file),
      menu: (details, point) => latestMessageActions.current.menu(details, point),
      remove: (message) => latestMessageActions.current.remove(message),
      jump: (id) => latestMessageActions.current.jump(id),
      profile: (sender) => latestMessageActions.current.profile(sender),
      mention: (username) => latestMessageActions.current.mention(username),
      retry: (message) => latestMessageActions.current.retry(message),
      discard: (message) => latestMessageActions.current.discard(message),
    }),
    [],
  );
  if (!ready)
    return (
      <div className="boot" role="status">
        <img src="/icon.svg" alt="Galinka" width="40" height="40" />
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
  async function refreshMembers() {
    if (!active) return;
    const id = active.id;
    await refreshChats();
    const people = await api<Person[]>(`/chats/${id}/members`);
    if (activeRef.current === id) setMembers(people);
  }
  const preview = (c: Chat) => {
    const file = c.last_message?.file;
    return (
      c.last_message?.body ||
      (file?.mime?.startsWith('audio/')
        ? 'Голосовое сообщение'
        : file && isVideoNote(file)
          ? 'Кружок'
          : file?.mime?.startsWith('video/')
            ? 'Видео'
            : file?.mime?.startsWith('image/')
              ? 'Фотография'
              : file?.name || (c.last_message?.file_id ? 'Файл' : 'Нет сообщений'))
    );
  };
  const subtitle = (chat: Chat) => {
    if (chat.kind === 'saved') return 'Заметки и файлы';
    if (chat.kind === 'direct') return seenText(chat.peer?.seen) || `@${chat.peer?.username || ''}`;
    const total = `${chat.member_count} ${plural(chat.member_count, 'участник', 'участника', 'участников')}`;
    // Others online in the open group, as in Telegram: "5 участников, 2 в сети".
    const online =
      chat.id === activeId
        ? members.filter((person) => person.id !== me.id && person.seen === 'online').length
        : 0;
    return online ? `${total}, ${online} в сети` : total;
  };
  // On a phone the Chats tab returns to the list; wider layouts keep the open conversation.
  const openSection = (next: Section) => {
    setSection(next);
    if (next === 'chats' && matchMedia(narrowLayout).matches) setActiveId(null);
  };
  return (
    <div
      ref={shell}
      className={`app-shell ${activeId && section === 'chats' ? 'has-active' : ''} section-${section}`}
    >
      <aside className="sidebar">
        <header className="sidebar-head">
          <h1>{filter === 'Архив' ? 'Архив' : 'Чаты'}</h1>
          {demo && <span className="demo-badge">Демо</span>}
          {updates.available && (
            <IconButton
              label="Доступно обновление"
              className="update-dot"
              onClick={() => setSection('settings')}
            >
              <Download size={19} />
            </IconButton>
          )}
          {/* Phones scan codes; computers show them (sign-in, sharing). */}
          {touchDevice() && (
            <IconButton label="Сканировать QR-код" onClick={() => setScanning(true)}>
              <ScanLine size={20} />
            </IconButton>
          )}
          <IconButton label="Новый чат" className="new-chat" onClick={() => setModal('new')}>
            <SquarePen size={20} />
          </IconButton>
        </header>
        <label className="search-field">
          <Search size={17} />
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
        {filter !== 'Архив' && !listQuery.trim() && (
          <div className="chat-filters" aria-label="Фильтр чатов" ref={folderTabs}>
            {folders.slice(0, 4).map((f) => (
              <button
                key={f}
                aria-pressed={filter === f}
                className={filter === f ? 'selected' : ''}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
        )}
        {listQuery.trim() ? (
          <SearchResults
            query={listQuery.trim()}
            chats={chats}
            found={found?.query === listQuery.trim() ? found : null}
            me={me}
            onChat={(id) => {
              select(id);
              setListQuery('');
            }}
            onPerson={setPerson}
            onMessage={(hit) => {
              select(hit.chat_id);
              setListQuery('');
              setJumpTarget({ chat: hit.chat_id, id: hit.id });
            }}
          />
        ) : (
          <div
            className="chat-list"
            ref={chatList}
            key={filter}
            data-dir={folderMove.current.dir}
            // Phones: a horizontal swipe moves to the next or previous folder.
            onTouchStart={(event) => {
              const touch = event.touches[0];
              swipe.current =
                event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
            }}
            onTouchEnd={(event) => {
              const start = swipe.current;
              swipe.current = null;
              if (!start || filter === 'Архив') return;
              const touch = event.changedTouches[0];
              const dx = touch.clientX - start.x;
              if (Math.abs(dx) < 70 || Math.abs(dx) < 2 * Math.abs(touch.clientY - start.y)) return;
              const next = folders.indexOf(filter) + (dx < 0 ? 1 : -1);
              if (next >= 0 && next < 4) setFilter(folders[next]);
            }}
          >
            {(archivedCount > 0 || filter === 'Архив') && (
              <button
                className={filter === 'Архив' ? 'archive-link selected' : 'archive-link'}
                aria-pressed={filter === 'Архив'}
                onClick={() => setFilter(filter === 'Архив' ? 'Все' : 'Архив')}
              >
                {filter === 'Архив' ? <ArrowLeft size={18} /> : <Archive size={18} />}
                <span>{filter === 'Архив' ? 'Все чаты' : 'Архив'}</span>
                {filter !== 'Архив' && <small>{archivedCount}</small>}
              </button>
            )}
            {filtered.map((c) => (
              <button
                key={c.id}
                data-chat-id={c.id}
                className={`chat-item ${activeId === c.id && section === 'chats' ? 'selected' : ''}`}
                onClick={() => select(c.id)}
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
                      {drafts[c.id] || attachments[c.id] ? (
                        <>
                          <span className="chat-draft">Черновик:</span>{' '}
                          {drafts[c.id] || fileLabel(attachments[c.id].file.name)}
                        </>
                      ) : (
                        <>
                          {c.last_message?.sender_id === me.id && (
                            <span className="chat-you">Вы: </span>
                          )}
                          {preview(c)}
                        </>
                      )}
                    </span>
                    {c.unread > 0 ? (
                      <b key={c.unread} className={`unread ${c.muted ? 'muted-unread' : ''}`}>
                        {c.unread > 99 ? '99+' : c.unread}
                      </b>
                    ) : (
                      c.pinned && <Pin size={13} className="pin-mark" aria-label="Закреплён" />
                    )}
                  </span>
                </span>
              </button>
            ))}
            {!initialized.current &&
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
            {/* Until the first list arrives there is nothing to call empty. */}
            {!filtered.length && initialized.current && (
              <div className="list-empty">
                <p>
                  {listQuery
                    ? 'Ничего не найдено'
                    : filter === 'Архив'
                      ? 'Архив пуст'
                      : filter === 'Непрочитанные'
                        ? 'Всё прочитано'
                        : 'Чатов пока нет'}
                </p>
                {!listQuery && filter === 'Все' && (
                  <button className="secondary" onClick={() => setModal('new')}>
                    Новый чат
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </aside>
      <nav className="app-nav" aria-label="Разделы">
        {(
          [
            ['chats', 'Чаты', MessageCircle],
            ['announcements', 'Объявления', Megaphone],
            ['settings', 'Настройки', Settings2],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            className={section === value ? 'active' : ''}
            aria-current={section === value ? 'page' : undefined}
            aria-label={label}
            onClick={() => openSection(value)}
          >
            <Icon size={21} />
            <span>{label}</span>
            {value === 'chats' && unread > 0 && (
              <b key={unread} className="nav-badge">
                {unread > 99 ? '99+' : unread}
              </b>
            )}
          </button>
        ))}
      </nav>
      <main className="workspace">
        {demo && (
          <div className="demo-bar">
            <span>Демо-режим: данные только в этом браузере</span>
            <button className="text-button" onClick={logout}>
              Войти
            </button>
          </div>
        )}
        {!connected && !demo && (
          <div className="connection-bar" role="status">
            <WifiOff size={15} /> Нет соединения. Переписка обновится после подключения.
          </div>
        )}
        {errorBar.mounted && (
          <div className={`error-bar ${errorBar.closing ? 'closing' : ''}`} role="alert">
            <span>{error || lastError.current}</span>
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
              <button className="chat-heading" onClick={() => setInfoOpen((v) => !v)}>
                <Avatar person={active.peer} chat={active} size="small" />
                <span>
                  <h2>{active.title}</h2>
                  <p
                    className={
                      active.kind === 'direct' && active.peer?.seen === 'online' ? 'is-online' : ''
                    }
                  >
                    {subtitle(active)}
                  </p>
                </span>
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
                  <Search size={20} />
                </IconButton>
                <IconButton
                  label="О чате"
                  className={`info-toggle ${infoOpen ? 'active' : ''}`}
                  onClick={() => setInfoOpen((v) => !v)}
                >
                  <Info size={20} />
                </IconButton>
                <details className="chat-actions">
                  <summary
                    onClick={toggleMenu}
                    className="icon-button"
                    aria-label="Действия с чатом"
                    title="Действия с чатом"
                  >
                    <MoreVertical size={20} />
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
            {search.mounted && (
              <div className={`message-search ${search.closing ? 'closing' : ''}`}>
                <Search size={17} />
                <input
                  aria-label="Поиск по сообщениям"
                  placeholder="Поиск в чате"
                  value={messageQuery}
                  onChange={(e) => setMessageQuery(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter goes to the next older match, Shift+Enter back to a newer one.
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    stepHit(e.shiftKey ? -1 : 1);
                  }}
                  autoFocus
                />
                {hits && (
                  <span className="search-count" role="status">
                    {hits.length ? `${hitIndex + 1} из ${hits.length}` : 'Не найдено'}
                  </span>
                )}
                <IconButton
                  label="Предыдущее совпадение"
                  disabled={!hits || hitIndex >= hits.length - 1}
                  onClick={() => stepHit(1)}
                >
                  <ChevronUp size={20} />
                </IconButton>
                <IconButton
                  label="Следующее совпадение"
                  disabled={!hits || hitIndex <= 0}
                  onClick={() => stepHit(-1)}
                >
                  <ChevronDown size={20} />
                </IconButton>
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
              <section
                className={`conversation ${dropping ? 'dropping' : ''}`}
                aria-label="Переписка"
                // Desktop: drop a file anywhere on the conversation to attach it.
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes('Files') || edit || sending) return;
                  event.preventDefault();
                  setDropping(true);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node))
                    setDropping(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDropping(false);
                  const file = event.dataTransfer.files[0];
                  if (file) void attachFile(file);
                }}
              >
                <div
                  className="messages"
                  ref={scroller}
                  {...gestures}
                  onWheel={(event) => {
                    jumpingToLatest.current = false;
                    if (
                      hasOlder &&
                      !loading &&
                      event.deltaY < 0 &&
                      event.currentTarget.scrollTop <= 0
                    )
                      void loadOlder();
                    // A floating message menu would stay put while its message scrolls away.
                    document
                      .querySelectorAll('details.message-menu[open]')
                      .forEach((menu) => closeMenu(menu));
                  }}
                  onTouchStart={() => {
                    jumpingToLatest.current = false;
                  }}
                  onScroll={() => {
                    const el = scroller.current!;
                    const upwards = el.scrollTop < lastScrollTop.current;
                    lastScrollTop.current = el.scrollTop;
                    // Our own jump to the bottom: content may have grown meanwhile (a photo
                    // decoding), which must not read as the user scrolling up.
                    if (autoScroll.current) {
                      autoScroll.current = false;
                      return;
                    }
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
                    if (upwards && el.scrollTop < 180 && hasOlder && !loading) void loadOlder();
                    const latest = messages.at(-1);
                    if (followBottom.current && activeId && latest)
                      void markRead(activeId, latest.id);
                  }}
                >
                  {loading ? (
                    // Placeholder bubbles in the shape of a conversation while it loads.
                    <div className="messages-loading" role="status" aria-label="Загрузка">
                      {skeletonBubbles.map(([own, width], index) => (
                        <span key={index} className={own ? 'own' : ''} style={{ width }} />
                      ))}
                    </div>
                  ) : (
                    <>
                      {hasOlder && (
                        <button
                          className="older-button"
                          onClick={() => void loadOlder()}
                          disabled={paging}
                        >
                          {paging ? 'Загрузка…' : 'Более ранние сообщения'}
                        </button>
                      )}
                      {!messages.length && (
                        <div className="conversation-empty">
                          <p>Сообщений пока нет</p>
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
                        highlight={
                          searchOpen && messageQuery.trim().length >= 2 ? messageQuery : undefined
                        }
                      />
                      <div ref={bottomRef} />
                    </>
                  )}
                </div>
                <div className="composer-wrap">
                  {/* Always rendered so it can fade out as well as in. Inside the composer block, so it
                    always sits above it, however tall the reply bar and draft make it. */}
                  <button
                    type="button"
                    className={`jump-to-latest ${awayFromBottom ? 'shown' : ''}`}
                    inert={!awayFromBottom}
                    onClick={jumpToLatest}
                    aria-label="К последним сообщениям"
                  >
                    <ArrowDown size={20} />
                    {active.unread > 0 && <b key={active.unread}>{active.unread}</b>}
                  </button>
                  {contextBar.mounted && shownContext && (
                    <div
                      className={`composer-context ${shownContext.edit ? 'editing' : ''} ${contextBar.closing ? 'closing' : ''}`}
                    >
                      {shownContext.edit ? <Pencil size={18} /> : <Reply size={18} />}
                      <div>
                        <strong>
                          {shownContext.edit ? 'Редактирование' : shownContext.reply!.sender.name}
                        </strong>
                        <p>
                          {shownContext.edit
                            ? shownContext.edit.message.body || shownContext.edit.message.file?.name
                            : shownContext.reply!.body ||
                              (shownContext.reply!.file &&
                                fileLabel(shownContext.reply!.file.name)) ||
                              'Сообщение'}
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
                      original={
                        activeId && attachments[activeId]?.source && !transfers[activeId]
                          ? attachments[activeId].source
                          : undefined
                      }
                      onOriginal={() => {
                        const source = activeId ? attachments[activeId]?.source : undefined;
                        if (source) void attachFile(source, true);
                      }}
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
                    {mentionPanel.mounted && (
                      <div
                        ref={mentionList}
                        className="mention-options"
                        role="group"
                        aria-label="Упомянуть участника"
                        data-closing={mentionPanel.closing || undefined}
                        inert={mentionPanel.closing}
                      >
                        {shownMentionOptions.map((member, index) => (
                          <button
                            key={member.id}
                            type="button"
                            className={
                              index === mentionIndex % shownMentionOptions.length ? 'selected' : ''
                            }
                            onPointerDown={(event) => event.preventDefault()}
                            onClick={() => chooseMention(member)}
                          >
                            <Avatar person={member} size="small" />
                            <span>
                              {member.name} <small>@{member.username}</small>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    <input
                      ref={fileInput}
                      type="file"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void attachFile(file);
                        e.target.value = '';
                      }}
                    />
                    <div className="composer-field">
                      {sending || edit ? (
                        <IconButton label="Прикрепить файл" disabled>
                          <Paperclip size={21} />
                        </IconButton>
                      ) : (
                        <details className="chat-actions attachment-menu">
                          <summary
                            className="icon-button"
                            aria-label="Прикрепить файл"
                            onClick={toggleMenu}
                          >
                            <Paperclip size={21} />
                          </summary>
                          <div className="chat-actions-menu">
                            {(
                              [
                                [Images, 'Галерея', 'image/*,video/*'],
                                [FileText, 'Файл', ''],
                              ] as const
                            ).map(([Icon, label, accept]) => {
                              return (
                                <button
                                  type="button"
                                  key={label}
                                  onClick={(event) => {
                                    const input = fileInput.current;
                                    if (!input) return;
                                    closeMenu(event.currentTarget.closest('details')!);
                                    input.accept = accept;
                                    input.click();
                                  }}
                                >
                                  <Icon size={18} />
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </details>
                      )}
                      <textarea
                        ref={textarea}
                        enterKeyHint="enter"
                        aria-label="Сообщение"
                        placeholder={edit ? 'Изменить сообщение' : 'Сообщение'}
                        rows={1}
                        value={composerValue}
                        maxLength={8000}
                        readOnly={sending || savingCurrentEdit}
                        aria-busy={sending || savingCurrentEdit}
                        onChange={(e) => {
                          changeDraft(e.target.value);
                          setMentionCursor(e.target.selectionEnd);
                          setMentionIndex(0);
                        }}
                        onSelect={(event) => setMentionCursor(event.currentTarget.selectionEnd)}
                        onBlur={() => setMentionCursor(null)}
                        onPaste={(e) => {
                          const file = e.clipboardData.files[0];
                          if (file && !edit) {
                            e.preventDefault();
                            void attachFile(file);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (
                            selectedMention &&
                            !e.nativeEvent.isComposing &&
                            e.nativeEvent.keyCode !== 229
                          ) {
                            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                              e.preventDefault();
                              setMentionIndex(
                                (index) =>
                                  (index +
                                    mentionOptions.length +
                                    (e.key === 'ArrowDown' ? 1 : -1)) %
                                  mentionOptions.length,
                              );
                              return;
                            }
                            if (
                              (e.key === 'Enter' || e.key === 'Tab') &&
                              !e.shiftKey &&
                              !e.ctrlKey &&
                              !e.metaKey
                            ) {
                              e.preventDefault();
                              chooseMention(selectedMention);
                              return;
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              setMentionCursor(null);
                              return;
                            }
                          }
                          // As in Telegram Desktop: ↑ in an empty field edits your last message.
                          if (e.key === 'ArrowUp' && !composerValue && !edit && !attachment) {
                            const last = [...messages]
                              .reverse()
                              .find((message) => message.sender_id === me.id && message.body);
                            if (last) {
                              e.preventDefault();
                              startEdit(last);
                              return;
                            }
                          }
                          const enterSends = lookPrefs().enterSends;
                          if (
                            e.key === 'Enter' &&
                            !e.shiftKey &&
                            !e.nativeEvent.isComposing &&
                            e.nativeEvent.keyCode !== 229 &&
                            window.matchMedia('(pointer:fine)').matches &&
                            (enterSends || e.ctrlKey || e.metaKey)
                          ) {
                            e.preventDefault();
                            send();
                          }
                        }}
                      />
                      <div className="emoji-wrap">
                        {
                          <div
                            className={`emoji-picker ${emojiOpen ? 'open' : ''}`}
                            inert={!emojiOpen}
                          >
                            {['😊', '😂', '❤', '👍', '🙏', '🎉', '🔥', '😢'].map((emoji) => (
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
                        }
                        <IconButton
                          label="Добавить эмодзи"
                          disabled={sending || savingCurrentEdit}
                          onClick={() => setEmojiOpen((v) => !v)}
                        >
                          <Smile size={21} />
                        </IconButton>
                      </div>
                      {!edit && !draft.trim() && !attachment && (
                        <VideoNoteRecorder
                          key={active.id}
                          disabled={sending}
                          onRecorded={(file) => void attachFile(file)}
                          onError={setError}
                        />
                      )}
                    </div>
                    {!edit && !draft.trim() && !attachment ? (
                      <VoiceRecorder
                        key={active.id}
                        disabled={sending}
                        onRecorded={(file) => void attachFile(file)}
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
                          <Check size={21} />
                        ) : (
                          <ArrowUp size={21} />
                        )}
                      </button>
                    )}
                  </form>
                </div>
              </section>
              {info.mounted && (
                <aside
                  className={`chat-info ${info.closing ? 'closing' : ''}`}
                  aria-label="О чате"
                  inert={info.closing}
                >
                  <div className="info-head">
                    <strong>О чате</strong>
                    <IconButton label="Закрыть информацию" onClick={() => setInfoOpen(false)}>
                      <X size={20} />
                    </IconButton>
                  </div>
                  <ProfileHero
                    key={active.id}
                    chat={active}
                    person={active.peer}
                    title={active.title}
                    subtitle={subtitle(active)}
                  />
                  <div className="hero-tiles">
                    <button
                      disabled={preferenceBusy}
                      onClick={() => void setChatPreference(active, { muted: !active.muted })}
                    >
                      {active.muted ? <Bell size={20} /> : <BellOff size={20} />}
                      {active.muted ? 'Звук' : 'Без звука'}
                    </button>
                    <button
                      onClick={() => {
                        if (window.innerWidth <= 1180) setInfoOpen(false);
                        setSearchOpen(true);
                      }}
                    >
                      <Search size={20} />
                      Поиск
                    </button>
                    {active.kind === 'group' && active.owner_id === me.id && (
                      <>
                        <button onClick={invite}>
                          <QrCode size={20} />
                          Пригласить
                        </button>
                        <button onClick={() => setModal('group')}>
                          <Users size={20} />
                          Управление
                        </button>
                      </>
                    )}
                  </div>
                  {active.kind !== 'saved' && (
                    <div className="info-section">
                      <h4>
                        Участники <span>{members.length}</span>
                      </h4>
                      {members.map((p) => (
                        <button
                          type="button"
                          className="member-row"
                          key={p.id}
                          onClick={() => setPerson(p)}
                        >
                          <Avatar person={p} size="small" />
                          <span className="member-name">
                            <strong>
                              {p.name}
                              {p.id === me.id && <small> · вы</small>}
                            </strong>
                            <small className={p.seen === 'online' ? 'is-online' : ''}>
                              {p.id === me.id ? 'в сети' : seenText(p.seen) || `@${p.username}`}
                            </small>
                          </span>
                          {p.id === active.owner_id && active.kind === 'group' && (
                            <span className="owner-label">владелец</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="info-section">
                    <div className="settings-row">
                      <div>
                        <h3>Неля</h3>
                        <p>
                          Бот для компании: «@неля монетка», «@неля выбери чай | кофе», «@неля
                          идея».
                          {active.owner_id !== me.id && ' Включает владелец чата.'}
                        </p>
                      </div>
                      <button
                        className={`switch ${active.nelya ? 'on' : ''}`}
                        role="switch"
                        aria-checked={active.nelya}
                        aria-label="Неля в этом чате"
                        disabled={working || active.owner_id !== me.id}
                        onClick={() => toggleNelya(active)}
                      >
                        <span />
                      </button>
                    </div>
                  </div>
                </aside>
              )}
            </div>
          </>
        ) : section === 'chats' ? (
          <div className="workspace-empty">
            <p>Выберите чат слева или начните новый.</p>
            <button className="secondary" onClick={() => setModal('new')}>
              Новый чат
            </button>
          </div>
        ) : section === 'announcements' ? (
          <div className="content-page" key={section}>
            <Announcements />
          </div>
        ) : (
          <Settings
            me={me}
            demo={demo}
            notifications={notifications}
            hasDraft={
              Object.keys(attachments).length > 0 || Boolean(editing) || sendingIds.length > 0
            }
            onEditName={() => {
              setName(me.name);
              setModal('profile');
            }}
            onInstall={installedApp() ? undefined : () => setModal('install')}
            onScan={touchDevice() ? () => setScanning(true) : undefined}
            onMe={(person) => setMe((current) => (current ? { ...current, ...person } : person))}
            onLogout={logout}
          />
        )}
      </main>
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
          onOpenPerson={setPerson}
          onUpdated={refreshMembers}
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
      {person && (
        <PersonCard
          key={person.id}
          person={person}
          me={me}
          chat={active}
          onClose={() => setPerson(null)}
          onUpdated={refreshMembers}
          onMessage={async () => {
            const { id } = await api<{ id: string }>('/chats', 'POST', {
              kind: 'direct',
              userIds: [person.id],
            });
            setPerson(null);
            setModal(null);
            await refreshChats();
            select(id);
          }}
        />
      )}
      {modal === 'install' && (
        <Modal error={error} title="Установить Galinka" onClose={() => setModal(null)}>
          {install && (
            <button
              className="primary wide"
              onClick={async () => {
                await install.prompt();
                await install.userChoice;
                setInstall(null);
              }}
            >
              Установить веб-приложение
            </button>
          )}
          <dl className="install-steps">
            <dt>iPhone и iPad</dt>
            <dd>Safari → «Поделиться» → «На экран Домой».</dd>
            <dt>Android, Windows, macOS, Linux</dt>
            <dd>Установщики — на странице загрузок.</dd>
          </dl>
          <a
            className="secondary wide"
            href={isNative ? 'https://mess.quiby.me/#download' : '/#download'}
          >
            <Download size={17} />
            Страница загрузок
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
              Имя
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                required
                autoFocus
              />
            </label>
            <button className="primary wide" disabled={working}>
              {working ? 'Сохранение…' : 'Сохранить'}
            </button>
          </form>
        </Modal>
      )}
      {modal === 'invite' && inviteUrl && (
        <ShareSheet
          heading="Пригласить в группу"
          title={active?.title || 'Группа'}
          subtitle="Ссылка-приглашение действует 7 дней"
          link={inviteUrl}
          accent={currentAccent()}
          onClose={() => setModal(null)}
        />
      )}
      {themeImport && <ThemeImport theme={themeImport} onClose={() => setThemeImport(null)} />}
      {loginRequest && <LoginApprove token={loginRequest} onClose={() => setLoginRequest('')} />}
      {scanning && (
        <QrScanner
          onClose={() => setScanning(false)}
          onResult={(text) => {
            setScanning(false);
            if (!openLink(text)) setScanned(text);
          }}
        />
      )}
      {scanned && <ScannedText text={scanned} onClose={() => setScanned('')} />}
      {modal === 'delete' && (
        <Modal error={error} title="Удалить сообщение?" onClose={() => setModal(null)}>
          <p className="muted">Сообщение удалится у всех участников.</p>
          <div className="modal-actions">
            <CloseButton>Отмена</CloseButton>
            <button
              className="danger"
              disabled={working}
              onClick={async () => {
                setWorking(true);
                try {
                  await api(`/chats/${activeId}/messages/${deleteId}`, 'DELETE');
                  setModal(null);
                  // Fold the row away before it leaves the list.
                  const row = scroller.current
                    ?.querySelector(`[data-message-id="${deleteId}"]`)
                    ?.closest<HTMLElement>('.message-group-item');
                  if (row && motionAllowed()) {
                    row.style.overflow = 'hidden';
                    const fold = row
                      .animate(
                        [
                          { height: `${row.offsetHeight}px`, opacity: 1 },
                          { height: '0px', opacity: 0, transform: 'scale(0.96)' },
                        ],
                        {
                          duration: 220,
                          easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
                          fill: 'forwards',
                        },
                      )
                      .finished.catch(() => undefined);
                    // Background tabs pause animations; never let that hold the deletion.
                    await Promise.race([fold, new Promise((done) => setTimeout(done, 300))]);
                  }
                  setMessages((prev) => prev.filter((m) => m.id !== deleteId));
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
