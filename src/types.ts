export type Person = {
  id: string;
  name: string;
  username: string;
  color: number;
  role?: 'admin' | 'user';
  /** Profile photo id, served from /avatars/:id. */
  avatar?: string | null;
  /** A line about themselves, up to 140 characters. */
  bio?: string;
  /** 'online', 'recently', an ISO time of the last visit, or null when unknown. */
  seen?: string | null;
};
export type AdminUser = Person & { role: 'admin' | 'user'; blocked: boolean; created_at: string };
export type Announcement = {
  id: string;
  title: string;
  body: string;
  published: boolean;
  author_id: string;
  created_at: string;
  updated_at: string;
};
export type Page<T> = { items: T[]; total: number; page: number };
export type Attachment = {
  id: string;
  name: string;
  size: number;
  mime?: string;
  as_file?: boolean;
  /** Photos and videos: size and a tiny blurred preview, so the feed does not jump. */
  width?: number | null;
  height?: number | null;
  thumb?: string | null;
  /** Voice messages: 48 loudness bars, 0..31. */
  waveform?: number[] | null;
};
export type LinkPreview = {
  url: string;
  site: string;
  title: string;
  description?: string;
  image?: string;
  provider?: 'youtube' | 'spotify' | 'tiktok' | 'web';
  embed_url?: string;
  vertical?: boolean;
  thumbnail?: boolean;
};
export type PollOption = {
  index: number;
  text: string;
  votes: number;
  voted: boolean;
  voters?: { id: string; name: string; avatar?: string | null; color: number }[];
};
export type Poll = {
  id: string;
  question: string;
  multiple: boolean;
  anonymous: boolean;
  closed: boolean;
  total_votes: number;
  options: PollOption[];
};
export type MessageEdit = {
  id: string;
  previous_body: string;
  edited_at: string;
};
export type MessageDetails = {
  readers: (Person & { read_at: string })[];
  reactions: { emoji: string; users: Person[] }[];
};
export type ScheduledMessage = {
  id: string;
  chat_id: string;
  body: string;
  file_id?: string | null;
  file_name?: string | null;
  silent: boolean;
  is_reminder: boolean;
  scheduled_for: string;
  created_at: string;
};
export type Message = {
  id: string;
  /** The group owner's @все: it mentions every member. */
  mention_all?: boolean;
  chat_id: string;
  sender_id: string | null;
  sender: Person;
  body: string;
  /** Photos and videos sent together share an album id and are drawn as one grid. */
  album_id?: string | null;
  created_at: string;
  edited_at?: string | null;
  expires_at?: string | null;
  link_preview?: LinkPreview | null;
  poll?: Poll | null;
  reply?: {
    id: string;
    body: string;
    sender: { id: string; name: string };
    file_name?: string | null;
    as_file?: boolean | null;
  } | null;
  read_by?: number;
  /** Name of the original author when the message was forwarded. */
  forwarded_from?: string | null;
  nonce: string;
  file: Attachment | null;
  reactions: { emoji: string; count: number; mine: boolean }[];
  /** Shown before the server confirms it (optimistic send); `failed` when it did not go. */
  pending?: boolean;
  failed?: boolean;
  /** Sent without a notification (kept on the local copy for a retry). */
  silent?: boolean;
};
export type Chat = {
  id: string;
  kind: 'direct' | 'group' | 'saved';
  title: string;
  avatar?: string | null;
  owner_id: string;
  nelya: boolean;
  pinned?: boolean;
  muted?: boolean;
  /** Notification sound for this chat; 'silent' notifies without one. */
  sound?: 'default' | 'soft' | 'bright' | 'silent';
  archived?: boolean;
  auto_delete_seconds?: number | null;
  /** Own scheduled messages and reminders waiting in this chat. */
  scheduled_count?: number;
  draft?: string;
  draft_updated_at?: string | null;
  member_count: number;
  peer: Person | null;
  unread: number;
  /** Unread messages in this group that name you with @. */
  unread_mentions?: number;
  created_at: string;
  pinned_message?: {
    id: string;
    body: string;
    file_name?: string | null;
    as_file?: boolean | null;
  } | null;
  last_message: {
    /** Missing from servers older than 0.16. */
    id?: string;
    body: string;
    created_at: string;
    sender_id: string | null;
    file_id?: string;
    file?: Attachment | null;
  } | null;
};
/** A message found by the search across all chats. */
export type SearchHit = {
  id: string;
  chat_id: string;
  body: string;
  created_at: string;
  sender_id: string | null;
  sender_name: string;
  file?: Attachment | null;
};
export type ClientErrorEntry = {
  id: string;
  user_id: string | null;
  username: string | null;
  user_name: string | null;
  message: string;
  stack: string;
  url: string;
  user_agent: string;
  release: string;
  created_at: string;
};
export type MonitoringData = {
  health: {
    ok: boolean;
    listening: boolean;
    startedAt: string;
    uptimeSeconds: number;
    memoryBytes: number;
    version: string;
    build: string;
  };
  metrics: {
    requests: { total: number; ok: number; clientError: number; serverError: number };
    activeStreams: number;
    onlineUsers: number;
    users: number;
    chats: number;
    messages: number;
    files: number;
    storageBytes: number;
    pushQueue: number;
    clientErrors: number;
  };
  errors: ClientErrorEntry[];
};
