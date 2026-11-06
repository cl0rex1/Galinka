import { Bookmark, Users } from 'lucide-react';
import { API_BASE, isDemo } from './api';
import { getDemoFileUrl } from './demo';
import type { Person, Chat } from './types';

const time = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' });
const day = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' });
/** "в сети", "был(а) в 14:32", "был(а) вчера в 14:32", "был(а) 3 нояб.", "был(а) недавно". */
export function seenText(seen?: string | null) {
  if (!seen) return '';
  if (seen === 'online') return 'в сети';
  if (seen === 'recently') return 'был(а) недавно';
  const date = new Date(seen);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400_000);
  if (Date.now() - date.getTime() < 60_000) return 'был(а) только что';
  if (date.toDateString() === today.toDateString()) return `был(а) в ${time.format(date)}`;
  if (date.toDateString() === yesterday.toDateString())
    return `был(а) вчера в ${time.format(date)}`;
  return `был(а) ${day.format(date)}`;
}
export const avatarUrl = (id: string) =>
  isDemo() ? getDemoFileUrl(id) || '' : `${API_BASE}/avatars/${encodeURIComponent(id)}`;

export function Avatar({
  person,
  chat,
  size = 'normal',
}: {
  person?: Person | null;
  chat?: Chat;
  size?: 'small' | 'normal' | 'large';
}) {
  const photo =
    chat?.kind === 'group' ? chat.avatar : chat?.kind === 'saved' ? null : person?.avatar;
  const online = chat?.kind !== 'group' && chat?.kind !== 'saved' && person?.seen === 'online';
  return (
    <span
      className={`avatar ${size} tone-${chat?.kind === 'saved' ? 0 : (person?.color ?? (chat?.id === 'weekend' ? 0 : 2)) % 6} ${chat?.kind === 'group' ? 'group-avatar' : ''} ${online ? 'online' : ''}`}
      aria-hidden="true"
    >
      {photo ? (
        <img src={avatarUrl(photo)} alt="" loading="lazy" draggable={false} />
      ) : chat?.kind === 'saved' ? (
        <Bookmark size={size === 'large' ? 28 : 20} />
      ) : chat?.kind === 'group' ? (
        <Users size={size === 'large' ? 30 : 22} />
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
