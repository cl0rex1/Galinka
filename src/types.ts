export type Person = {
  id: string;
  name: string;
  username: string;
  color: number;
  role?: 'admin' | 'user';
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
export type Attachment = { id: string; name: string; size: number; mime?: string };
export type Message = {
  id: string;
  chat_id: string;
  sender_id: string | null;
  sender: Person;
  body: string;
  created_at: string;
  edited_at?: string | null;
  reply?: {
    id: string;
    body: string;
    sender: { id: string; name: string };
    file_name?: string | null;
  } | null;
  read_by?: number;
  nonce: string;
  file: Attachment | null;
  reactions: { emoji: string; count: number; mine: boolean }[];
};
export type Chat = {
  id: string;
  kind: 'direct' | 'group' | 'saved';
  title: string;
  owner_id: string;
  nelya: boolean;
  pinned?: boolean;
  muted?: boolean;
  archived?: boolean;
  member_count: number;
  peer: Person | null;
  unread: number;
  created_at: string;
  last_message: {
    body: string;
    created_at: string;
    sender_id: string | null;
    file_id?: string;
  } | null;
};
