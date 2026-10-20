export type Person = { id: string; name: string; username: string; color: number };
export type Attachment = { id: string; name: string; size: number };
export type Message = {
  id: string;
  chat_id: string;
  sender_id: string | null;
  sender: Person;
  body: string;
  created_at: string;
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
