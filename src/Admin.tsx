import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, LogOut, Plus, RefreshCw, ShieldCheck, Users, Megaphone } from 'lucide-react';
import { api, ApiError } from './api';
import { Auth, Modal } from './App';
import { ThemeToggle } from './theme';
import type { AdminUser, Announcement, Page, Person } from './types';
import './admin.css';

export default function Admin() {
  const [me, setMe] = useState<Person | null>(null),
    [ready, setReady] = useState(false);
  const [tab, setTab] = useState<'users' | 'announcements'>('users');
  const [users, setUsers] = useState<Page<AdminUser>>({ items: [], total: 0, page: 1 });
  const [posts, setPosts] = useState<Page<Announcement>>({ items: [], total: 0, page: 1 });
  const [query, setQuery] = useState(''),
    [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<
    { kind: 'user'; item?: AdminUser } | { kind: 'post'; item?: Announcement } | null
  >(null);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const request = useRef<AbortController | null>(null);
  const mutationPending = useRef(false);
  const busy = loading || saving;
  const fail = useCallback((e: unknown) => {
    setError((e as Error).message);
    if (e instanceof ApiError && e.status === 401) setMe(null);
  }, []);
  useEffect(() => {
    const current = new AbortController();
    api<Person>('/me', 'GET', undefined, { signal: current.signal })
      .then((person) => {
        if (!current.signal.aborted) setMe(person);
      })
      .catch((e) => {
        if (!current.signal.aborted && (!(e instanceof ApiError) || e.status !== 401)) fail(e);
      })
      .finally(() => {
        if (!current.signal.aborted) setReady(true);
      });
    return () => current.abort();
  }, [fail]);
  const load = useCallback(async () => {
    if (me?.role !== 'admin') return;
    request.current?.abort();
    const current = new AbortController();
    request.current = current;
    setLoading(true);
    setError('');
    try {
      if (tab === 'users') {
        const result = await api<Page<AdminUser>>(
          `/admin/users?page=${page}&q=${encodeURIComponent(query)}`,
          'GET',
          undefined,
          { signal: current.signal },
        );
        if (!current.signal.aborted) setUsers(result);
      } else {
        const result = await api<Page<Announcement>>(
          `/admin/announcements?page=${page}`,
          'GET',
          undefined,
          { signal: current.signal },
        );
        if (!current.signal.aborted) setPosts(result);
      }
    } catch (e) {
      if (!current.signal.aborted) fail(e);
    } finally {
      if (!current.signal.aborted) setLoading(false);
    }
  }, [me?.id, me?.role, tab, page, query, fail]);
  useEffect(() => {
    setLoading(true);
    // Cancel the previous search immediately, then wait for typing to pause.
    const timer = setTimeout(() => void load(), query && tab === 'users' ? 250 : 0);
    return () => {
      clearTimeout(timer);
      request.current?.abort();
    };
  }, [load, query, tab]);
  async function mutate(url: string, method: string, body?: unknown) {
    if (mutationPending.current) return;
    mutationPending.current = true;
    request.current?.abort();
    setLoading(false);
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await api(url, method, body);
      setEditor(null);
      setDeleting(null);
      setNotice('Изменения сохранены.');
      // A role/password change may revoke this session. Check it before refreshing private data.
      setMe(await api<Person>('/me'));
      if (page !== 1) setPage(1);
      else await load();
    } catch (e) {
      fail(e);
    } finally {
      mutationPending.current = false;
      setSaving(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    if (editor?.kind === 'user') {
      const body: Record<string, unknown> = {
        name: data.get('name'),
        username: data.get('username'),
        role: data.get('role'),
      };
      if (data.get('password')) body.password = data.get('password');
      if (editor.item) body.blocked = data.get('blocked') === 'on';
      await mutate(
        '/admin/users' + (editor.item ? `/${editor.item.id}` : ''),
        editor.item ? 'PATCH' : 'POST',
        body,
      );
    } else if (editor?.kind === 'post') {
      await mutate(
        '/admin/announcements' + (editor.item ? `/${editor.item.id}` : ''),
        editor.item ? 'PATCH' : 'POST',
        {
          title: data.get('title'),
          body: data.get('body'),
          published: data.get('published') === 'on',
        },
      );
    }
  }
  if (!ready)
    return (
      <main className="boot">
        <p role="status">Загружаем панель…</p>
      </main>
    );
  if (!me)
    return (
      <>
        <Auth
          onLogin={(person) => {
            setError('');
            setMe(person);
          }}
        />
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
      </>
    );
  if (me.role !== 'admin')
    return (
      <main className="admin-denied">
        <ShieldCheck size={40} />
        <h1>Доступ ограничен</h1>
        <p>Панель доступна только администратору Galinka.</p>
        <a className="primary" href="/app">
          Вернуться в приложение
        </a>
      </main>
    );
  const total = tab === 'users' ? users.total : posts.total;
  return (
    <div className="admin-shell">
      <header className="admin-header">
        <a className="brand" href="/app">
          <img src="/icon.svg" alt="" />
          galinka<span className="admin-brand-label">Управление</span>
        </a>
        <div>
          <ThemeToggle />
          <span className="admin-identity">{me.name}</span>
          <button
            className="secondary"
            disabled={saving}
            onClick={async () => {
              try {
                await api('/auth/logout', 'POST');
                setMe(null);
              } catch (e) {
                fail(e);
              }
            }}
          >
            <LogOut size={16} />
            Выйти
          </button>
        </div>
      </header>
      <div className="admin-layout">
        <aside className="admin-nav">
          <a className="text-button" href="/app">
            <ArrowLeft size={16} />В приложение
          </a>
          <nav aria-label="Разделы управления">
            <button
              disabled={saving}
              aria-current={tab === 'users' ? 'page' : undefined}
              onClick={() => {
                setTab('users');
                setPage(1);
                setNotice('');
              }}
            >
              <Users size={19} />
              Пользователи
            </button>
            <button
              disabled={saving}
              aria-current={tab === 'announcements' ? 'page' : undefined}
              onClick={() => {
                setTab('announcements');
                setPage(1);
                setNotice('');
              }}
            >
              <Megaphone size={19} />
              Объявления
            </button>
          </nav>
          <p>
            Ваш сервер.
            <br />
            Ваш круг.
            <br />
            <span>Galinka {__APP_VERSION__}</span>
          </p>
        </aside>
        <main className="admin-main">
          <div className="admin-title">
            <div>
              <span className="small-label">Панель администратора</span>
              <h1>{tab === 'users' ? 'Пользователи' : 'Объявления'}</h1>
              <p className="muted">
                {tab === 'users'
                  ? 'Аккаунты, роли и доступ к Galinka.'
                  : 'Новости, которые увидят пользователи приложения.'}
              </p>
            </div>
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                setError('');
                setEditor({ kind: tab === 'users' ? 'user' : 'post' });
              }}
            >
              <Plus size={18} />
              {tab === 'users' ? 'Добавить пользователя' : 'Создать объявление'}
            </button>
          </div>
          <div className="admin-toolbar">
            {tab === 'users' && (
              <label className="admin-search">
                Поиск пользователей
                <input
                  type="search"
                  disabled={saving}
                  placeholder="Имя или логин"
                  value={query}
                  maxLength={40}
                  onChange={(e) => {
                    setLoading(true);
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
            )}
            <span className="muted">Всего: {total}</span>
            <button className="secondary" disabled={busy} onClick={load}>
              <RefreshCw size={16} />
              Обновить
            </button>
          </div>
          {error && !editor && !deleting && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="admin-notice" role="status">
              {notice}
            </p>
          )}
          {busy && <p role="status">{saving ? 'Сохраняем изменения…' : 'Загружаем данные…'}</p>}
          <div className="admin-table-wrap" aria-busy={busy}>
            {tab === 'users' ? (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Пользователь</th>
                    <th>Роль</th>
                    <th>Доступ</th>
                    <th>
                      <span className="sr-only">Действия</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {users.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.name}</strong>
                        <span>
                          @{item.username}
                          {item.id === me.id ? ' · это вы' : ''}
                        </span>
                      </td>
                      <td>{item.role === 'admin' ? 'Администратор' : 'Пользователь'}</td>
                      <td>
                        <span className={`admin-state ${item.blocked ? 'is-blocked' : ''}`}>
                          {item.blocked ? 'Заблокирован' : 'Активен'}
                        </span>
                      </td>
                      <td>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => {
                            setError('');
                            setEditor({ kind: 'user', item });
                          }}
                          aria-label={`Изменить ${item.username}`}
                        >
                          Изменить
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="admin-posts">
                {posts.items.map((item) => (
                  <article key={item.id}>
                    <div>
                      <span className="admin-state">
                        {item.published ? 'Опубликовано' : 'Черновик'}
                      </span>
                      <time dateTime={item.updated_at}>
                        {new Date(item.updated_at).toLocaleDateString('ru')}
                      </time>
                    </div>
                    <h2>{item.title}</h2>
                    <p>{item.body}</p>
                    <footer>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          setError('');
                          setEditor({ kind: 'post', item });
                        }}
                        aria-label={`Редактировать ${item.title}`}
                      >
                        Редактировать
                      </button>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          mutate(`/admin/announcements/${item.id}`, 'PATCH', {
                            published: !item.published,
                          })
                        }
                      >
                        {item.published ? 'Снять с публикации' : 'Опубликовать'}
                      </button>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          setError('');
                          setDeleting(item);
                        }}
                        aria-label={`Удалить ${item.title}`}
                      >
                        Удалить
                      </button>
                    </footer>
                  </article>
                ))}
              </div>
            )}
            {!busy && !total && (
              <p className="admin-empty">
                {tab === 'users'
                  ? 'Пользователи не найдены.'
                  : 'Пока нет объявлений. Создайте первую новость для вашей компании.'}
              </p>
            )}
          </div>
          {total > 50 && (
            <div className="admin-pagination">
              <button
                className="secondary"
                disabled={busy || page === 1}
                onClick={() => setPage(page - 1)}
              >
                Назад
              </button>
              <span>Страница {page}</span>
              <button
                className="secondary"
                disabled={busy || page * 50 >= total}
                onClick={() => setPage(page + 1)}
              >
                Далее
              </button>
            </div>
          )}
        </main>
      </div>
      {editor && (
        <Modal
          title={
            editor.kind === 'user'
              ? editor.item
                ? 'Изменить пользователя'
                : 'Добавить пользователя'
              : editor.item
                ? 'Редактировать объявление'
                : 'Создать объявление'
          }
          onClose={() => {
            if (!busy) setEditor(null);
          }}
          error={error}
        >
          <form onSubmit={submit}>
            <fieldset disabled={busy} className="admin-fields">
              {editor.kind === 'user' ? (
                <>
                  <label>
                    Имя
                    <input name="name" defaultValue={editor.item?.name} required maxLength={40} />
                  </label>
                  <label>
                    Логин
                    <input
                      name="username"
                      defaultValue={editor.item?.username}
                      required
                      pattern="[a-z0-9_]{3,24}"
                      minLength={3}
                      maxLength={24}
                      autoComplete="off"
                    />
                    <small>3–24 символа: латинские буквы, цифры и подчёркивание.</small>
                  </label>
                  <label>
                    {editor.item ? 'Новый пароль' : 'Пароль'}
                    <input
                      name="password"
                      type="password"
                      required={!editor.item}
                      minLength={10}
                      maxLength={128}
                      autoComplete="new-password"
                    />
                    <small>
                      {editor.item
                        ? 'Оставьте пустым, чтобы сохранить пароль. Смена пароля завершит все сеансы.'
                        : 'Не менее 10 символов.'}
                    </small>
                  </label>
                  <label>
                    Роль
                    <select name="role" defaultValue={editor.item?.role || 'user'}>
                      <option value="user">Пользователь</option>
                      <option value="admin">Администратор</option>
                    </select>
                  </label>
                  {editor.item && (
                    <label className="admin-checkbox">
                      <input type="checkbox" name="blocked" defaultChecked={editor.item.blocked} />
                      Заблокировать аккаунт
                    </label>
                  )}
                  <p className="muted">
                    Блокировка завершает все сеансы и отключает уведомления. Последнего активного
                    администратора отключить нельзя.
                  </p>
                </>
              ) : (
                <>
                  <label>
                    Заголовок
                    <input
                      name="title"
                      defaultValue={editor.item?.title}
                      required
                      maxLength={120}
                    />
                  </label>
                  <label>
                    Текст объявления
                    <textarea
                      name="body"
                      defaultValue={editor.item?.body}
                      required
                      maxLength={10000}
                      rows={7}
                    />
                  </label>
                  <label className="admin-checkbox">
                    <input
                      type="checkbox"
                      name="published"
                      defaultChecked={editor.item?.published}
                    />
                    Опубликовать в приложении
                  </label>
                  <p className="muted">
                    Без публикации запись останется черновиком, доступным только администраторам.
                  </p>
                </>
              )}
            </fieldset>
            <div className="admin-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setEditor(null)}
              >
                Отмена
              </button>
              <button className="primary" disabled={busy}>
                {busy ? 'Сохраняем…' : 'Сохранить'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {deleting && (
        <Modal
          title="Удалить объявление"
          onClose={() => {
            if (!busy) setDeleting(null);
          }}
          error={error}
        >
          <p>«{deleting.title}» будет удалено из приложения. Восстановить запись нельзя.</p>
          <div className="admin-actions">
            <button className="secondary" disabled={busy} onClick={() => setDeleting(null)}>
              Отмена
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() => mutate(`/admin/announcements/${deleting.id}`, 'DELETE')}
            >
              Удалить навсегда
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
