import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, Copy, Plus } from 'lucide-react';
import { api } from './api';

type Invite = {
  id: string;
  note: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by: string | null;
};
const date = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' });

export function AdminInvites() {
  const [items, setItems] = useState<Invite[]>([]),
    [url, setUrl] = useState(''),
    [copied, setCopied] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const load = useCallback(() => {
    api<Invite[]>('/admin/invites')
      .then(setItems)
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void act(async () => {
      const result = await api<{ url: string }>('/admin/invites', 'POST', {
        note: String(data.get('note') || ''),
        days: Number(data.get('days')),
      });
      setUrl(result.url);
      setCopied(false);
      form.reset();
    });
  }
  const now = Date.now();
  return (
    <>
      <div className="admin-title">
        <div>
          <h1>Приглашения</h1>
          <p className="muted">Одноразовая ссылка для регистрации одного человека.</p>
        </div>
      </div>
      <form className="admin-invite-form" onSubmit={create}>
        <label>
          Для кого
          <input name="note" maxLength={80} placeholder="Необязательно" />
        </label>
        <label>
          Срок
          <select name="days" defaultValue="7">
            <option value="1">1 день</option>
            <option value="7">7 дней</option>
            <option value="30">30 дней</option>
          </select>
        </label>
        <button className="primary" disabled={busy}>
          <Plus size={17} />
          Создать ссылку
        </button>
      </form>
      {url && (
        <div className="admin-invite-url">
          <input
            readOnly
            aria-label="Ссылка-приглашение"
            value={url}
            onFocus={(e) => e.target.select()}
          />
          <button
            className="secondary"
            onClick={() =>
              void navigator.clipboard.writeText(url).then(
                () => setCopied(true),
                () => setError('Не удалось скопировать. Выделите ссылку вручную.'),
              )
            }
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? 'Скопировано' : 'Скопировать'}
          </button>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Для кого</th>
              <th>Создано</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const expired = !item.used_at && Date.parse(item.expires_at) < now;
              return (
                <tr key={item.id}>
                  <td>{item.note || '—'}</td>
                  <td>{date.format(new Date(item.created_at))}</td>
                  <td>
                    {item.used_at
                      ? `Использовано: ${item.used_by || 'аккаунт удалён'}`
                      : expired
                        ? 'Истекло'
                        : `До ${date.format(new Date(item.expires_at))}`}
                  </td>
                  <td>
                    {!item.used_at && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void act(() => api(`/admin/invites/${item.id}`, 'DELETE').then(() => {}))
                        }
                      >
                        Отозвать
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!items.length && <p className="admin-empty">Приглашений пока нет.</p>}
      </div>
    </>
  );
}
