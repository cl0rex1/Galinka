import { Bookmark, Users } from 'lucide-react';
import type { Person, Chat } from './types';

export function Avatar({
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
      className={`avatar ${size} tone-${chat?.kind === 'saved' ? 0 : (person?.color ?? (chat?.id === 'weekend' ? 0 : 2)) % 6} ${chat?.kind === 'group' ? 'group-avatar' : ''}`}
      aria-hidden="true"
    >
      {chat?.kind === 'saved' ? (
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
