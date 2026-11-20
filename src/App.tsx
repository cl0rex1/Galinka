import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import {
  MessageCircle,
  Search,
  Users,
  ArrowLeft,
  Settings2,
  Download,
  X,
  Pin,
  PinOff,
  Bell,
  BellOff,
  Archive,
  ArchiveRestore,
  Info,
  MoreVertical,
  Copy,
  ScanLine,
  WifiOff,
  ChevronDown,
  CalendarDays,
  ChevronUp,
  Megaphone,
  SquarePen,
  Forward,
  Trash2,
  CalendarClock,
  Timer,
  Undo2,
} from 'lucide-react';
import { slideBack, useConversationGestures } from './gestures';
import { PHONE_LAYOUT } from './layout';
import { AnimatedText } from './motion';
import { Avatar, seenText } from './Avatar';
import { MessageList, type MessageActions } from './MessageList';
import { MiniPlayer } from './MiniPlayer';
import { fileLabel } from './MediaAttachment';
import { plainText } from './MessageText';
import { Announcements } from './Announcements';
import { api, ApiError, isDemo } from './api';
import { badgeImage } from './sounds';
import { useUpdates } from './updates';
import { useLiveMessages } from './useLiveMessages';
import { useConversation } from './useConversation';
import { useComposer } from './useComposer';
import { Composer } from './Composer';
import { NewChat } from './NewChat';
import { ChatList, folders } from './ChatList';
import { ChatInfo } from './ChatInfo';
import { DeleteMessages } from './DeleteMessages';
import {
  AutoDeleteModal,
  EditHistoryModal,
  PollCreatorModal,
  ScheduledListModal,
  ScheduleMessageModal,
} from './MessageExtrasModal';
import { downloadAttachment } from './download';
import { ForwardDialog } from './ForwardDialog';
import { typingText, useTyping, useTypingSender } from './typing';
import { useNotifications, isNative, clearPushDevice } from './notifications';
import { Auth } from './Auth';
import { GroupSettings } from './GroupSettings';
import { Settings } from './Settings';
import { PersonCard } from './PersonCard';
import {
  hasFilters,
  rememberSearch,
  searchParams,
  SearchResults,
  type SearchFilters,
} from './SearchResults';
import { installedApp, touchDevice } from './platform';
import { currentAccent, ShareSheet } from './Share';
import { ThemeImport } from './Appearance';
import { LoginApprove } from './QrLogin';
import { QrScanner, ScannedText } from './QrScanner';
import { decodeTheme, type CustomTheme } from './theme';
import {
  closeMenu,
  IconButton,
  Modal,
  plural,
  runBackHandler,
  toggleMenu,
  usePresence,
  useTabIndicator,
} from './ui';
import { App as NativeApp } from '@capacitor/app';
import type { Person, Chat, Message, SearchHit } from './types';

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
type ModalKind =
  | 'new'
  | 'install'
  | 'invite'
  | 'delete'
  | 'group'
  | 'schedule'
  | 'scheduled-list'
  | 'poll'
  | 'auto-delete'
  | null;
