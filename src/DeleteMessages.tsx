import { useState } from 'react';
import { api } from './api';
import { CloseButton, Modal, motionAllowed, plural } from './ui';

/** Fold message rows away before they leave the list. */
async function fold(ids: string[]) {
  const rows = ids
    .map((id) =>
      document
        .querySelector(`.messages [data-message-id="${id}"]`)
        ?.closest<HTMLElement>('.message-group-item'),
    )
    .filter((row): row is HTMLElement => Boolean(row));
  if (!rows.length || !motionAllowed()) return;
  const folds = rows.map((row) => {
    row.style.overflow = 'hidden';
    return row
      .animate(
        [
          { height: `${row.offsetHeight}px`, opacity: 1 },
          { height: '0px', opacity: 0, transform: 'scale(0.96)' },
        ],
        { duration: 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'forwards' },
      )
      .finished.catch(() => undefined);
  });
  // Background tabs pause animations; never let that hold the deletion.
  await Promise.race([Promise.all(folds), new Promise((done) => setTimeout(done, 300))]);
}

/** Confirms and deletes one or several messages for me or for everyone in the chat. */
export function DeleteMessages({
  chatId,
  ids,
  canDeleteForAll = true,
  error,
  onClose,
  onDeleted,
  report,
}: {
  chatId: string;
  ids: string[];
  canDeleteForAll?: boolean;
  error: string;
  onClose: () => void;
  /** Called with the ids actually deleted, also when a later one failed. */
  onDeleted: (removed: string[], scope: 'me' | 'all') => void;
  report: (error: unknown) => void;
}) {
  const [working, setWorking] = useState(false);
  const several = ids.length > 1;
  async function remove(scope: 'me' | 'all') {
    setWorking(true);
    const removed: string[] = [];
    try {
      for (const id of ids) {
        await api(`/chats/${chatId}/messages/${id}?scope=${scope}&undo=1`, 'DELETE');
        removed.push(id);
      }
      onClose();
      await fold(removed);
    } catch (e) {
      report(e);
    } finally {
      setWorking(false);
      if (removed.length) onDeleted(removed, scope);
    }
  }
  return (
    <Modal
      error={error}
      title={
        several
          ? `Удалить ${ids.length} ${plural(ids.length, 'сообщение', 'сообщения', 'сообщений')}?`
          : 'Удалить сообщение?'
      }
      onClose={onClose}
    >
      <p className="muted">
        {canDeleteForAll
          ? several
            ? 'Можно удалить сообщения только у себя или у всех участников.'
            : 'Можно удалить сообщение только у себя или у всех участников.'
          : several
            ? 'Сообщения удалятся только у вас.'
            : 'Сообщение удалится только у вас.'}
      </p>
      <div className="modal-actions">
        <CloseButton>Отмена</CloseButton>
        <button className="secondary" disabled={working} onClick={() => void remove('me')}>
          Удалить у себя
        </button>
        {canDeleteForAll && (
          <button className="danger" disabled={working} onClick={() => void remove('all')}>
            Удалить
          </button>
        )}
      </div>
    </Modal>
  );
}
