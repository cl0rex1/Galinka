import { Bell, BellOff, QrCode, Search, Users, X } from 'lucide-react';
import { Avatar, seenText } from './Avatar';
import { ProfileHero } from './ProfileHero';
import { IconButton } from './ui';
import type { Chat, Person } from './types';

/** The "О чате" panel: profile, quick actions, members and Nelya. */
export function ChatInfo({
  chat,
  meId,
  members,
  subtitle,
  closing,
  muteBusy,
  nelyaBusy,
  onClose,
  onMute,
  onSearch,
  onInvite,
  onManage,
  onPerson,
  onNelya,
}: {
  chat: Chat;
  meId: string;
  members: Person[];
  subtitle: string;
  closing: boolean;
  muteBusy: boolean;
  nelyaBusy: boolean;
  onClose: () => void;
  onMute: () => void;
  onSearch: () => void;
  onInvite: () => void;
  onManage: () => void;
  onPerson: (person: Person) => void;
  onNelya: () => void;
}) {
  const owner = chat.owner_id === meId;
  return (
    <aside className={`chat-info ${closing ? 'closing' : ''}`} aria-label="О чате" inert={closing}>
      <div className="info-head">
        <strong>О чате</strong>
        <IconButton label="Закрыть информацию" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </div>
      <ProfileHero
        key={chat.id}
        chat={chat}
        person={chat.peer}
        title={chat.title}
        subtitle={subtitle}
      />
      <div className="hero-tiles">
        <button disabled={muteBusy} onClick={onMute}>
          {chat.muted ? <Bell size={20} /> : <BellOff size={20} />}
          {chat.muted ? 'Звук' : 'Без звука'}
        </button>
        <button onClick={onSearch}>
          <Search size={20} />
          Поиск
        </button>
        {chat.kind === 'group' && owner && (
          <>
            <button onClick={onInvite}>
              <QrCode size={20} />
              Пригласить
            </button>
            <button onClick={onManage}>
              <Users size={20} />
              Управление
            </button>
          </>
        )}
      </div>
      {chat.kind !== 'saved' && (
        <div className="info-section">
          <h4>
            Участники <span>{members.length}</span>
          </h4>
          {members.map((p) => (
            <button type="button" className="member-row" key={p.id} onClick={() => onPerson(p)}>
              <Avatar person={p} size="small" />
              <span className="member-name">
                <strong>
                  {p.name}
                  {p.id === meId && <small> · вы</small>}
                </strong>
                <small className={p.seen === 'online' ? 'is-online' : ''}>
                  {p.id === meId ? 'в сети' : seenText(p.seen) || `@${p.username}`}
                </small>
              </span>
              {p.id === chat.owner_id && chat.kind === 'group' && (
                <span className="owner-label">владелец</span>
              )}
            </button>
          ))}
        </div>
      )}
      <div className="info-section">
        <div className="settings-row">
          <div>
            <h3>Неля</h3>
            <p>
              Бот для компании: «@неля монетка», «@неля выбери чай | кофе», «@неля идея».
              {!owner && ' Включает владелец чата.'}
            </p>
          </div>
          <button
            className={`switch ${chat.nelya ? 'on' : ''}`}
            role="switch"
            aria-checked={chat.nelya}
            aria-label="Неля в этом чате"
            disabled={nelyaBusy || !owner}
            onClick={onNelya}
          >
            <span />
          </button>
        </div>
      </div>
    </aside>
  );
}
