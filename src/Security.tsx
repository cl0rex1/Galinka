import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { api } from './api';

type Device = {
  id: string;
  created_at: string;
  last_seen_at: string;
  user_agent: string;
  current: boolean;
};
const dateFormatter = new Intl.DateTimeFormat('ru', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
export function deviceName(agent: string) {
  // Desktop builds report Electron; the Android app is a WebView ("; wv)").
  const app = /Electron|; wv\)/.test(agent) ? 'Приложение' : '';
  const os = /iPhone|iPad/.test(agent)
    ? 'iOS'
    : /Android/.test(agent)
      ? 'Android'
      : /Windows/.test(agent)
        ? 'Windows'
        : /Mac OS X/.test(agent)
          ? 'macOS'
          : /Linux/.test(agent)
            ? 'Linux'
            : '';
  const browser = app
    ? ''
    : /Edg\//.test(agent)
      ? 'Edge'
      : /Firefox\//.test(agent)
        ? 'Firefox'
        : /Chrome\//.test(agent)
          ? 'Chrome'
          : /Safari\//.test(agent)
            ? 'Safari'
            : '';
  return [app || browser, os].filter(Boolean).join(' · ') || 'Неизвестное устройство';
}

export function Security({ demo }: { demo: boolean }) {
  const [devices, setDevices] = useState<Device[]>([]),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [changing, setChanging] = useState(false);
  const load = useCallback(() => {
    if (demo) return;
    api<Device[]>('/me/sessions')
      .then((items) => setDevices(Array.isArray(items) ? items : []))
      .catch((e) => setError((e as Error).message));
  }, [demo]);
  useEffect(load, [load]);
  async function run(key: string, action: () => Promise<unknown>, done = '') {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(done);
      load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy('');
    }
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (data.password !== data.repeat) {
      setError('Новые пароли не совпадают.');
      return;
    }
    const ok = await run(
      'password',
      () => api('/me/password', 'POST', { current: data.current, password: data.password }),
      'Пароль изменён. Другие устройства вышли из аккаунта.',
    );
    if (ok) {
      form.reset();
      setChanging(false);
    }
  }
  if (demo)
    return (
      <section className="settings-section">
        <h2>Безопасность</h2>
        <p className="muted">Недоступно в демоверсии.</p>
      </section>
    );
  const others = devices.filter((device) => !device.current);
  return (
    <section className="settings-section security-settings">
      <h2>Безопасность</h2>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="form-notice" role="status">
          {notice}
        </p>
      )}
      {changing ? (
        <form className="password-form" onSubmit={changePassword}>
          <label>
            Текущий пароль
            <input name="current" type="password" autoComplete="current-password" required />
          </label>
          <label>
            Новый пароль
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              maxLength={128}
            />
          </label>
          <label>
            Повторите новый пароль
            <input name="repeat" type="password" autoComplete="new-password" required />
          </label>
          <div className="row-actions">
            <button type="button" className="secondary" onClick={() => setChanging(false)}>
              Отмена
            </button>
            <button className="primary" disabled={busy === 'password'}>
              {busy === 'password' && <LoaderCircle className="spin" size={16} />}
              Сменить пароль
            </button>
          </div>
        </form>
      ) : (
        <div className="settings-row">
          <div>
            <h3>Пароль</h3>
          </div>
          <button className="secondary" onClick={() => setChanging(true)}>
            Сменить
          </button>
        </div>
      )}
      <h3 className="settings-subheading">Устройства</h3>
      <ul className="device-list">
        {devices.map((device) => (
          <li key={device.id}>
            <div>
              <strong>{deviceName(device.user_agent)}</strong>
              <small>
                {device.current
                  ? 'Это устройство'
                  : `Активность: ${dateFormatter.format(new Date(device.last_seen_at))}`}
              </small>
            </div>
            {!device.current && (
              <button
                className="text-button"
                disabled={Boolean(busy)}
                onClick={() =>
                  void run(device.id, () => api(`/me/sessions/${device.id}`, 'DELETE'))
                }
              >
                Завершить
              </button>
            )}
          </li>
        ))}
      </ul>
      {others.length > 1 && (
        <button
          className="secondary"
          disabled={Boolean(busy)}
          onClick={() => void run('all', () => api('/me/sessions', 'DELETE'))}
        >
          Завершить все другие сеансы
        </button>
      )}
    </section>
  );
}
