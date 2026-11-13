import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Avatar } from './Avatar';
import { Modal, plural } from './ui';
import { api } from './api';
import type { Chat } from './types';

/** Pick a chat to forward messages to; the server copies them there. */
export function ForwardDialog({
  chats,
  messageIds,
  onDone,
  onClose,
}: {
  chats: Chat[];
  messageIds: string[];
  onDone: (chatId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(''),
    [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState('');
  const shown = chats.filter(
    (chat) => !chat.archived && chat.title.toLowerCase().includes(query.trim().toLowerCase()),
  );
  async function forward(chat: Chat) {
    setBusy(chat.id);
    setError('');
    try {
      await api(`/chats/${chat.id}/forward`, 'POST', { messageIds });
      onDone(chat.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }
  const count = messageIds.length;
  return (
    <Modal
      title={
        count === 1
          ? 'Переслать сообщение'
          : `Переслать ${count} ${plural(count, 'сообщение', 'сообщения', 'сообщений')}`
      }
      onClose={onClose}
      closeDisabled={Boolean(busy)}
    >
      <div className="stack">
        <label>
          Кому
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти чат"
            autoFocus
          />
        </label>
        <div className="people-results forward-targets">
          {shown.map((chat) => (
            <button
              type="button"
              key={chat.id}
              disabled={Boolean(busy)}
              onClick={() => void forward(chat)}
            >
              <Avatar chat={chat} person={chat.peer} />
              <span>
                <strong>{chat.title}</strong>
                <small>
                  {chat.kind === 'saved'
                    ? 'Заметки и файлы'
                    : chat.kind === 'group'
                      ? `${chat.member_count} ${plural(chat.member_count, 'участник', 'участника', 'участников')}`
                      : `@${chat.peer?.username || ''}`}
                </small>
              </span>
              {busy === chat.id && <LoaderCircle className="spin" size={18} />}
            </button>
          ))}
          {!shown.length && <p className="muted">Чатов не найдено.</p>}
        </div>
        <p className="form-error" role="alert">
          {error}
        </p>
      </div>
    </Modal>
  );
}
