import { useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { api } from './api';
import { ThemeToggle } from './theme';
import { QrLogin } from './QrLogin';
import type { Person } from './types';

const signup = new URLSearchParams(location.search).get('signup') || '';

export function Auth({
  onLogin,
  onDemo,
}: {
  onLogin: (person: Person) => void;
  onDemo?: () => void;
}) {
  const [register, setRegister] = useState(Boolean(signup)),
    [qr, setQr] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError('');
    try {
      const person = await api<Person>(register ? '/auth/register' : '/auth/login', 'POST', data);
      if (signup) history.replaceState({}, '', location.pathname);
      onLogin(person);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const tab = (value: boolean, label: string, byQr = false) => (
    <button
      type="button"
      role="tab"
      aria-selected={byQr ? qr : !qr && register === value}
      onClick={() => {
        setRegister(value);
        setQr(byQr);
        setError('');
      }}
    >
      {label}
    </button>
  );
  return (
    <main className="auth-page">
      <div className="auth-theme">
        <ThemeToggle />
      </div>
      <div className="auth-card">
        <a className="brand" href="/">
          <img src="/icon.svg" alt="" width="32" height="32" />
          Galinka
        </a>
        <h1 key={`${register}${qr}`}>
          {qr ? 'Вход по QR-коду' : register ? 'Регистрация' : 'Вход'}
        </h1>
        <div className="auth-tabs" role="tablist">
          {tab(false, 'Вход')}
          {tab(true, 'Регистрация')}
          {tab(false, 'QR-код', true)}
        </div>
        {qr ? (
          <QrLogin onLogin={onLogin} />
        ) : (
          <form className="stack" onSubmit={submit}>
            {/* Sign-up fields stay rendered and fold open, so the card grows instead of jumping.
              Disabled while folded: not validated and not sent. */}
            <div className="fold" data-open={register} inert={!register}>
              <div>
                <label>
                  Имя
                  <input
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={40}
                    disabled={!register}
                  />
                </label>
              </div>
            </div>
            <label>
              Логин
              <input
                name="username"
                autoComplete="username"
                required
                minLength={3}
                maxLength={24}
                pattern="[a-zA-Z0-9_]{3,24}"
                autoCapitalize="none"
                spellCheck={false}
              />
            </label>
            <label>
              Пароль
              <input
                name="password"
                type="password"
                autoComplete={register ? 'new-password' : 'current-password'}
                required
                minLength={10}
                maxLength={128}
              />
              <span className="fold" data-open={register}>
                <small>Не меньше 10 символов</small>
              </span>
            </label>
            <div className="fold" data-open={register} inert={!register}>
              <div>
                <label>
                  Код приглашения
                  <input
                    name="invite"
                    required
                    autoComplete="off"
                    defaultValue={signup}
                    disabled={!register}
                  />
                </label>
              </div>
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary wide" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <span key={String(register)} className="swap-in">
                  {register ? 'Создать аккаунт' : 'Войти'}
                </span>
              )}
            </button>
          </form>
        )}
        {onDemo && (
          <button className="text-button auth-demo" onClick={onDemo}>
            Открыть демо без регистрации
          </button>
        )}
      </div>
      <p className="auth-version">Galinka {__APP_VERSION__}</p>
    </main>
  );
}
