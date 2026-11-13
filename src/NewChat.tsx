import { useEffect, useState, type FormEvent } from 'react';
import { Check, LoaderCircle, X } from 'lucide-react';
import { Avatar } from './Avatar';
import { Modal } from './ui';
import { api } from './api';
import type { Person } from './types';

export function NewChat({
  onCreated,
  onClose,
}: {
  onCreated: (id: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<'direct' | 'group'>('direct'),
    [query, setQuery] = useState(''),
    [title, setTitle] = useState(''),
    [results, setResults] = useState<Person[]>([]),
    [selected, setSelected] = useState<Person[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [searching, setSearching] = useState(false);
  useEffect(() => {
    let valid = true;
    setError('');
    if (query.trim().length < 2) {
      setSearching(false);
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      api<Person[]>(`/users?q=${encodeURIComponent(query)}`)
        .then((data) => {
          if (valid) setResults(data);
        })
        .catch((e) => {
          if (valid) setError(e.message);
        })
        .finally(() => {
          if (valid) setSearching(false);
        });
    }, 250);
    return () => {
      valid = false;
      clearTimeout(timer);
    };
  }, [query]);
  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ id: string }>('/chats', 'POST', {
        kind,
        title: kind === 'group' ? title : undefined,
        userIds: selected.map((p) => p.id),
      });
      await onCreated(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Новый чат" onClose={onClose}>
      <div className="segmented">
        <button
          className={kind === 'direct' ? 'selected' : ''}
          onClick={() => {
            setKind('direct');
            setSelected([]);
          }}
        >
          Личный чат
        </button>
        <button
          className={kind === 'group' ? 'selected' : ''}
          onClick={() => {
            setKind('group');
            setSelected([]);
          }}
        >
          Новая группа
        </button>
      </div>
      <form className="stack" onSubmit={create}>
        <div className="fold" data-open={kind === 'group'} inert={kind !== 'group'}>
          <div>
            <label>
              Название группы
              <input
                required
                maxLength={70}
                value={title}
                disabled={kind !== 'group'}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
          </div>
        </div>
        <label>
          Найти пользователя
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Имя или логин"
          />
        </label>
        {selected.length > 0 && (
          <div className="selected-people">
            {selected.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => setSelected((s) => s.filter((v) => v.id !== p.id))}
              >
                {p.name}
                <X size={14} />
              </button>
            ))}
          </div>
        )}
        <div className="people-results">
          {searching && <span className="muted">Поиск…</span>}
          {results.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() =>
                setSelected((s) =>
                  kind === 'direct'
                    ? [p]
                    : s.some((v) => v.id === p.id)
                      ? s.filter((v) => v.id !== p.id)
                      : [...s, p],
                )
              }
            >
              <Avatar person={p} />
              <span>
                <strong>{p.name}</strong>
                <small>@{p.username}</small>
              </span>
              {selected.some((v) => v.id === p.id) && <Check size={19} />}
            </button>
          ))}
          {query.length >= 2 && !searching && results.length === 0 && (
            <p className="muted">Никого не найдено.</p>
          )}
          {query.length < 2 && <p className="muted">Минимум 2 символа.</p>}
        </div>
        <p className="form-error" role="alert">
          {error}
        </p>
        <button className="primary wide" disabled={busy || (kind === 'direct' && !selected.length)}>
          {busy ? (
            <LoaderCircle className="spin" size={18} />
          ) : kind === 'group' ? (
            'Создать группу'
          ) : (
            'Написать'
          )}
        </button>
      </form>
    </Modal>
  );
}
