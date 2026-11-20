import { useState } from 'react';
import { AtSign, Check, Info } from 'lucide-react';
import type { Person } from './types';

/**
 * What someone says about themselves and their login, under their profile header, as in
 * Telegram: each line with its label; a tap on the login copies it.
 */
export function ProfileDetails({ person }: { person: Person }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="profile-details">
      {person.bio && (
        <div className="profile-detail">
          <Info size={19} aria-hidden="true" />
          <span>
            <span className="profile-detail-value">{person.bio}</span>
            <small>О себе</small>
          </span>
        </div>
      )}
      <button
        type="button"
        className="profile-detail"
        aria-label={`Скопировать логин @${person.username}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(`@${person.username}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          } catch {
            /* The login stays on screen to copy by hand. */
          }
        }}
      >
        <AtSign size={19} aria-hidden="true" />
        <span>
          <span className="profile-detail-value">@{person.username}</span>
          <small role="status">{copied ? 'Скопировано' : 'Логин'}</small>
        </span>
        {copied && <Check size={18} className="profile-detail-done" aria-hidden="true" />}
      </button>
    </div>
  );
}
