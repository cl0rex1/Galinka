import { useEffect, useState } from 'react';
import { LoaderCircle, MonitorSmartphone, RotateCw } from 'lucide-react';
import { api, ApiError, isDemo } from './api';
import { deviceName } from './Security';
import { CloseButton, Modal } from './ui';
import { BrandQR, currentAccent, loginLink } from './Share';
import type { Person } from './types';

/**
 * New device: show a one-time code and wait for a signed-in phone to scan and confirm it.
 * A fresh code replaces an expired one by itself; after a few rounds it waits for a tap.
 */
export function QrLogin({ onLogin }: { onLogin: (person: Person) => void }) {
  const [code, setCode] = useState<{ token: string; key: string; expires: number } | null>(null);
  const [round, setRound] = useState(0);
  const [error, setError] = useState('');
  const idle = round >= 5;

  useEffect(() => {
    if (idle) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    setError('');
    api<{ token: string; key: string; expires: number }>('/auth/qr', 'POST')
      .then((next) => {
        if (!live) return;
        setCode(next);
        const poll = async () => {
          try {
            const result = await api<{ status: string; person?: Person }>('/auth/qr/poll', 'POST', {
              token: next.token,
              key: next.key,
            });
            if (!live) return;
            if (result.person) onLogin(result.person);
            else timer = setTimeout(poll, 1500);
          } catch (cause) {
            if (!live) return;
            if (cause instanceof ApiError && cause.status === 410) setRound((value) => value + 1);
            else setError((cause as Error).message);
          }
        };
        timer = setTimeout(poll, 1500);
      })
      .catch((cause) => {
        if (live) setError((cause as Error).message);
      });
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [round, idle]);

  return (
    <div className="qr-login">
      <div
        className={`qr-login-code ${idle ? 'stale' : ''}`}
        style={{ '--share-accent': currentAccent() } as never}
      >
        {code ? (
          <BrandQR key={code.token} value={loginLink(code.token)} accent={currentAccent()} />
        ) : (
          <LoaderCircle className="spin" size={28} />
        )}
        {idle && (
          <button type="button" className="secondary" onClick={() => setRound(0)}>
            <RotateCw size={17} />
            Показать новый код
          </button>
        )}
      </div>
      <ol className="qr-steps">
        <li>Откройте Galinka на телефоне, где вы уже вошли.</li>
        <li>Настройки → Сканер, или значок сканера над списком чатов.</li>
        <li>Наведите камеру на этот код и подтвердите вход.</li>
      </ol>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Signed-in phone, after scanning a login code: show which device asks and let the user decide. */
export function LoginApprove({ token, onClose }: { token: string; onClose: () => void }) {
  const [agent, setAgent] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (isDemo()) {
      setError('Вход по QR недоступен в демоверсии.');
      return;
    }
    api<{ agent: string }>('/auth/qr/inspect', 'POST', { token })
      .then((result) => setAgent(result.agent))
      .catch((cause) => setError((cause as Error).message));
  }, [token]);
  return (
    <Modal
      title="Вход на новом устройстве"
      onClose={onClose}
      error={error}
      open={open}
      closeDisabled={busy}
    >
      {agent === null ? (
        !error && <p className="muted">Проверяем код…</p>
      ) : (
        <>
          <div className="device-card">
            <MonitorSmartphone size={22} />
            <strong>{deviceName(agent)}</strong>
          </div>
          <p className="muted">
            Подтвердите, только если это ваше устройство и код показан на нём сейчас. Не входите по
            коду, который вам прислали.
          </p>
          <div className="modal-actions">
            <CloseButton disabled={busy}>Отмена</CloseButton>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api('/auth/qr/approve', 'POST', { token });
                  setOpen(false);
                } catch (cause) {
                  setError((cause as Error).message);
                  setBusy(false);
                }
              }}
            >
              Войти
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
