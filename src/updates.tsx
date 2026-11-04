import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Download, RefreshCw, ExternalLink, Check, ArrowUpRight } from 'lucide-react';
import { API_BASE, isDemo } from './api';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
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
  autoDownload?: boolean;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
  packageFormat?: string;
  canInstall?: boolean;
};
const AndroidUpdates = registerPlugin<{
  status: () => Promise<UpdateStatus>;
  setAutoDownload: (options: { enabled: boolean }) => Promise<UpdateStatus>;
  download: (options: { url: string; version: string }) => Promise<UpdateStatus>;
  install: () => Promise<{ openedSettings: boolean }>;
  addListener: (
    event: 'status',
    callback: (status: UpdateStatus) => void,
  ) => Promise<PluginListenerHandle>;
}>('GalinkaUpdates');
const androidUpdater = () =>
  Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('GalinkaUpdates')
    ? AndroidUpdates
    : undefined;
const trustedAndroidDownload = (value: string) => {
  try {
    const url = new URL(value);
    return (
      url.origin === 'https://github.com' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname.startsWith('/cl0rex1/Galinka/releases/download/') &&
      url.pathname.endsWith('-android-release.apk')
    );
  } catch {
    return false;
  }
};
const mergeAndroidStatus = (previous: UpdateStatus, next: UpdateStatus): UpdateStatus => ({
  ...previous,
  ...next,
  ...(next.phase === 'idle' ? { phase: previous.phase, version: previous.version } : {}),
});
declare global {
  const __APP_VERSION__: string;
  const __BUILD_ID__: string;
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
  const android = androidUpdater();
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
      const androidState = await android?.status();
      if (androidState && ['downloading', 'downloaded'].includes(androidState.phase)) {
        setStatus((previous) => mergeAndroidStatus(previous, androidState));
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
          ).find(
            (file) => Capacitor.getPlatform() !== 'android' || trustedAndroidDownload(file.url),
          )
        : undefined;
      const available = native
        ? !!file && newerVersion(remote.version, __APP_VERSION__)
        : newerVersion(remote.version, __APP_VERSION__) ||
          (remote.version === __APP_VERSION__ && remote.build !== __BUILD_ID__);
      setStatus({
        ...androidState,
        phase: available ? 'available' : 'current',
        version: remote.version,
        url: file?.url,
      });
      if (android && androidState?.autoDownload && available && file) {
        const downloading = await android.download({ url: file.url, version: remote.version });
        setStatus((previous) => mergeAndroidStatus(previous, downloading));
      }
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
  }, [desktop, android]);
  useEffect(() => {
    const unsubscribe = desktop?.onStatus(setStatus);
    const androidListener = android?.addListener('status', (next) =>
      setStatus((previous) => mergeAndroidStatus(previous, next)),
    );
    if (android)
      void android
        .status()
        .then((next) => setStatus((previous) => mergeAndroidStatus(previous, next)))
        .catch(() => {});
    if (desktop)
      void desktop
        .status()
        .then(setStatus)
        .catch(() => {});
    if (!isDemo()) void check();
    const resume = () => {
      if (!isDemo() && !document.hidden && Date.now() - lastCheck.current > 60000) void check();
    };
    const timer = setInterval(resume, 10 * 60000);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => {
      unsubscribe?.();
      void androidListener?.then((listener) => listener.remove()).catch(() => {});
      clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
    };
  }, [check, desktop, android]);
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
  const [updating, setUpdating] = useState(false);
  const [savingPreference, setSavingPreference] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const desktop = window.galinkaDesktop,
    native = Capacitor.isNativePlatform(),
    android = androidUpdater();
  async function update() {
    const needsRestart = desktop || android ? status.phase === 'downloaded' : !native;
    if (needsRestart && hasDraft) {
      setError('Завершите отправку, запись или редактирование перед перезапуском.');
      return;
    }
    setUpdating(true);
    setError('');
    setNotice('');
    try {
      if (android) {
        if (status.phase === 'downloaded') {
          const result = await android.install();
          if (result.openedSettings)
            setNotice(
              'Разрешите установку из Galinka, вернитесь и нажмите «Установить обновление» ещё раз.',
            );
        } else if (status.url && status.version)
          await android.download({ url: status.url, version: status.version });
      } else if (native && status.url) {
        window.open(status.url, '_blank', 'noopener,noreferrer');
      } else if (desktop) {
        if (status.phase === 'downloaded') {
          if (!(await desktop.install())) throw Error('Update is not ready');
        } else await desktop.download();
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
  async function setAutoDownload(enabled: boolean) {
    if (!desktop && !android) return;
    setSavingPreference(true);
    setError('');
    try {
      if (desktop) await desktop.setAutoDownload(enabled);
      else if (android) {
        await android.setAutoDownload({ enabled });
        if (enabled && status.phase === 'available' && status.url && status.version)
          await android.download({ url: status.url, version: status.version });
      }
    } catch {
      setError('Не удалось сохранить настройку. Попробуйте ещё раз.');
    } finally {
      setSavingPreference(false);
    }
  }
  const phase = status.phase,
    available = ['available', 'downloaded'].includes(phase),
    needsRestart = desktop || android ? phase === 'downloaded' : !native,
    autoDownload = status.autoDownload ?? !android,
    percent = Math.min(100, Math.max(0, status.percent ?? 0)),
    bytes = (value: number) => `${(value / 1024 / 1024).toFixed(1)} МБ`;
  return (
    <div className="updates-panel">
      <div>
        <strong>Galinka</strong>
        <p className="update-version">Версия {status.installedVersion || __APP_VERSION__}</p>
      </div>
      <p className="update-status" role="status">
        {phase === 'current' ? (
          <>
            <Check size={16} aria-hidden="true" /> У вас актуальная версия
          </>
        ) : phase === 'available' ? (
          `Доступна версия ${status.version}`
        ) : phase === 'downloading' ? (
          `Скачиваем обновление: ${status.percent ?? 0}%`
        ) : phase === 'downloaded' ? (
          android ? (
            `Версия ${status.version} проверена и готова к установке.`
          ) : (
            `Версия ${status.version} готова. Перезапустите, когда будет удобно.`
          )
        ) : phase === 'checking' || busy ? (
          'Проверяем обновления…'
        ) : phase === 'error' ? (
          status.error
        ) : (
          'Проверьте наличие новой версии.'
        )}
      </p>
      {phase === 'downloading' && (
        <div className="update-progress">
          <progress value={percent} max={100} aria-label="Загрузка обновления" />
          {!!status.total && (
            <span className="tiny muted">
              {bytes(status.transferred ?? 0)} из {bytes(status.total)}
              {status.bytesPerSecond ? ` · ${bytes(status.bytesPerSecond)}/с` : ''}
            </span>
          )}
        </div>
      )}
      {(android || (desktop && status.mode === 'automatic')) && (
        <div className="module-switch-row update-preference">
          <div>
            <strong>Скачивать автоматически</strong>
            <p>
              {android
                ? 'APK загружается, пока Galinka работает. Может использовать мобильный интернет. Установка — с подтверждением Android.'
                : 'Новые версии загружаются в фоне. Перезапуск — по вашему нажатию.'}
            </p>
          </div>
          <button
            type="button"
            className={`switch ${autoDownload ? 'on' : ''}`}
            role="switch"
            aria-label="Скачивать обновления автоматически"
            aria-checked={autoDownload}
            disabled={savingPreference}
            onClick={() => void setAutoDownload(!autoDownload)}
          >
            <span />
          </button>
        </div>
      )}
      {notice && (
        <p className="tiny muted" role="status">
          {notice}
        </p>
      )}
      {(error || (available && needsRestart && hasDraft)) && (
        <p className="form-error" role="alert">
          {error ||
            'Завершите отправку, запись или редактирование перед перезапуском. Текстовые черновики сохранены.'}
        </p>
      )}
      <div className="update-actions">
        {available ? (
          <button
            className="primary"
            onClick={() => void update()}
            disabled={updating || busy || (needsRestart && hasDraft)}
          >
            {needsRestart ? <RefreshCw size={17} /> : <Download size={17} />}
            {desktop
              ? status.mode === 'manual'
                ? 'Скачать новую версию'
                : phase === 'downloaded'
                  ? 'Перезапустить и обновить'
                  : 'Скачать обновление'
              : native
                ? phase === 'downloaded'
                  ? android && status.canInstall === false
                    ? 'Разрешить установку'
                    : 'Установить обновление'
                  : 'Скачать обновление'
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
          <button
            className="text-button"
            onClick={() =>
              void desktop.releases().catch(() => setError('Не удалось открыть страницу релизов.'))
            }
          >
            Все версии <ExternalLink size={14} />
          </button>
        )}
        {native && status.url && (
          <a className="text-button" href={status.url} target="_blank" rel="noopener noreferrer">
            Скачать через браузер <ExternalLink size={14} />
          </a>
        )}
      </div>
      {native && (
        <p className="tiny muted">
          Galinka проверяет новые версии автоматически.{' '}
          {android
            ? 'Перед установкой проверяются приложение, версия и подпись APK. Установку подтверждаете вы в Android.'
            : 'Android попросит подтвердить установку APK — установите его поверх приложения, чтобы сохранить вход и переписку.'}
        </p>
      )}
      {desktop && status.mode === 'manual' && (
        <p className="tiny muted">
          {status.platform === 'darwin'
            ? 'Новые версии проверяются автоматически. Для обновления скачайте DMG и замените Galinka в «Программах».'
            : status.packageFormat === 'arch'
              ? 'Новые версии проверяются автоматически. Скачайте пакет и установите его через pacman -U.'
              : 'Новые версии проверяются автоматически. Установите скачанный DEB через менеджер пакетов.'}
        </p>
      )}
      {!desktop && !native && (
        <p className="tiny muted">
          <ArrowUpRight size={13} aria-hidden="true" /> Galinka проверяет новые версии
          автоматически. Обновление применится после перезапуска; текстовые черновики сохранятся.
        </p>
      )}
    </div>
  );
}
