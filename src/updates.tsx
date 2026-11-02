import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Download, RefreshCw, ExternalLink } from 'lucide-react';
import { API_BASE, isDemo } from './api';
import { Capacitor } from '@capacitor/core';
import { newerVersion, releaseFiles, type Release } from './platform';
export type UpdateStatus = {
  phase: string;
  version?: string;
  installedVersion?: string;
  platform?: string;
  percent?: number;
  error?: string;
  url?: string;
  mode?: 'automatic' | 'manual';
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
const UpdateContext = createContext<{
  status: UpdateStatus;
  busy: boolean;
  check: () => Promise<void>;
} | null>(null);
export function UpdateProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<UpdateStatus>({ phase: 'idle' });
  const [busy, setBusy] = useState(false);
  const running = useRef(false),
    lastCheck = useRef(0);
  const desktop = window.galinkaDesktop;
  const check = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    lastCheck.current = Date.now();
    setBusy(true);
    try {
      if (desktop) {
        setStatus(await desktop.check());
        return;
      }
      const native = Capacitor.isNativePlatform();
      const response = await fetch(`${API_BASE}${native ? '/downloads' : '/version'}`, {
        cache: 'no-store',
        credentials: 'include',
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw Error();
      const remote = await response.json();
      const file = native
        ? releaseFiles(
            remote as Release,
            Capacitor.getPlatform() === 'android' ? 'Android' : 'iOS',
          )[0]
        : undefined;
      const available = native
        ? !!file && newerVersion(remote.version, __APP_VERSION__)
        : newerVersion(remote.version, __APP_VERSION__) ||
          (remote.version === __APP_VERSION__ && remote.build !== __BUILD_ID__);
      setStatus({
        phase: available ? 'available' : 'current',
        version: remote.version,
        url: file?.url,
      });
      if (!native && 'serviceWorker' in navigator)
        await (await navigator.serviceWorker.getRegistration())?.update();
    } catch {
      setStatus((previous) =>
        ['available', 'downloaded', 'downloading'].includes(previous.phase)
          ? previous
          : { phase: 'error', error: 'Не удалось проверить обновления. Попробуйте позже.' },
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [desktop]);
  useEffect(() => {
    const unsubscribe = desktop?.onStatus(setStatus);
    if (!isDemo()) void check();
    const resume = () => {
      if (!isDemo() && !document.hidden && Date.now() - lastCheck.current > 60000) void check();
    };
    const timer = setInterval(resume, 10 * 60000);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => {
      unsubscribe?.();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
    };
  }, [check, desktop]);
  return (
    <UpdateContext.Provider value={{ status, busy, check }}>{children}</UpdateContext.Provider>
  );
}
export function useUpdates() {
  const context = useContext(UpdateContext);
  if (!context) throw Error('UpdateProvider is missing');
  return {
    ...context,
    available: ['available', 'downloaded', 'downloading'].includes(context.status.phase),
  };
}
export function Updates({ hasDraft = false }: { hasDraft?: boolean }) {
  const { status, busy, check } = useUpdates();
  const [updating, setUpdating] = useState(false),
    [reloadConfirm, setReloadConfirm] = useState(false);
  const [error, setError] = useState('');
  const desktop = window.galinkaDesktop,
    native = Capacitor.isNativePlatform();
  async function update() {
    if (native && status.url) {
      window.open(status.url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (desktop && status.mode === 'manual') {
      await desktop.download();
      return;
    }
    if (hasDraft && !reloadConfirm) {
      setReloadConfirm(true);
      return;
    }
    setUpdating(true);
    setError('');
    try {
      if (desktop) {
        if (status.phase === 'downloaded') await desktop.install();
        else await desktop.download();
      } else {
        const registration =
          'serviceWorker' in navigator
            ? await navigator.serviceWorker.getRegistration()
            : undefined;
        if (registration?.waiting) {
          await new Promise<void>((resolve) => {
            const finish = () => {
              navigator.serviceWorker.removeEventListener('controllerchange', finish);
              clearTimeout(timeout);
              resolve();
            };
            const timeout = setTimeout(finish, 4000);
            navigator.serviceWorker.addEventListener('controllerchange', finish);
            registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
          });
        }
        location.reload();
      }
    } catch {
      setError('Обновление не установлено. Попробуйте ещё раз.');
    } finally {
      setUpdating(false);
    }
  }
  const phase = status.phase,
    available = ['available', 'downloaded'].includes(phase);
  return (
    <div className="updates-panel">
      <div>
        <strong>Обновления Galinka</strong>
        <p>Версия {__APP_VERSION__}</p>
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
                : phase === 'checking' || busy
                  ? 'Проверяем обновления…'
                  : phase === 'error'
                    ? status.error
                    : 'Проверьте наличие новой версии.'}
      </p>
      {(error || reloadConfirm) && (
        <p className="form-error" role="alert">
          {error ||
            'Есть неотправленные сообщения. Нажмите ещё раз, чтобы перезапустить приложение.'}
        </p>
      )}
      <div className="update-actions">
        {available ? (
          <button className="primary" onClick={() => void update()} disabled={updating || busy}>
            <Download size={17} />
            {desktop
              ? status.mode === 'manual'
                ? 'Скачать новую версию'
                : phase === 'downloaded'
                  ? 'Установить и перезапустить'
                  : 'Скачать обновление'
              : native
                ? 'Скачать обновление'
                : 'Обновить приложение'}
          </button>
        ) : (
          <button
            className="secondary"
            onClick={() => void check()}
            disabled={busy || phase === 'downloading'}
          >
            <RefreshCw size={17} className={busy ? 'spin' : ''} />
            {busy ? 'Проверяем…' : 'Проверить обновления'}
          </button>
        )}
        {desktop && (
          <button className="text-button" onClick={() => void desktop.releases()}>
            Все версии <ExternalLink size={14} />
          </button>
        )}
      </div>
      {native && (
        <p className="tiny muted">
          Установите новую версию поверх приложения — переписка сохранится.
        </p>
      )}
      {desktop && status.mode === 'manual' && (
        <p className="tiny muted">Установите новую версию из раздела загрузок.</p>
      )}
    </div>
  );
}
