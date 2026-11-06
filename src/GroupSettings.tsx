import { useEffect, useState, type FormEvent } from 'react';
import { Check, ChevronRight, LoaderCircle, LogOut, UserPlus, X } from 'lucide-react';
import { api } from './api';
import { Avatar } from './Avatar';
import { Confirm, Modal, plural } from './ui';
import type { Chat, Person } from './types';

export function GroupSettings({
  chat,
  me,
  members,
  onUpdated,
  onLeft,
  onOpenPerson,
  onClose,
}: {
  chat: Chat;
  me: Person;
  members: Person[];
  onUpdated: () => Promise<void>;
  onLeft: () => void | Promise<void>;
  onOpenPerson: (person: Person) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(chat.title);
  const [saved, setSaved] = useState(false);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [leaving, setLeaving] = useState(false);
  const owner = chat.owner_id === me.id;
  const canLeave = !owner || members.length === 1;
  const renamed = title.trim() && title.trim() !== chat.title;

  useEffect(() => setTitle(chat.title), [chat.title]);
  useEffect(() => {
    const controller = new AbortController();
    setResults([]);
    if (!adding || query.trim().length < 2) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      api<Person[]>(`/users?q=${encodeURIComponent(query.trim())}`, 'GET', undefined, {
        signal: controller.signal,
      })
        .then((people) => setResults(people.filter((p) => !members.some((m) => m.id === p.id))))
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
  }, [query, adding, members]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await onUpdated();
      return true;
    } catch (cause) {
      setError((cause as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function rename(event: FormEvent) {
    event.preventDefault();
    if (!renamed || busy) return;
    if (await run(() => api(`/chats/${chat.id}`, 'PATCH', { title: title.trim() }))) {
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    }
  }
  async function addMembers() {
    const ids = selected.map((person) => person.id);
    if (await run(() => api(`/chats/${chat.id}/members`, 'POST', { userIds: ids }))) {
      setSelected([]);
      setQuery('');
      setAdding(false);
    }
  }
  const toggle = (person: Person) =>
    setSelected((people) =>
      people.some((item) => item.id === person.id)
        ? people.filter((item) => item.id !== person.id)
        : [...people, person],
    );

  return (
    <Modal title="Управление группой" closeDisabled={busy} onClose={onClose} error={error}>
      <div className="group-settings">
        {owner && (
          <form className="group-name-form" onSubmit={rename}>
            <label>
              Название группы
              <span className="inline-field">
                <input
                  required
                  maxLength={70}
                  value={title}
                  disabled={busy}
                  onChange={(event) => setTitle(event.target.value)}
                />
                {(renamed || saved) && (
                  <button
                    className="inline-save"
                    disabled={busy || saved}
                    aria-label={saved ? 'Название сохранено' : 'Сохранить название'}
                    title="Сохранить"
                  >
                    {busy ? <LoaderCircle size={18} className="spin" /> : <Check size={18} />}
                  </button>
                )}
              </span>
            </label>
          </form>
        )}

        <section className="group-members" aria-label="Участники">
          <h3>
            {members.length} {plural(members.length, 'участник', 'участника', 'участников')}
            <span> из 100</span>
          </h3>
          {owner && members.length < 100 && (
            <button
              type="button"
              className="member-row add-row"
              aria-expanded={adding}
              onClick={() => setAdding((value) => !value)}
            >
              <span className="add-icon">
                <UserPlus size={19} />
              </span>
              <span className="member-name">Добавить участников</span>
            </button>
          )}
          <div className="group-search" data-open={adding} inert={!adding}>
            <div>
              <input
                aria-label="Найти пользователя"
                value={query}
                disabled={busy}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Имя или логин"
              />
              {selected.length > 0 && (
                <div className="selected-people">
                  {selected.map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      aria-label={`Убрать ${person.name}`}
                      onClick={() => toggle(person)}
                    >
                      {person.name}
                      <X size={14} />
                    </button>
                  ))}
                </div>
              )}
              <div className="people-results">
                {searching && <p className="muted">Ищем…</p>}
                {!searching && query.trim().length >= 2 && results.length === 0 && (
                  <p className="muted">Новых участников не найдено.</p>
                )}
                {results.map((person) => (
                  <button
                    type="button"
                    key={person.id}
                    aria-pressed={selected.some((item) => item.id === person.id)}
                    onClick={() => toggle(person)}
                  >
                    <Avatar person={person} />
                    <span>
                      <strong>{person.name}</strong>
                      <small>@{person.username}</small>
                    </span>
                    {selected.some((item) => item.id === person.id) && <Check size={18} />}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {members.map((person) => (
            <button
              type="button"
              className="member-row"
              key={person.id}
              onClick={() => onOpenPerson(person)}
            >
              <Avatar person={person} size="small" />
              <span className="member-name">
                <strong>
                  {person.name}
                  {person.id === me.id && <small> · вы</small>}
                </strong>
                <small>@{person.username}</small>
              </span>
              {person.id === chat.owner_id && <span className="owner-label">владелец</span>}
              <ChevronRight size={17} className="member-chevron" />
            </button>
          ))}
        </section>

        <button
          type="button"
          className="leave-row"
          disabled={busy || !canLeave}
          onClick={() => setLeaving(true)}
        >
          <LogOut size={18} />
          Выйти из группы
        </button>
        {!canLeave && (
          <p className="settings-hint">
            Чтобы выйти, сначала передайте группу: откройте участника и выберите «Сделать
            владельцем».
          </p>
        )}

        {selected.length > 0 && (
          <div className="sticky-action">
            <button
              type="button"
              className="primary wide"
              disabled={busy || members.length + selected.length > 100}
              onClick={() => void addMembers()}
            >
              {busy ? <LoaderCircle className="spin" size={17} /> : <UserPlus size={17} />}
              Добавить {selected.length}{' '}
              {plural(selected.length, 'участника', 'участников', 'участников')}
            </button>
            {members.length + selected.length > 100 && (
              <p className="form-error">В группе может быть не больше 100 участников.</p>
            )}
          </div>
        )}
      </div>
      {leaving && (
        <Confirm
          title="Выйти из группы?"
          text={
            owner
              ? 'Вы последний участник. Группа и её переписка будут удалены.'
              : 'Переписка группы станет недоступна. Вернуться можно по новому приглашению.'
          }
          action="Выйти"
          onConfirm={async () => {
            await api(`/chats/${chat.id}/members/${me.id}`, 'DELETE');
            await onLeft();
          }}
          onClose={() => setLeaving(false)}
        />
      )}
    </Modal>
  );
}