const skeletonBubbles: [boolean, string][] = [
  [false, '52%'],
  [false, '34%'],
  [true, '46%'],
  [false, '62%'],
  [true, '30%'],
  [true, '55%'],
  [false, '40%'],
];
type Section = 'chats' | 'announcements' | 'settings';
const narrowLayout = PHONE_LAYOUT;
export default function App() {
  const updates = useUpdates();
  const [me, setMe] = useState<Person | null>(null),
    [ready, setReady] = useState(false),
    [demo, setDemo] = useState(isDemo),
    [chats, setChats] = useState<Chat[]>([]),
    [activeId, setActiveId] = useState<string | null>(null),
    [section, setSection] = useState<Section>('chats'),
    [modal, setModal] = useState<ModalKind>(null),
    [filter, setFilter] = useState('Все'),
    [listQuery, setListQuery] = useState(''),
    [searchOpen, setSearchOpen] = useState(false),
    [messageQuery, setMessageQuery] = useState(''),
    [infoOpen, setInfoOpen] = useState(false),
    [copiedMessageId, setCopiedMessageId] = useState<string | null>(null),
    [preferenceBusy, setPreferenceBusy] = useState(false),
    [error, setError] = useState(''),
    [connected, setConnected] = useState(true),
    [install, setInstall] = useState<InstallEvent | null>(null),
    [inviteUrl, setInviteUrl] = useState(''),
    [deleteIds, setDeleteIds] = useState<string[]>([]),
    /** Selected message ids while selecting several, otherwise null. */
    [selection, setSelection] = useState<Set<string> | null>(null),
    [forwarding, setForwarding] = useState<string[] | null>(null),
    [person, setPerson] = useState<Person | null>(null),
    [dropping, setDropping] = useState(false),
    [hits, setHits] = useState<string[] | null>(null),
    [hitIndex, setHitIndex] = useState(0),
    [found, setFound] = useState<{ query: string; messages: SearchHit[]; people: Person[] } | null>(
      null,
    ),
    [jumpTarget, setJumpTarget] = useState<{ chat: string; id: string } | null>(null),
    [searchFilters, setSearchFilters] = useState<SearchFilters>({}),
    /** The sidebar search is open: focused, typed into, or filtered. */
    [searchActive, setSearchActive] = useState(false),
    [themeImport, setThemeImport] = useState<CustomTheme | null>(null),
    [loginRequest, setLoginRequest] = useState(''),
    [scanning, setScanning] = useState(false),
    [scanned, setScanned] = useState(''),
    [working, setWorking] = useState(false),
    [undoDelete, setUndoDelete] = useState<{
      chatId: string;
      ids: string[];
      scope: 'me' | 'all';
    } | null>(null),
    [editsMessage, setEditsMessage] = useState<Message | null>(null);
  const [typing, setTyping] = useTyping();
  const sendTyping = useTypingSender(Boolean(me) && !demo);
  const initialized = useRef(false);
  const sectionRef = useRef(section);
  sectionRef.current = section;
  const activeRef = useRef(activeId),
    chatRequestEpoch = useRef(0),
    joined = useRef(false);
  activeRef.current = activeId;
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const active = chats.find((c) => c.id === activeId);

  const resettersRef = useRef({
    conversation: () => {},
    composer: () => {},
  });
  const report = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) {
      // A revoked/expired session must stop rendering private conversation data.
      ++chatRequestEpoch.current;
      initialized.current = false;
      resettersRef.current.conversation();
      resettersRef.current.composer();
      setMe(null);
      setActiveId(null);
      setChats([]);
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

  const closeMenus = useCallback(() => {
    document
      .querySelectorAll('details.message-menu[open], details.chat-actions[open]')
      .forEach((menu) => closeMenu(menu));
  }, []);

  const conversation = useConversation({
    me,
    activeId,
    active,
    section,
    ready,
    infoOpen,
    groupModalOpen: modal === 'group',
    composerLayoutKey: '',
    chatsRef,
    activeRef,
    sectionRef,
    refreshChats,
    report,
    onError: setError,
    onChatOpened: () => setSelection(null),
  });

  const composer = useComposer({
    me,
    demo,
    activeId,
    active,
    members: conversation.members,
    chatsRef,
    activeRef,
    sectionRef,
    messagesRef: conversation.messagesRef,
    setMessages: conversation.setMessages,
    setNewMessageIds: conversation.setNewMessageIds,
    stickOnSend: conversation.stickOnSend,
    loadMessages: conversation.loadMessages,
    refreshChats,
    sendTyping,
    report,
    onError: setError,
    closeMenus,
  });

  resettersRef.current = {
    conversation: () => conversation.resetConversation(true),
    composer: composer.resetComposer,
  };

  // Stick when following bottom as the composer reply/edit/attachment bar resizes:
  useLayoutEffect(() => {
    const el = conversation.scroller.current;
    if (!el || conversation.awayFromBottom) return;
    const bottom = el.scrollHeight - el.clientHeight;
    if (Math.abs(el.scrollTop - bottom) >= 1) el.scrollTop = bottom;
  }, [composer.layoutKey, conversation.awayFromBottom, conversation.scroller]);

  const handleLogin = useCallback((account: Person) => {
    conversation.syncCacheOwner(account.id);
    composer.loadDraftsFor(account.id);
    setError('');
    setConnected(navigator.onLine);
    setMe(account);
  }, []);

  const notifications = useNotifications(me?.id, demo, (id) => {
    setActiveId(id);
    setSection('chats');
    setSearchOpen(false);
    setMessageQuery('');
  });
  const notificationRef = useRef(notifications);
  notificationRef.current = notifications;

  const gestures = useConversationGestures({
    enabled: Boolean(activeId && !composer.sending && !modal && !composer.edit && !searchOpen),
    chatId: activeId,
    onReply: (id) => {
      const message = conversation.messagesRef.current.find((item) => item.id === id);
      if (message) composer.startReply(message);
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
      void window.galinkaDesktop
        ?.setBadge?.(unreadCount, unreadCount ? badgeImage(unreadCount) : null)
        .catch(() => {});
    }
  }, [unreadCount, demo]);

  useEffect(() => {
    if (!isNative) return;
    const back = NativeApp.addListener('backButton', () => {
      const viewer = document.querySelector('.chat-media dialog:modal');
      if (viewer) viewer.dispatchEvent(new Event('cancel', { cancelable: true }));
      else if (modal) setModal(null);
      else if (selection) setSelection(null);
      else if (composer.emojiOpen) composer.setEmojiOpen(false);
      else if (composer.edit) composer.setEditing(null);
      else if (document.querySelector('details.message-menu[open], details.chat-actions[open]'))
        document
          .querySelectorAll('details.message-menu[open], details.chat-actions[open]')
          .forEach((menu) => closeMenu(menu));
      else if (infoOpen) setInfoOpen(false);
      else if (searchOpen) {
        setSearchOpen(false);
        setMessageQuery('');
      } else if (runBackHandler()) return;
      else if (section !== 'chats') setSection('chats');
      else if (activeId) slideBack(document.querySelector('.workspace'), () => setActiveId(null));
      else void NativeApp.minimizeApp();
    });
    return () => {
      void back.then((handle) => handle.remove());
    };
  }, [
    modal,
    composer.emojiOpen,
    composer.edit,
    infoOpen,
    searchOpen,
    section,
    activeId,
    selection,
  ]);

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
  }, [handleLogin]);

  useEffect(() => {
    const handle = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', handle);
    return () => window.removeEventListener('beforeinstallprompt', handle);
  }, []);

  useEffect(() => {
    if (!me) return;
    let live = true;
    const reportLive = (err: unknown) => {
      if (live) report(err);
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
    return () => {
      live = false;
    };
  }, [me?.id, demo, refreshChats, report]);

  useLiveMessages({
    enabled: Boolean(me) && !demo,
    meId: me?.id,
    refs: {
      active: activeRef,
      section: sectionRef,
      messages: conversation.messagesRef,
      chats: chatsRef,
      cache: conversation.conversationCache,
      requestEpoch: conversation.requestEpoch,
      chatRequestEpoch,
      notification: notificationRef,
    },
    set: {
      messages: conversation.setMessages,
      newMessageIds: conversation.setNewMessageIds,
      replies: composer.setReplies,
      editing: composer.setEditing,
      chats: setChats,
      members: conversation.setMembers,
      activeId: setActiveId,
      infoOpen: setInfoOpen,
      modal: setModal,
      error: setError,
      connected: setConnected,
      typing: setTyping,
    },
    refreshChats,
    loadMessages: conversation.loadMessages,
    markRead: conversation.markRead,
    onDraft: composer.applyRemoteDraft,
    report,
  });

  useEffect(() => {
    if (!undoDelete) return;
    const timer = setTimeout(() => setUndoDelete(null), 5500);
    return () => clearTimeout(timer);
  }, [undoDelete]);

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Element;
      document
        .querySelectorAll('details.message-menu[open], details.chat-actions[open]')
        .forEach((menu) => {
          if (!menu.contains(target)) closeMenu(menu);
        });
      if (!target.closest('.emoji-wrap')) composer.setEmojiOpen(false);
      if (!target.closest('.send-options')) composer.setSendOptions(false);
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
      // A screen opened over another (a settings page) closes first.
      if (runBackHandler()) return;
      if (!composer.editRequest.current) composer.setEditing(null);
      composer.setEmojiOpen(false);
      setInfoOpen(false);
      setSelection(null);
      composer.setSendOptions(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, []);

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
          if (ids[0]) void conversation.showMessage(ids[0]);
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
    void conversation.showMessage(hits[next]);
  }

  // Search in the sidebar: chats, people and messages from every chat, as in Telegram; filters
  // narrow the messages by author, kind and days.
  const searchKey = searchParams(listQuery.trim(), searchFilters);
  useEffect(() => {
    const query = listQuery.trim();
    const filtered = hasFilters(searchFilters);
    if (query.length < 2 && !filtered) {
      setFound(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const options = { signal: controller.signal };
      Promise.all([
        api<SearchHit[]>(`/search?${searchKey}`, 'GET', undefined, options),
        query.length >= 2 && !filtered
          ? api<Person[]>(`/users?q=${encodeURIComponent(query)}`, 'GET', undefined, options)
          : Promise.resolve([]),
      ])
        .then(([messages, people]) => setFound({ query: searchKey, messages, people }))
        .catch((cause) => {
          if (!controller.signal.aborted) report(cause);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchKey]);
  function closeSearch() {
    setListQuery('');
    setSearchFilters({});
    setSearchActive(false);
  }

  // A message picked in search opens once its chat has loaded.
  useEffect(() => {
    if (
      !jumpTarget ||
      conversation.loading ||
      activeId !== jumpTarget.chat ||
      !conversation.messages.some((message) => message.chat_id === jumpTarget.chat)
    )
      return;
    setJumpTarget(null);
    void conversation.showMessage(jumpTarget.id);
  }, [jumpTarget, conversation.loading, activeId, conversation.messages]);

  // Folders: the list slides in from the side of the folder chosen, the underline follows.
  const datePicker = useRef<HTMLInputElement>(null);
  const folderTabs = useTabIndicator(filter);
  const info = usePresence(infoOpen, 260);
  const search = usePresence(searchOpen, 160);
  const lastError = useRef(error);
  if (error) lastError.current = error;
  const errorBar = usePresence(Boolean(error), 160);
  // Phone layout: animate list → chat as a push and chat → list as a pop; tabs switch instantly.
  const shell = useRef<HTMLDivElement>(null);
  const pane = activeId && section === 'chats' ? 'chat' : section;
  const lastPane = useRef(pane);
  useLayoutEffect(() => {
    const el = shell.current;
    if (el && lastPane.current !== pane) {
      if (pane === 'chat') el.dataset.nav = 'push';
      else if (lastPane.current === 'chat' && !el.hasAttribute('data-swipe')) el.dataset.nav = 'pop';
      else delete el.dataset.nav;
    }
    lastPane.current = pane;
  }, [pane]);

  function select(id: string) {
    if (window.innerWidth <= 1080) setInfoOpen(false);
    setActiveId(id);
    setSection('chats');
    setMessageQuery('');
    setSearchOpen(false);
    setError('');
    composer.setEmojiOpen(false);
    composer.setEditing(null);
    setCopiedMessageId(null);
    closeMenus();
  }

  function positionMessageMenu(details: HTMLDetailsElement, point?: { x: number; y: number }) {
    if (!details.open) return;
    setCopiedMessageId(null);
    const menu = details.querySelector<HTMLElement>('.message-menu-content');
    const summary = details.querySelector('summary');
    if (!menu || !summary) return;
    const viewport = window.visualViewport;
    // The menu's real width (its CSS decides it), so it never spills past the screen edge.
    const width = Math.min(menu.offsetWidth || 272, window.innerWidth - 24);
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

  async function copyMessage(message: Message) {
    try {
      await navigator.clipboard.writeText(message.body || message.file?.name || '');
      setCopiedMessageId(message.id);
    } catch {
      setError('Не удалось скопировать. Выделите текст сообщения и скопируйте вручную.');
    }
  }

  async function setChatPreference(
    chat: Chat,
    changes: { pinned?: boolean; muted?: boolean; archived?: boolean; sound?: Chat['sound'] },
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
        composer.setEditing(null);
      }
    } catch (error) {
      report(error);
    } finally {
      setPreferenceBusy(false);
    }
  }

  async function togglePin(message: Message) {
    closeMenus();
    const chat = chatsRef.current.find((item) => item.id === message.chat_id);
    const unpin = chat?.pinned_message?.id === message.id;
    try {
      await api(`/chats/${message.chat_id}/pin`, 'PUT', { messageId: unpin ? null : message.id });
      await refreshChats();
    } catch (error) {
      report(error);
    }
  }

  /** Selected messages in the order they were written. */
  const selectedMessages = selection
    ? conversation.messages.filter((message) => selection.has(message.id))
    : [];

  async function copySelection() {
    try {
      await navigator.clipboard.writeText(
        selectedMessages
          .map((message) => message.body || message.file?.name || '')
          .filter(Boolean)
          .join('\n\n'),
      );
      setSelection(null);
    } catch {
      setError('Не удалось скопировать. Выделите текст сообщения и скопируйте вручную.');
    }
  }

  // The reaction shows at once, as in Telegram; the server hears about it after. If it refuses,
  // the list is read again and the real state replaces the guess.
  async function react(message: Message, emoji: string) {
    conversation.setMessages((previous) =>
      previous.map((item) => {
        if (item.id !== message.id) return item;
        const existing = item.reactions.find((reaction) => reaction.emoji === emoji);
        const reactions = !existing
          ? [...item.reactions, { emoji, count: 1, mine: true }]
          : existing.mine
            ? item.reactions
                .map((reaction) =>
                  reaction.emoji === emoji
                    ? { ...reaction, count: reaction.count - 1, mine: false }
                    : reaction,
                )
                .filter((reaction) => reaction.count > 0)
            : item.reactions.map((reaction) =>
                reaction.emoji === emoji
                  ? { ...reaction, count: reaction.count + 1, mine: true }
                  : reaction,
              );
        return { ...item, reactions };
      }),
    );
    try {
      await api(`/chats/${message.chat_id}/messages/${message.id}/reactions`, 'POST', { emoji });
    } catch (e) {
      report(e);
      await conversation.loadMessages(message.chat_id).catch(() => {});
    }
  }

  async function votePoll(message: Message, optionIndices: number[]) {
    const poll = message.poll;
    if (!poll) return;
    // Counts move at once; the live update then brings the authoritative row with voters.
    const voted = poll.options.some((option) => option.voted),
      votes = optionIndices.length > 0;
    const optimistic = {
      ...poll,
      total_votes: poll.total_votes + Number(votes) - Number(voted),
      options: poll.options.map((option) => {
        const picked = optionIndices.includes(option.index);
        return {
          ...option,
          voted: picked,
          votes: option.votes + Number(picked) - Number(option.voted),
        };
      }),
    };
    conversation.setMessages((previous) =>
      previous.map((item) => (item.id === message.id ? { ...item, poll: optimistic } : item)),
    );
    try {
      await api(`/chats/${message.chat_id}/polls/${poll.id}/vote`, 'POST', { optionIndices });
    } catch (e) {
      report(e);
      await conversation.loadMessages(message.chat_id).catch(() => {});
    }
  }

  async function closePoll(message: Message) {
    if (!message.poll) return;
    try {
      await api(`/chats/${message.chat_id}/polls/${message.poll.id}/close`, 'POST');
      await conversation.loadMessages(message.chat_id);
    } catch (e) {
      report(e);
    }
  }

  async function restoreDeleted() {
    if (!undoDelete) return;
    const snapshot = undoDelete;
    setUndoDelete(null);
    try {
      for (const id of snapshot.ids) {
        await api(`/chats/${snapshot.chatId}/messages/${id}/restore`, 'POST');
      }
      await Promise.all([conversation.loadMessages(snapshot.chatId), refreshChats()]);
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
      composer.clearDraftsFor(me?.id);
      sessionStorage.removeItem('galinka-demo');
      location.href = '/app';
    } catch (e) {
      report(e);
    }
  }

  const unread = chats
    .filter((chat) => !chat.muted && !chat.archived)
    .reduce((n, c) => n + c.unread, 0);

  function messageIds(message: Message) {
    return message.album_id
      ? conversation.messages
          .filter((item) => item.album_id === message.album_id)
          .map((item) => item.id)
      : [message.id];
  }

  const latestMessageActions = useRef<MessageActions>(null!);
  latestMessageActions.current = {
    reply: composer.startReply,
    edit: composer.startEdit,
    copy: copyMessage,
    react,
    download: (file) => void downloadAttachment(file, demo).catch(report),
    menu: positionMessageMenu,
    remove: (message) => {
      setDeleteIds(messageIds(message));
      closeMenus();
      setModal('delete');
    },
    pin: (message) => void togglePin(message),
    forward: (message) => {
      closeMenus();
      setForwarding(messageIds(message));
    },
    select: (message) => {
      closeMenus();
      setSelection((previous) => {
        const next = new Set(previous);
        const ids = messageIds(message);
        const remove = ids.every((id) => next.has(id));
        for (const id of ids) {
          if (remove) next.delete(id);
          else next.add(id);
        }
        return next.size ? next : null;
      });
    },
    profile: (sender) => {
      closeMenus();
      setPerson(sender);
    },
    mention: (username) => {
      const member = conversation.members.find((person) => person.username === username);
      if (member) setPerson(member);
      else openLink(`/app?u=${encodeURIComponent(username)}`);
    },
    retry: composer.retryMessage,
    discard: (message) =>
      conversation.setMessages((previous) => previous.filter((item) => item.id !== message.id)),
    jump: (id) => void conversation.showMessage(id),
    edits: (message) => {
      closeMenus();
      setEditsMessage(message);
    },
    votePoll: (message, optionIndices) => void votePoll(message, optionIndices),
    closePoll: (message) => void closePoll(message),
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
      pin: (message) => latestMessageActions.current.pin(message),
      forward: (message) => latestMessageActions.current.forward(message),
      select: (message) => latestMessageActions.current.select(message),
      edits: (message) => latestMessageActions.current.edits(message),
      votePoll: (message, optionIndices) =>
        latestMessageActions.current.votePoll(message, optionIndices),
      closePoll: (message) => latestMessageActions.current.closePoll(message),
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

  const typingIn = (chat: Chat) => typingText(typing[chat.id], chat.kind === 'group');
  const subtitle = (chat: Chat) => {
    if (chat.kind === 'saved') return 'Заметки и файлы';
    const typingNow = typingIn(chat);
    if (typingNow) return typingNow;
    if (chat.kind === 'direct') return seenText(chat.peer?.seen) || `@${chat.peer?.username || ''}`;
    const total = `${chat.member_count} ${plural(chat.member_count, 'участник', 'участника', 'участников')}`;
    // Others online in the open group, as in Telegram: "5 участников, 2 в сети".
    const online =
      chat.id === activeId
        ? conversation.members.filter((person) => person.id !== me.id && person.seen === 'online')
            .length
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
            onFocus={() => setSearchActive(true)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              closeSearch();
              e.currentTarget.blur();
            }}
          />
          {(listQuery || searchActive) && (
            <button aria-label="Закрыть поиск" onClick={closeSearch}>
              <X size={16} />
            </button>
          )}
        </label>
        {filter !== 'Архив' && !searchActive && !listQuery.trim() && (
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
        {searchActive || listQuery.trim() || hasFilters(searchFilters) ? (
          <SearchResults
            query={listQuery.trim()}
            chats={chats}
            found={found?.query === searchKey ? found : null}
            me={me}
            filters={searchFilters}
            onFilters={setSearchFilters}
            onQuery={setListQuery}
            onChat={(id) => {
              rememberSearch(me.id, listQuery, id);
              select(id);
              closeSearch();
            }}
            onPerson={(person) => {
              rememberSearch(me.id, listQuery);
              setPerson(person);
            }}
            onMessage={(hit) => {
              rememberSearch(me.id, listQuery, hit.chat_id);
              select(hit.chat_id);
              closeSearch();
              setJumpTarget({ chat: hit.chat_id, id: hit.id });
            }}
          />
        ) : (
          <ChatList
            chats={chats}
            filter={filter}
            onFilter={setFilter}
            selectedId={section === 'chats' ? activeId : null}
            meId={me.id}
            drafts={composer.drafts}
            attachmentNames={composer.attachmentNames}
            typingIn={typingIn}
            loaded={initialized.current}
            onSelect={select}
            onNew={() => setModal('new')}
            onAction={(chat, action) => {
              if (action === 'read') {
                void api(`/chats/${chat.id}/read`, 'POST', {
                  lastMessageId: chat.last_message?.id,
                })
                  .then(refreshChats)
                  .catch(report);
                return;
              }
              void setChatPreference(
                chat,
                action === 'pin'
                  ? { pinned: !chat.pinned }
                  : action === 'mute'
                    ? { muted: !chat.muted }
                    : { archived: !chat.archived },
              );
            }}
          />
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
            {selection && (
              <header className="chat-header selection-header" aria-label="Выбранные сообщения">
                <IconButton label="Отменить выбор" onClick={() => setSelection(null)}>
                  <X size={22} />
                </IconButton>
                <strong role="status">
                  {selection.size} {plural(selection.size, 'сообщение', 'сообщения', 'сообщений')}
                </strong>
                <div className="header-actions">
                  <IconButton
                    label="Копировать выбранные"
                    disabled={!selectedMessages.some((message) => message.body || message.file)}
                    onClick={() => void copySelection()}
                  >
                    <Copy size={20} />
                  </IconButton>
                  <IconButton
                    label="Переслать выбранные"
                    onClick={() => setForwarding(selectedMessages.map((message) => message.id))}
                  >
                    <Forward size={20} />
                  </IconButton>
                  <IconButton
                    label="Удалить выбранные"
                    className="danger-icon"
                    onClick={() => {
                      setDeleteIds(selectedMessages.map((message) => message.id));
                      setModal('delete');
                    }}
                  >
                    <Trash2 size={20} />
                  </IconButton>
                </div>
              </header>
            )}
            <header className="chat-header" hidden={Boolean(selection)}>
              <IconButton
                label="Назад к чатам"
                className="mobile-back"
                onClick={() =>
                  slideBack(document.querySelector('.workspace'), () => setActiveId(null))
                }
              >
                <ArrowLeft size={22} />
              </IconButton>
              <button className="chat-heading" onClick={() => setInfoOpen((v) => !v)}>
                <Avatar person={active.peer} chat={active} size="small" />
                <span>
                  <h2>{active.title}</h2>
                  <AnimatedText
                    text={subtitle(active)}
                    scope={active.id}
                    className={
                      typingIn(active)
                        ? 'is-typing'
                        : active.kind === 'direct' && active.peer?.seen === 'online'
                          ? 'is-online'
                          : ''
                    }
                  />
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
                    <button
                      type="button"
                      onClick={() => {
                        closeMenus();
                        setModal('scheduled-list');
                      }}
                    >
                      <CalendarClock size={17} />
                      {active.kind === 'saved' ? 'Напоминания' : 'Отложенные сообщения'}
                    </button>
                    {(active.kind !== 'group' || active.owner_id === me.id) && (
                      <button
                        type="button"
                        onClick={() => {
                          closeMenus();
                          setModal('auto-delete');
                        }}
                      >
                        <Timer size={17} />
                        Автоудаление
                      </button>
                    )}
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
                <IconButton
                  label="Перейти к дате"
                  onClick={() => {
                    const picker = datePicker.current;
                    if (!picker) return;
                    picker.max = new Date().toLocaleDateString('sv');
                    try {
                      picker.showPicker();
                    } catch {
                      picker.click();
                    }
                  }}
                >
                  <CalendarDays size={18} />
                </IconButton>
                <input
                  ref={datePicker}
                  type="date"
                  className="date-jump"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(e) => {
                    if (e.target.value) void conversation.showDate(e.target.value);
                    e.target.value = '';
                  }}
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
            {active.pinned_message && (
              <div className="pinned-bar">
                <button
                  type="button"
                  className="pinned-open"
                  onClick={() => void conversation.showMessage(active.pinned_message!.id)}
                >
                  <Pin size={16} />
                  <span>
                    <strong>Закреплённое сообщение</strong>
                    <span>
                      {plainText(active.pinned_message.body) ||
                        (active.pinned_message.file_name &&
                          fileLabel(
                            active.pinned_message.file_name,
                            active.pinned_message.as_file,
                          )) ||
                        'Сообщение'}
                    </span>
                  </span>
                </button>
                {(active.kind !== 'group' || active.owner_id === me.id) && (
                  <IconButton
                    label="Открепить сообщение"
                    onClick={() =>
                      void togglePin({
                        id: active.pinned_message!.id,
                        chat_id: active.id,
                      } as Message)
                    }
                  >
                    <X size={17} />
                  </IconButton>
                )}
              </div>
            )}
            <MiniPlayer />
            <div className="conversation-layout">
              <section
                className={`conversation ${dropping ? 'dropping' : ''}`}
                aria-label="Переписка"
                // Desktop: drop a file anywhere on the conversation to attach it.
                onDragOver={(event) => {
                  if (
                    !event.dataTransfer.types.includes('Files') ||
                    composer.edit ||
                    composer.sending
                  )
                    return;
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
                  const files = [...event.dataTransfer.files];
                  if (files.length) void composer.attachFiles(files);
                }}
              >
                <div
                  className="messages"
                  ref={conversation.scroller}
                  {...gestures}
                  onWheel={conversation.onWheel}
                  onTouchStart={conversation.onTouchStart}
                  onScroll={conversation.onScroll}
                >
                  {conversation.loading ? (
                    // Placeholder bubbles in the shape of a conversation while it loads.
                    <div className="messages-loading" role="status" aria-label="Загрузка">
                      {skeletonBubbles.map(([own, width], index) => (
                        <span key={index} className={own ? 'own' : ''} style={{ width }} />
                      ))}
                    </div>
                  ) : (
                    <>
                      {conversation.hasOlder && (
                        <button
                          className="older-button"
                          onClick={() => void conversation.loadOlder()}
                          disabled={conversation.paging}
                        >
                          {conversation.paging ? 'Загрузка…' : 'Более ранние сообщения'}
                        </button>
                      )}
                      {!conversation.messages.length && (
                        <div className="conversation-empty">
                          <p>Сообщений пока нет</p>
                        </div>
                      )}
                      <MessageList
                        key={active.id}
                        messages={conversation.messages}
                        meId={me.id}
                        meUsername={me.username}
                        kind={active.kind}
                        moderator={active.kind === 'group' && active.owner_id === me.id}
                        unreadFrom={conversation.unreadFrom}
                        pinnedId={active.pinned_message?.id}
                        canPin={active.kind !== 'group' || active.owner_id === me.id}
                        selection={selection}
                        newMessageIds={conversation.newMessageIds}
                        copiedId={copiedMessageId}
                        sending={composer.sending}
                        savingEdit={composer.savingEdit}
                        awayFromBottom={conversation.awayFromBottom}
                        actions={messageActions}
                        highlight={
                          searchOpen && messageQuery.trim().length >= 2 ? messageQuery : undefined
                        }
                      />
                      <div ref={conversation.bottomRef} />
                    </>
                  )}
                </div>
                <Composer
                  active={active}
                  meId={me.id}
                  messages={conversation.messages}
                  awayFromBottom={conversation.awayFromBottom}
                  onJumpToLatest={
                    conversation.returnTo ? conversation.goBack : conversation.jumpToLatest
                  }
                  canReturn={Boolean(conversation.returnTo)}
                  onJumpToMention={() => void conversation.jumpToMention()}
                  onTyping={(action) => sendTyping(active.id, action)}
                  onError={setError}
                  onOpenPoll={() => setModal('poll')}
                  onOpenSchedule={() => setModal('schedule')}
                  onOpenScheduledList={() => setModal('scheduled-list')}
                  composer={composer}
                />
              </section>
              {info.mounted && (
                <ChatInfo
                  chat={active}
                  meId={me.id}
                  members={conversation.members}
                  subtitle={subtitle(active)}
                  closing={info.closing}
                  muteBusy={preferenceBusy}
                  nelyaBusy={working}
                  onClose={() => setInfoOpen(false)}
                  onMute={() => void setChatPreference(active, { muted: !active.muted })}
                  onSound={(sound) => void setChatPreference(active, { sound })}
                  onSearch={() => {
                    if (window.innerWidth <= 1180) setInfoOpen(false);
                    setSearchOpen(true);
                  }}
                  onDownload={messageActions.download}
                  onOpenMessage={(id) => {
                    if (window.innerWidth <= 1180) setInfoOpen(false);
                    void conversation.showMessage(id);
                  }}
                  onInvite={invite}
                  onManage={() => setModal('group')}
                  onPerson={setPerson}
                  onNelya={() => toggleNelya(active)}
                />
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
            hasDraft={composer.hasPendingWork}
            onInstall={installedApp() ? undefined : () => setModal('install')}
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
      {forwarding && (
        <ForwardDialog
          chats={chats}
          messageIds={forwarding}
          onClose={() => setForwarding(null)}
          onDone={async (id) => {
            setForwarding(null);
            setSelection(null);
            await refreshChats();
            if (id === activeRef.current) await conversation.loadMessages(id);
            else select(id);
          }}
        />
      )}
      {modal === 'group' && active?.kind === 'group' && (
        <GroupSettings
          chat={active}
          me={me}
          members={conversation.members}
          onClose={() => setModal(null)}
          onOpenPerson={setPerson}
          onUpdated={conversation.refreshMembers}
          onLeft={async () => {
            setModal(null);
            setActiveId(null);
            conversation.resetConversation();
            setInfoOpen(false);
            composer.setEditing(null);
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
          onUpdated={conversation.refreshMembers}
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
      {modal === 'invite' && inviteUrl && (
        <ShareSheet
          heading="Пригласить в группу"
          title={active?.title || 'Группа'}
          subtitle="Ссылка-приглашение действует 7 дней"
          link={inviteUrl}
          accent={currentAccent()}
          face={{ photo: active?.avatar, tone: 2 }}
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
      {modal === 'delete' && activeId && (
        <DeleteMessages
          chatId={activeId}
          ids={deleteIds}
          canDeleteForAll={deleteIds.every((id) => {
            const msg = conversation.messages.find((item) => item.id === id);
            return (
              Boolean(msg) &&
              (msg!.sender_id === me.id || (active?.kind === 'group' && active?.owner_id === me.id))
            );
          })}
          error={error}
          report={report}
          onClose={() => setModal(null)}
          onDeleted={(removed, scope) => {
            setSelection(null);
            conversation.setMessages((previous) => previous.filter((m) => !removed.includes(m.id)));
            setUndoDelete({ chatId: activeId, ids: removed, scope });
            refreshChats().catch(report);
          }}
        />
      )}
      {modal === 'schedule' && active && (
        <ScheduleMessageModal
          chat={active}
          initialBody={composer.draft}
          onClose={() => setModal(null)}
          onSchedule={(whenIso, body) => composer.scheduleMessage(whenIso, body)}
        />
      )}
      {modal === 'scheduled-list' && active && (
        <ScheduledListModal
          chat={active}
          onClose={() => setModal(null)}
          onChanged={() => {
            void conversation.loadMessages(active.id);
            void refreshChats();
          }}
          report={report}
        />
      )}
      {modal === 'poll' && activeId && (
        <PollCreatorModal
          chatId={activeId}
          onClose={() => setModal(null)}
          onCreated={async () => {
            await Promise.all([conversation.loadMessages(activeId), refreshChats()]);
          }}
          report={report}
        />
      )}
      {modal === 'auto-delete' && active && (
        <AutoDeleteModal
          chat={active}
          onClose={() => setModal(null)}
          onSelect={async (seconds) => {
            await api(`/chats/${active.id}`, 'PATCH', { autoDeleteSeconds: seconds });
            await refreshChats();
          }}
        />
      )}
      {editsMessage && (
        <EditHistoryModal
          message={editsMessage}
          onClose={() => setEditsMessage(null)}
          report={report}
        />
      )}
      {undoDelete && (
        <div className="undo-toast" role="status" aria-live="polite">
          <span>
            {undoDelete.ids.length > 1
              ? `Удалено ${undoDelete.ids.length} ${plural(undoDelete.ids.length, 'сообщение', 'сообщения', 'сообщений')}`
              : undoDelete.scope === 'all'
                ? 'Сообщение удалено у всех'
                : 'Сообщение удалено у вас'}
          </span>
          <button type="button" className="undo-toast-btn" onClick={() => void restoreDeleted()}>
            <Undo2 size={15} />
            Отменить
          </button>
          <button
            type="button"
            className="undo-toast-close"
            aria-label="Закрыть"
            onClick={() => setUndoDelete(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
