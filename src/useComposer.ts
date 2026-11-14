import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { api, ApiError, upload } from './api';
import { compressImage } from './image';
import type { Transfer } from './AttachmentPreview';
import type { Attachment, Chat, LinkPreview, Message, Person } from './types';
import type { TypingAction } from './useSync';

function extractComposerUrl(text: string): string | null {
  const m = text.replace(/\[(?:sticker|gif):[^\]]+\]/g, ' ').match(/https?:\/\/[^\s<>"'`]+/i);
  if (!m) return null;
  try {
    const u = new URL(m[0].replace(/[.,!?;:)'"]+$/, ''));
    return ['http:', 'https:'].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

function isTikTokLink(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host === 'tiktok.com' || host.endsWith('.tiktok.com');
  } catch {
    return false;
  }
}

type ComposerOptions = {
  me: Person | null;
  demo: boolean;
  activeId: string | null;
  active: Chat | undefined;
  members: Person[];
  chatsRef: MutableRefObject<Chat[]>;
  activeRef: MutableRefObject<string | null>;
  sectionRef: MutableRefObject<string>;
  messagesRef: MutableRefObject<Message[]>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setNewMessageIds: Dispatch<SetStateAction<string[]>>;
  stickOnSend: (chatId: string) => void;
  loadMessages: (id: string, reset?: boolean) => Promise<unknown>;
  refreshChats: () => Promise<Chat[]>;
  sendTyping: (chatId: string, action?: TypingAction) => void;
  report: (error: unknown) => void;
  onError: (message: string) => void;
  closeMenus: () => void;
};

/** Owns drafts, replies, edits, attachments, mentions and optimistic message sending. */
export function useComposer({
  me,
  demo,
  activeId,
  active,
  members,
  chatsRef,
  activeRef,
  sectionRef,
  messagesRef,
  setMessages,
  setNewMessageIds,
  stickOnSend,
  loadMessages,
  refreshChats,
  sendTyping,
  report,
  onError,
  closeMenus,
}: ComposerOptions) {
  const [drafts, setDrafts] = useState<Record<string, string>>({}),
    [replies, setReplies] = useState<Record<string, Message>>({}),
    [editing, setEditing] = useState<{ message: Message; body: string } | null>(null),
    [savingEdit, setSavingEdit] = useState(false),
    [sendingIds, setSendingIds] = useState<string[]>([]),
    [transfers, setTransfers] = useState<Record<string, Transfer>>({}),
    [attachments, setAttachments] = useState<
      Record<string, { file: File; source?: File; uploaded?: Attachment }>
    >({}),
    [mentionCursor, setMentionCursor] = useState<number | null>(null),
    [mentionIndex, setMentionIndex] = useState(0),
    [emojiOpen, setEmojiOpen] = useState(false),
    [sendOptions, setSendOptions] = useState(false),
    [linkPreview, setLinkPreview] = useState<LinkPreview | null>(null),
    [dismissedPreviewUrl, setDismissedPreviewUrl] = useState<string | null>(null),
    [dismissedTikTok, setDismissedTikTok] = useState<Record<string, boolean>>({}),
    [downloadingTikTok, setDownloadingTikTok] = useState(false);

  const draftSnapshot = useRef<{ id: string; drafts: Record<string, string> } | null>(null);
  if (me) draftSnapshot.current = { id: me.id, drafts };
  /** What the server holds for each chat, as far as this device knows. */
  const lastSyncedDrafts = useRef<Record<string, string>>({});
  const pendingDraft = useRef<{
    chatId: string;
    value: string;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  const textarea = useRef<HTMLTextAreaElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    nonces = useRef<Record<string, string>>({}),
    sendingChats = useRef(new Set<string>()),
    textQueue = useRef<Record<string, Promise<unknown>>>({}),
    editRequest = useRef(false);

  const draft = activeId ? drafts[activeId] || '' : '',
    attachment = activeId ? attachments[activeId]?.file : undefined,
    attachmentSource = activeId ? attachments[activeId]?.source : undefined,
    transfer = activeId ? transfers[activeId] : undefined,
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
  const selectedMention = mentionOptions[mentionIndex % mentionOptions.length];

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

  useLayoutEffect(() => {
    setMentionCursor(null);
  }, [activeId]);

  useEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = 'auto';
    textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 160)}px`;
  }, [composerValue]);

  function loadDraftsFor(personId: string) {
    let saved: Record<string, string> = {};
    try {
      const value = JSON.parse(localStorage.getItem(`galinka-drafts:${personId}`) || '{}');
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
    setDrafts(saved);
  }

  function clearDraftsFor(personId?: string) {
    draftSnapshot.current = null;
    try {
      if (personId) localStorage.removeItem(`galinka-drafts:${personId}`);
    } catch {
      /* Storage may be unavailable. */
    }
  }

  function resetComposer() {
    nonces.current = {};
    lastSyncedDrafts.current = {};
    setAttachments({});
    setTransfers({});
    setDrafts({});
    setReplies({});
    setEditing(null);
    setEmojiOpen(false);
    setSendOptions(false);
    setLinkPreview(null);
    setDismissedPreviewUrl(null);
  }

  /** Saves a chat's draft on the server now, replacing a pending debounced save for it. */
  const pushDraft = useCallback((chatId: string, value: string) => {
    const pending = pendingDraft.current;
    if (pending?.chatId === chatId) {
      clearTimeout(pending.timer);
      pendingDraft.current = null;
    }
    if ((lastSyncedDrafts.current[chatId] ?? '') === value) return;
    lastSyncedDrafts.current[chatId] = value;
    void api(`/chats/${chatId}/draft`, 'PUT', { draft: value }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeId || active?.draft === undefined) return;
    if (pendingDraft.current?.chatId !== activeId)
      lastSyncedDrafts.current[activeId] = active.draft;
    setDrafts((prev) =>
      !prev[activeId] && active.draft ? { ...prev, [activeId]: active.draft! } : prev,
    );
  }, [activeId, active?.draft]);

  useEffect(() => {
    const pending = pendingDraft.current;
    // Leaving a chat saves its draft at once instead of dropping the debounced save.
    if (pending && pending.chatId !== activeId) pushDraft(pending.chatId, pending.value);
    else if (pending) {
      clearTimeout(pending.timer);
      pendingDraft.current = null;
    }
    if (!me || !activeId || (lastSyncedDrafts.current[activeId] ?? '') === draft) return;
    const chatId = activeId,
      value = draft;
    pendingDraft.current = { chatId, value, timer: setTimeout(() => pushDraft(chatId, value), 600) };
  }, [draft, activeId, me?.id, pushDraft]);

  useEffect(() => {
    const flush = () => {
      const pending = pendingDraft.current;
      if (pending) pushDraft(pending.chatId, pending.value);
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [pushDraft]);

  const detectedUrl = !edit && !attachment ? extractComposerUrl(draft) : null;
  const tiktokUrl =
    detectedUrl && isTikTokLink(detectedUrl) && !dismissedTikTok[detectedUrl]
      ? detectedUrl
      : null;

  useEffect(() => {
    if (!detectedUrl || tiktokUrl || dismissedPreviewUrl === detectedUrl) {
      setLinkPreview(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      api<{ preview: LinkPreview | null }>(`/link-preview?url=${encodeURIComponent(detectedUrl)}`)
        .then((res) => {
          if (live) setLinkPreview(res.preview);
        })
        .catch(() => {
          if (live) setLinkPreview(null);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [detectedUrl, tiktokUrl, dismissedPreviewUrl]);

  const applyRemoteDraft = useCallback((chatId: string, remoteDraft: string) => {
    if (lastSyncedDrafts.current[chatId] === remoteDraft) return;
    lastSyncedDrafts.current[chatId] = remoteDraft;
    setDrafts((prev) => ({ ...prev, [chatId]: remoteDraft }));
  }, []);

  function changeDraft(value: string) {
    if (edit) {
      setEditing((previous) => (previous ? { ...previous, body: value } : null));
      return;
    }
    if (!activeId) return;
    setDrafts((prev) => ({ ...prev, [activeId]: value }));
    delete nonces.current[activeId];
    if (value.trim() && active?.kind !== 'saved') sendTyping(activeId);
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
    onError('');
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

  async function attachFile(source: File, original = false) {
    const id = activeId;
    if (!id || edit || sending) return;
    const file = original ? source : await compressImage(source);
    if (file.size > 20 * 1024 * 1024) {
      onError('Файл больше 20 МБ.');
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

  function removeAttachment() {
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
  }

  function cancelContext() {
    if (edit) setEditing(null);
    else if (activeId) {
      setReplies((previous) => {
        const next = { ...previous };
        delete next[activeId];
        return next;
      });
      delete nonces.current[activeId];
    }
  }

  /**
   * Text goes out optimistically, as in Telegram: the bubble appears at once, the field clears and
   * stays usable, and sends in one chat queue up so they arrive in order. The server's copy
   * replaces the bubble by its nonce; a failed one stays with a retry button.
   */
  /** `special`: a sticker or GIF sent from the picker; the typed draft stays as it is. */
  function sendText(
    id: string,
    text: string,
    replyTo?: Message,
    nonce?: string,
    silent = false,
    special = false,
  ) {
    const messageNonce = nonce ?? (special ? undefined : nonces.current[id]) ?? crypto.randomUUID();
    if (!special) delete nonces.current[id];
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
      silent,
    };
    if (activeRef.current === id) {
      stickOnSend(id);
      setNewMessageIds([local.id]);
      setMessages((previous) => [
        ...previous.filter((message) => message.nonce !== messageNonce),
        local,
      ]);
    }
    const skipPreview =
      !special && Boolean(detectedUrl && dismissedPreviewUrl === detectedUrl);
    if (!nonce) {
      if (!special) {
        pushDraft(id, '');
        setDrafts((previous) => ({ ...previous, [id]: '' }));
        setDismissedPreviewUrl(null);
        setLinkPreview(null);
      }
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
        silent: silent || undefined,
        skipPreview: skipPreview || undefined,
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

  async function send(e?: FormEvent, silent = false) {
    e?.preventDefault();
    if (edit) {
      await saveEdit();
      return;
    }
    if (!activeId || (!draft.trim() && !attachment)) return;
    if (!attachment) {
      sendText(activeId, draft.trim(), replies[activeId], undefined, silent);
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
    onError('');
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
      const skipPreview = Boolean(detectedUrl && dismissedPreviewUrl === detectedUrl);
      setTransfers((previous) => ({ ...previous, [id]: { phase: 'sending', progress: 100 } }));
      await api(`/chats/${id}/messages`, 'POST', {
        body: text,
        nonce: messageNonce,
        fileId: file?.id,
        demoFile: demo ? file : undefined,
        replyTo: replyDraft?.id,
        silent: silent || undefined,
        skipPreview: skipPreview || undefined,
      });
      delivered = true;
      setDismissedPreviewUrl(null);
      setLinkPreview(null);
      setTransfers((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
      setDrafts((prev) => (prev[id] === originalDraft ? { ...prev, [id]: '' } : prev));
      pushDraft(id, '');
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
      stickOnSend(id);
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
      onError(
        delivered
          ? 'Сообщение отправлено. Переписка обновится после восстановления соединения.'
          : `${activeRef.current === id ? '' : `Чат «${chatsRef.current.find((chat) => chat.id === id)?.title || 'Переписка'}»: `}${(e as Error).message}`,
      );
    } finally {
      sendingChats.current.delete(id);
      setSendingIds([...sendingChats.current]);
    }
  }

  function retryMessage(message: Message) {
    setMessages((previous) =>
      previous.map((item) => (item.id === message.id ? { ...item, failed: false } : item)),
    );
    const original = message.reply
      ? messagesRef.current.find((item) => item.id === message.reply!.id)
      : undefined;
    sendText(message.chat_id, message.body, original, message.nonce, message.silent);
  }

  function dismissTikTok() {
    if (tiktokUrl) setDismissedTikTok((prev) => ({ ...prev, [tiktokUrl]: true }));
  }

  async function downloadTikTok() {
    if (!activeId || !tiktokUrl || downloadingTikTok) return;
    const id = activeId,
      targetUrl = tiktokUrl,
      replyDraft = replies[id],
      // The link as typed, which may differ from its normalized form.
      caption = draft.replace(/https?:\/\/\S*tiktok\.com\S*/gi, '').trim() || undefined;
    setDownloadingTikTok(true);
    onError('');
    try {
      // The server tries several sources and may fetch up to 50 MB.
      await api(
        `/chats/${id}/tiktok`,
        'POST',
        { url: targetUrl, caption, replyTo: replyDraft?.id },
        { timeoutMs: 150_000 },
      );
      pushDraft(id, '');
      setDrafts((prev) => ({ ...prev, [id]: '' }));
      setReplies((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      stickOnSend(id);
      await Promise.all([loadMessages(id), refreshChats()]);
    } catch (err) {
      report(err);
    } finally {
      setDownloadingTikTok(false);
    }
  }

  async function scheduleMessage(scheduledFor: string, bodyText: string, silent = false) {
    if (!activeId) return;
    const id = activeId;
    await api(`/chats/${id}/scheduled`, 'POST', {
      body: bodyText,
      replyTo: replies[id]?.id,
      silent: silent || undefined,
      isReminder: active?.kind === 'saved',
      scheduledFor,
    });
    if (bodyText === draft.trim()) {
      pushDraft(id, '');
      setDrafts((prev) => ({ ...prev, [id]: '' }));
    }
    setReplies((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    await refreshChats();
  }

  function sendSpecial(bodyText: string) {
    if (!activeId) return;
    sendText(activeId, bodyText, replies[activeId], undefined, false, true);
    setEmojiOpen(false);
  }

  return {
    drafts,
    draft,
    attachment,
    attachmentSource,
    transfer,
    sending,
    sendingIds,
    reply,
    edit,
    editing,
    setEditing,
    setReplies,
    savingEdit,
    savingCurrentEdit,
    composerValue,
    mentionOptions,
    mentionIndex,
    setMentionIndex,
    setMentionCursor,
    selectedMention,
    emojiOpen,
    setEmojiOpen,
    sendOptions,
    setSendOptions,
    linkPreview,
    dismissPreview: () => detectedUrl && setDismissedPreviewUrl(detectedUrl),
    tiktokUrl,
    dismissTikTok,
    downloadTikTok,
    downloadingTikTok,
    scheduledCount: active?.scheduled_count ?? 0,
    scheduleMessage,
    sendSpecial,
    applyRemoteDraft,
    textarea,
    fileInput,
    editRequest,
    hasPendingWork:
      Object.keys(attachments).length > 0 || Boolean(editing) || sendingIds.length > 0,
    attachmentNames: Object.fromEntries(
      Object.entries(attachments).map(([id, item]) => [id, item.file.name]),
    ),
    layoutKey: `${reply?.id ?? ''}:${edit?.message.id ?? ''}:${attachment ? '1' : '0'}:${linkPreview ? '1' : '0'}:${tiktokUrl ? '1' : '0'}`,
    loadDraftsFor,
    clearDraftsFor,
    resetComposer,
    changeDraft,
    chooseMention,
    startReply,
    startEdit,
    attachFile,
    removeAttachment,
    cancelContext,
    send,
    retryMessage,
  };
}

export type ComposerState = ReturnType<typeof useComposer>;
