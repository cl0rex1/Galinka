import { useEffect, useState } from 'react';
import { Download, RefreshCw, Check, ExternalLink } from 'lucide-react';
import { API_BASE } from './api';
export type UpdateStatus = {
  phase: string;
  version?: string;
  installedVersion?: string;
  platform?: string;
  percent?: number;
  error?: string;
};
declare global {
  const __APP_VERSION__: string;
  const __BUILD_ID__: string;
  interface Window {
    galinkaDesktop?: {
      status: () => Promise<UpdateStatus>;
      check: () => Promise<UpdateStatus>;
      download: () => Promise<UpdateStatus>;
      install: () => Promise<void>;
      releases: () => Promise<void>;
      onStatus: (callback: (status: UpdateStatus) => void) => () => void;
    };
  }
}
export function Updates({ hasDraft = false }: { hasDraft?: boolean }) {
  const [status, setStatus] = useState<UpdateStatus>({ phase: 'idle' }),
    [busy, setBusy] = useState(false),
    [reloadConfirm, setReloadConfirm] = useState(false);
  const desktop = window.galinkaDesktop;
  useEffect(() => {
    if (desktop) {
      desktop
        .status()
        .then(setStatus)
        .catch(() => {});
      return desktop.onStatus(setStatus);
    }
  }, [desktop]);
  async function check() {
    setBusy(true);
    setReloadConfirm(false);
    try {
      if (desktop) {
        setStatus(await desktop.check());
      } else {
        const response = await fetch(`${API_BASE}/version`, {
          cache: 'no-store',
          credentials: 'include',
        });
        if (!response.ok) throw Error();
        const remote = await response.json();
        setStatus({
          phase:
            remote.version !== __APP_VERSION__ || remote.build !== __BUILD_ID__
              ? 'available'
              : 'current',
          version: remote.version,
        });
        if ('serviceWorker' in navigator) {
          const registration = await navigator.serviceWorker.getRegistration();
          await registration?.update();
        }
      }
    } catch {
      setStatus({ phase: 'error', error: 'Не удалось проверить обновления. Попробуйте позже.' });
    } finally {
      setBusy(false);
    }
  }
  async function update() {
    if (hasDraft && !reloadConfirm) {
      setReloadConfirm(true);
      return;
    }
    setBusy(true);
    try {
      if (desktop) {
        if (status.phase === 'downloaded') await desktop.install();
        else await desktop.download();
      } else {
        const registration =
          'serviceWorker' in navigator
            ? await navigator.serviceWorker.getRegistration()
            : undefined;
        registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
        location.reload();
      }
    } catch {
      setStatus({ phase: 'error', error: 'Обновление не установлено. Попробуйте ещё раз.' });
    } finally {
      setBusy(false);
    }
  }
  const phase = status.phase,
    available = ['available', 'downloaded'].includes(phase);
  return (
    <div className="updates-panel">
      <div>
        <strong>Обновления Galinka</strong>
        <p>
          Веб-версия {__APP_VERSION__}
          {status.installedVersion ? ` · приложение ${status.installedVersion}` : ''}
        </p>
      </div>
      <p className="update-status" role="status">
        {phase === 'current'
          ? 'У вас актуальная версия.'
          : phase === 'available'
            ? `Доступна версия ${status.version}`
            : phase === 'downloading'
              ? `Скачиваем обновление: ${status.percent ?? 0}%`
              : phase === 'downloaded'
                ? 'Обновление готово к установке.'
                : phase === 'checking'
                  ? 'Проверяем GitHub Releases…'
                  : phase === 'error'
                    ? status.error
                    : 'Проверьте, появилась ли новая версия.'}
      </p>
      {reloadConfirm && (
        <p className="form-error" role="alert">
          В чате есть неотправленный текст. Сохраните его перед перезапуском или нажмите кнопку ещё
          раз.
        </p>
      )}
      <div className="update-actions">
        {available ? (
          <button className="primary" onClick={update} disabled={busy}>
            <Download size={17} />
            {desktop
              ? phase === 'downloaded'
                ? 'Установить и перезапустить'
                : 'Скачать обновление'
              : 'Обновить приложение'}
          </button>
        ) : (
          <button className="secondary" onClick={check} disabled={busy || phase === 'downloading'}>
            <RefreshCw size={17} className={busy ? 'spin' : ''} />
            {busy ? 'Проверяем…' : 'Проверить обновления'}
          </button>
        )}
        {desktop && (
          <button className="text-button" onClick={() => desktop.releases()}>
            Все версии
            <ExternalLink size={14} />
          </button>
        )}
      </div>
      <p className="tiny muted">
        {desktop
          ? 'Обновления настольной оболочки — из GitHub Releases. На macOS автоматическая установка требует подписанной сборки.'
          : 'Обновится интерфейс на этом устройстве. Сервер обновляется отдельно администратором.'}
      </p>
    </div>
  );
}
