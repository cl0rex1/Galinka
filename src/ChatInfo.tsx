import { ArrowLeft, Bell, BellOff, Pencil, QrCode, Search, X } from 'lucide-react';
import { Avatar, seenText } from './Avatar';
import { ChatMedia } from './ChatMedia';
import { usePanelSwipeBack } from './gestures';
import { ProfileDetails } from './ProfileDetails';
import { ProfileHero } from './ProfileHero';
import { CHAT_SOUNDS, playTone } from './sounds';
import { IconButton } from './ui';
import type { Attachment, Chat, Person } from './types';

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
  onSound,
  onSearch,
  onOpenMessage,
  onDownload,
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
  onSound: (sound: NonNullable<Chat['sound']>) => void;
  onSearch: () => void;
  /** Show this message in the conversation. */
  onOpenMessage: (messageId: string) => void;
  onDownload: (file: Attachment) => void;
  onInvite: () => void;
  onManage: () => void;
  onPerson: (person: Person) => void;
  onNelya: () => void;
}) {
  const owner = chat.owner_id === meId;
  const swipe = usePanelSwipeBack(onClose);
  return (
    <aside
      className={`chat-info ${closing ? 'closing' : ''}`}
      aria-label="О чате"
      inert={closing}
      {...swipe}
    >
      {/* Phones show it as a screen of its own: back sits on the left, where the chat's back is. */}
      <div className="info-head">
        <IconButton label="Закрыть информацию" className="info-back" onClick={onClose}>
          <ArrowLeft size={22} />
        </IconButton>
        <strong>О чате</strong>
        <IconButton label="Закрыть информацию" className="info-close" onClick={onClose}>
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
            <button onClick={onManage} aria-label="Управление группой">
              <Pencil size={20} />
              Изменить
            </button>
          </>
        )}
      </div>
      {chat.kind === 'direct' && chat.peer && <ProfileDetails person={chat.peer} />}
      <ChatMedia key={chat.id} chatId={chat.id} onOpen={onOpenMessage} onDownload={onDownload} />
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
      {chat.kind !== 'saved' && (
        <div className="info-section">
          <div className="settings-row">
            <div>
              <h3>Звук уведомлений</h3>
              <p>
                {chat.muted
                  ? 'Чат без уведомлений: звучат только упоминания.'
                  : 'Для этого чата, на всех устройствах.'}
              </p>
            </div>
            <select
              aria-label="Звук уведомлений"
              value={chat.sound ?? 'default'}
              disabled={muteBusy}
              onChange={(event) => {
                const sound = event.target.value as NonNullable<Chat['sound']>;
                playTone(sound);
                onSound(sound);
              }}
            >
              {CHAT_SOUNDS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
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
