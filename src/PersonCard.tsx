import { useState } from 'react';
import { Crown, LoaderCircle, MessageCircle, QrCode, UserMinus } from 'lucide-react';
import { currentAccent, profileLink, ShareSheet } from './Share';
import { api } from './api';
import { ProfileHero } from './ProfileHero';
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
      <ProfileHero person={person} title={person.name} subtitle={`@${person.username}`}>
        {group?.owner_id === person.id && (
          <span className="person-role">
            <Crown size={14} />
            Владелец группы
          </span>
        )}
      </ProfileHero>
      <div className="person-actions">
        {!self && (
          <button
            className="primary wide"
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
            {busy ? <LoaderCircle className="spin" size={18} /> : <MessageCircle size={18} />}
            Написать
          </button>
        )}
        <div className="action-list">
          <button type="button" onClick={() => setSharing(true)}>
            <QrCode size={18} />
            Поделиться контактом
          </button>
        </div>
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
