import { useState } from 'react';
import { Crown, LoaderCircle, MessageCircle, QrCode, UserMinus } from 'lucide-react';
import { currentAccent, profileLink, ShareSheet } from './Share';
import { api } from './api';
import { ProfileDetails } from './ProfileDetails';
import { ProfileHero } from './ProfileHero';
import { seenText } from './Avatar';
import { Confirm, Modal } from './ui';
import type { Chat, Person } from './types';

/**
 * Someone's profile, opened from a member list or a message avatar. In a group the owner can
 * also hand the group over or remove the person here; both ask once more in a small dialog.
 */
export function PersonCard({
  person,
  me,
  chat,
  onMessage,
  onUpdated,
  onClose,
}: {
  person: Person;
  me: Person;
  chat?: Chat;
  onMessage: () => Promise<void>;
  onUpdated: () => Promise<void>;
  onClose: () => void;
}) {
  const [confirm, setConfirm] = useState<'transfer' | 'remove' | null>(null);
  const [sharing, setSharing] = useState(false);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const self = person.id === me.id;
  const group = chat?.kind === 'group' ? chat : undefined;
  const manage = Boolean(group && group.owner_id === me.id && !self);
  return (
    <Modal title="Профиль" onClose={onClose} error={error} open={open} closeDisabled={busy}>
      <ProfileHero
        person={person}
        title={person.name}
        subtitle={[`@${person.username}`, person.id === me.id ? '' : seenText(person.seen)]
          .filter(Boolean)
          .join(' · ')}
      >
        {group?.owner_id === person.id && (
          <span className="person-role">
            <Crown size={14} />
            Владелец группы
          </span>
        )}
      </ProfileHero>
      {/* Quick actions under the photo, the same tiles as in a chat's profile. */}
      <div className="hero-tiles person-tiles">
        {!self && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await onMessage();
              } catch (cause) {
                setError((cause as Error).message);
                setBusy(false);
              }
            }}
          >
            {busy ? <LoaderCircle className="spin" size={20} /> : <MessageCircle size={20} />}
            Написать
          </button>
        )}
        <button type="button" onClick={() => setSharing(true)} aria-label="Поделиться контактом">
          <QrCode size={20} />
          Поделиться
        </button>
      </div>
      <ProfileDetails person={person} />
      <div className="person-actions">
        {manage && (
          <div className="action-list">
            <button type="button" onClick={() => setConfirm('transfer')}>
              <Crown size={18} />
              Сделать владельцем
            </button>
            <button type="button" className="danger-text" onClick={() => setConfirm('remove')}>
              <UserMinus size={18} />
              Удалить из группы
            </button>
          </div>
        )}
      </div>
      {sharing && (
        <ShareSheet
          heading="Контакт"
          title={person.name}
          subtitle={`@${person.username}`}
          link={profileLink(person.username)}
          accent={currentAccent()}
          face={{ photo: person.avatar, tone: person.color }}
          onClose={() => setSharing(false)}
        />
      )}
      {confirm && group && (
        <Confirm
          title={confirm === 'transfer' ? 'Передать группу?' : 'Удалить из группы?'}
          text={
            confirm === 'transfer'
              ? `Владельцем «${group.title}» станет ${person.name}. Вы останетесь участником без прав управления.`
              : `${person.name} больше не увидит переписку «${group.title}». Вернуть можно по приглашению.`
          }
          action={confirm === 'transfer' ? 'Передать' : 'Удалить'}
          onConfirm={async () => {
            await api(
              confirm === 'transfer'
                ? `/chats/${group.id}`
                : `/chats/${group.id}/members/${person.id}`,
              confirm === 'transfer' ? 'PATCH' : 'DELETE',
              confirm === 'transfer' ? { ownerId: person.id } : undefined,
            );
            await onUpdated();
            setOpen(false);
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </Modal>
  );
}
