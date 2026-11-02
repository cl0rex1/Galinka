import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Crown, LoaderCircle, LogOut, Plus, Search, UserMinus, X } from 'lucide-react';
import { api } from './api';
import { Modal } from './App';
import type { Chat, Person } from './types';

type Confirmation = { kind: 'remove' | 'transfer'; person: Person } | { kind: 'leave' };

export function GroupSettings({
  chat,
  me,
  members,
  onUpdated,
  onLeft,
  onClose,
}: {
  chat: Chat;
  me: Person;
  members: Person[];
  onUpdated: () => Promise<void>;
  onLeft: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(chat.title);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const working = useRef(false);
  const owner = chat.owner_id === me.id;
  const canLeave = !owner || members.length === 1;

  useEffect(() => {
    setTitle(chat.title);
  }, [chat.title]);
  useEffect(() => {
    const controller = new AbortController();
    setResults([]);
    if (!owner || query.trim().length < 2) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      api<Person[]>(`/users?q=${encodeURIComponent(query.trim())}`, 'GET', undefined, {
        signal: controller.signal,
      })
        .then((people) =>
          setResults(people.filter((person) => !members.some((member) => member.id === person.id))),
        )
        .catch((cause) => {
          if (!controller.signal.aborted) setError(cause.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, owner, members]);

  async function mutate(action: () => Promise<unknown>, success: string, left = false) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      if (left) {
        await onLeft();
        return;
      }
      await onUpdated();
      setConfirmation(null);
      setNotice(success);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  function rename(event: FormEvent) {
    event.preventDefault();
    void mutate(
      () => api(`/chats/${chat.id}`, 'PATCH', { title: title.trim() }),
      'Название группы сохранено.',
    );
  }
  async function addMembers() {
    await mutate(async () => {
      await api(`/chats/${chat.id}/members`, 'POST', {
        userIds: selected.map((person) => person.id),
      });
      setSelected([]);
      setQuery('');
    }, 'Участники добавлены.');
  }
  function confirm() {
    if (!confirmation) return;
    if (confirmation.kind === 'leave') {
      void mutate(() => api(`/chats/${chat.id}/members/${me.id}`, 'DELETE'), '', true);
    } else if (confirmation.kind === 'transfer') {
      void mutate(
        () => api(`/chats/${chat.id}`, 'PATCH', { ownerId: confirmation.person.id }),
        'Владелец группы изменён.',
      );
    } else {
      void mutate(
        () => api(`/chats/${chat.id}/members/${confirmation.person.id}`, 'DELETE'),
        'Участник удалён из группы.',
      );
    }
  }

  return (
    <Modal
      title="Управление группой"
      closeDisabled={busy}
      onClose={() => {
        if (!busy) onClose();
      }}
      error={error}
    >
      <div className="group-settings">
        {notice && (
          <p className="group-notice" role="status">
            <Check size={16} />
            {notice}
          </p>
        )}
        {owner ? (
          <form className="group-name-form" onSubmit={rename}>
            <label>
              Название группы
              <input
                required
                maxLength={70}
                value={title}
                disabled={busy}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <button
              className="secondary"
              disabled={busy || !title.trim() || title.trim() === chat.title}
            >
              Сохранить название
            </button>
          </form>
        ) : (
          <p className="muted">
            {chat.title} · {members.length} участников
          </p>
        )}
        <div className="group-members">
          <div className="section-heading">
            <h3>Участники</h3>
            <span>{members.length} / 100</span>
          </div>
          {members.map((person) => (
            <div className="group-member-row" key={person.id}>
              <span className={`avatar small tone-${person.color}`} aria-hidden="true">
                {person.name.slice(0, 1)}
              </span>
              <div className="group-member-details">
                <strong>
                  {person.name}
                  {person.id === me.id ? ' · вы' : ''}
                </strong>
                <span>@{person.username}</span>
              </div>
              {person.id === chat.owner_id ? (
                <span className="owner-label">
                  <Crown size={14} />
                  Владелец
                </span>
              ) : (
                owner && (
                  <div className="group-member-actions">
                    <button
                      className="icon-button"
                      type="button"
                      disabled={busy}
                      aria-label={`Сделать владельцем: ${person.name}`}
                      title="Передать владение"
                      onClick={() => setConfirmation({ kind: 'transfer', person })}
                    >
                      <Crown size={17} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      disabled={busy}
                      aria-label={`Удалить участника: ${person.name}`}
                      title="Удалить участника"
                      onClick={() => setConfirmation({ kind: 'remove', person })}
                    >
                      <UserMinus size={17} />
                    </button>
                  </div>
                )
              )}
            </div>
          ))}
        </div>
        {owner && members.length < 100 && (
          <section className="group-search">
            <h3>Добавить друзей</h3>
            <label>
              <span>
                <Search size={15} />
                Найти пользователя
              </span>
              <input
                value={query}
                disabled={busy}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Имя или логин"
              />
            </label>
            {selected.length > 0 && (
              <div className="selected-people">
                {selected.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setSelected((people) => people.filter((item) => item.id !== person.id))
                    }
                  >
                    {person.name}
                    <X size={14} />
                  </button>
                ))}
              </div>
            )}
            {searching && (
              <p className="muted" role="status">
                Ищем друзей…
              </p>
            )}
            {!searching && query.trim().length >= 2 && results.length === 0 && (
              <p className="muted">Новых участников не найдено.</p>
            )}
            <div className="people-results">
              {results.map((person) => (
                <button
                  type="button"
                  key={person.id}
                  disabled={busy}
                  aria-pressed={selected.some((item) => item.id === person.id)}
                  onClick={() =>
                    setSelected((people) =>
                      people.some((item) => item.id === person.id)
                        ? people.filter((item) => item.id !== person.id)
                        : [...people, person],
                    )
                  }
                >
                  <span className={`avatar small tone-${person.color}`}>
                    {person.name.slice(0, 1)}
                  </span>
                  <span>
                    <strong>{person.name}</strong>
                    <small>@{person.username}</small>
                  </span>
                  {selected.some((item) => item.id === person.id) && <Check size={18} />}
                </button>
              ))}
            </div>
            {selected.length > 0 && (
              <button
                type="button"
                className="primary wide"
                disabled={busy || members.length + selected.length > 100}
                onClick={() => void addMembers()}
              >
                {busy ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}Добавить
                выбранных ({selected.length})
              </button>
            )}
            {members.length + selected.length > 100 && (
              <p className="form-error">В группе может быть не больше 100 участников.</p>
            )}
          </section>
        )}
        {confirmation && (
          <div className="group-confirm" role="group" aria-label="Подтвердить действие">
            <p>
              {confirmation.kind === 'leave'
                ? owner
                  ? 'Вы последний участник. Группа и её переписка будут удалены.'
                  : 'После выхода переписка группы станет недоступна. Вернуться можно по новому приглашению.'
                : confirmation.kind === 'transfer'
                  ? `Передать группу пользователю ${confirmation.person.name}? Вы останетесь участником и потеряете права управления.`
                  : `Удалить ${confirmation.person.name} из группы? Доступ к переписке прекратится.`}
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setConfirmation(null)}
              >
                Отмена
              </button>
              <button type="button" className="danger" disabled={busy} onClick={confirm}>
                {busy
                  ? 'Сохраняем…'
                  : confirmation.kind === 'transfer'
                    ? 'Передать владение'
                    : confirmation.kind === 'leave'
                      ? 'Выйти из группы'
                      : 'Удалить участника'}
              </button>
            </div>
          </div>
        )}
        {!confirmation && (
          <div className="group-leave">
            <button
              type="button"
              className="text-button"
              disabled={busy || !canLeave}
              onClick={() => setConfirmation({ kind: 'leave' })}
            >
              <LogOut size={17} />
              Выйти из группы
            </button>
            {!canLeave && (
              <p className="tiny muted">
                Сначала передайте владение другому участнику — кнопка с короной рядом с его именем.
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
