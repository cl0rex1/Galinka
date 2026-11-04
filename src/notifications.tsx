import { useEffect, useRef, useState } from 'react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { Bell, BellOff } from 'lucide-react';
import { api } from './api';

export const isNative = Capacitor.getPlatform() === 'android';
const nativePush = isNative && import.meta.env.VITE_NATIVE_PUSH === 'true';
const validChat = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const isIOS =
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed =
  matchMedia('(display-mode: standalone)').matches ||
  Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
const browserPush =
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
let deviceToken: string | undefined;
type Phase =
  'unavailable' | 'install' | 'unconfigured' | 'off' | 'denied' | 'enabled' | 'busy' | 'error';
function preference(key: string, value?: 'on' | 'off') {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
async function worker() {
  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}
function applicationKey(key: string) {
  const binary = atob(key.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
export async function clearPushDevice() {
  if (window.galinkaDesktop) {
    await window.galinkaDesktop.notifications.clear();
    return;
  }
  if (nativePush) {
    if (deviceToken) await api('/push/devices', 'DELETE', { token: deviceToken });
    await PushNotifications.removeAllDeliveredNotifications();
    await PushNotifications.unregister();
    deviceToken = undefined;
  } else if (browserPush) {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await api('/push/subscriptions', 'DELETE', { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    }
    const notifications = await registration?.getNotifications();
    notifications?.forEach((notification) => notification.close());
  }
}
export function useNotifications(
  userId: string | undefined,
  demo: boolean,
  onOpen: (chatId: string) => void,
) {
  const [phase, setPhase] = useState<Phase>('busy');
  const [background, setBackground] = useState(false);
  const [retry, setRetry] = useState(0);
  const initialized = useRef(false);
  const open = useRef(onOpen);
  open.current = onOpen;
  const publicKey = useRef<string | null>(null);
  const operation = useRef(false);
  const previousUser = useRef(userId);
  const identity = useRef(userId);
  identity.current = userId;
  const key = `galinka-push-${userId}`;
  useEffect(() => {
    const hadUser = previousUser.current;
    previousUser.current = userId;
    if (!userId || demo) {
      setPhase('off');
      if (hadUser && window.galinkaDesktop) void window.galinkaDesktop.notifications.clear();
      return;
    }
    initialized.current = false;
    let disposed = false;
    const handles: PluginListenerHandle[] = [];
    const cleanups: (() => void)[] = [];
    const set = (value: Phase) => {
      if (!disposed) {
        if (value === 'off' || value === 'enabled') initialized.current = true;
        setPhase(value);
      }
    };
    set('busy');
    const navigate = (chatId: unknown) => {
      if (!disposed && validChat(chatId)) open.current(chatId);
    };
    const url = new URL(location.href);
    if (validChat(url.searchParams.get('chat'))) {
      navigate(url.searchParams.get('chat'));
      url.searchParams.delete('chat');
      history.replaceState(history.state, '', url);
    }
    async function listen(handle: Promise<PluginListenerHandle>) {
      const value = await handle;
      if (disposed) await value.remove();
      else handles.push(value);
    }
    void (async () => {
      if (window.galinkaDesktop) {
        const bridge = window.galinkaDesktop.notifications;
        cleanups.push(bridge.onOpen(navigate));
        const status = await bridge.status();
        if (disposed) return;
        setBackground(status.background);
        set(!status.supported ? 'unavailable' : status.enabled ? 'enabled' : 'off');
        return;
      }
      if (isIOS && !installed) {
        set('install');
        return;
      }
      if (!nativePush && (isNative || !browserPush)) {
        set(isNative ? 'unconfigured' : 'unavailable');
        return;
      }
      const status = await api<{
        enabled: boolean;
        browserAvailable: boolean;
        publicKey: string | null;
      }>('/push/status');
      if (disposed) return;
      if (nativePush) {
        if (!status.enabled) {
          set('unconfigured');
          return;
        }
        await listen(
          PushNotifications.addListener('registration', async ({ value }) => {
            if (disposed) return;
            deviceToken = value;
            try {
              await api('/push/devices', 'POST', { token: value });
              if (!disposed) {
                preference(key, 'on');
                set('enabled');
              }
            } catch {
              set('error');
            }
          }),
        );
        await listen(PushNotifications.addListener('registrationError', () => set('error')));
        await listen(
          PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) =>
            navigate(notification.data?.chatId),
          ),
        );
        if (disposed) return;
        await PushNotifications.createChannel({
          id: 'messages',
          name: 'Сообщения',
          importance: 4,
          visibility: 0,
          sound: 'default',
        });
        const permission = await PushNotifications.checkPermissions();
        if (disposed) return;
        if (permission.receive === 'denied') set('denied');
        else if (preference(key) === 'on' && permission.receive === 'granted')
          await PushNotifications.register();
        else set('off');
        return;
      }
      publicKey.current = status.publicKey;
      if (!status.browserAvailable || !status.publicKey) {
        set('unconfigured');
        return;
      }
      const receive = (event: MessageEvent) => {
        if (event.source === navigator.serviceWorker.controller && event.data?.type === 'OPEN_CHAT')
          navigate(event.data.chatId);
      };
      navigator.serviceWorker.addEventListener('message', receive);
      cleanups.push(() => navigator.serviceWorker.removeEventListener('message', receive));
      if (Notification.permission === 'denied') {
        set('denied');
        return;
      }
      const registration = await worker();
      const subscription = await registration.pushManager.getSubscription();
      if (disposed) return;
      if (subscription && Notification.permission === 'granted' && preference(key) !== 'off') {
        // Rebind this device to the current authenticated session after signing in again.
        await api('/push/subscriptions', 'POST', subscription.toJSON());
        if (!disposed) {
          preference(key, 'on');
          set('enabled');
        }
      } else set('off');
    })().catch(() => set('error'));
    return () => {
      disposed = true;
      handles.forEach((handle) => {
        void handle.remove();
      });
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [userId, demo, retry]);
  async function toggle() {
    if (
      operation.current ||
      !userId ||
      demo ||
      ['busy', 'unavailable', 'unconfigured', 'install', 'denied'].includes(phase)
    )
      return;
    if (phase === 'error' && !initialized.current) {
      setRetry((value) => value + 1);
      return;
    }
    operation.current = true;
    const previous = phase;
    const currentUser = userId;
    // Safari requires the permission request to start directly in this click handler.
    const permissionRequest =
      !isNative && !window.galinkaDesktop && previous !== 'enabled'
        ? Notification.requestPermission()
        : undefined;
    setPhase('busy');
    try {
      if (previous === 'enabled') {
        await clearPushDevice();
        preference(key, 'off');
        if (identity.current === currentUser) setPhase('off');
      } else if (window.galinkaDesktop) {
        const status = await window.galinkaDesktop.notifications.setEnabled(true);
        if (identity.current === currentUser) {
          setBackground(status.background);
          setPhase(status.enabled ? 'enabled' : 'unavailable');
        }
      } else if (nativePush) {
        const permission = await PushNotifications.requestPermissions();
        if (identity.current !== currentUser) return;
        if (permission.receive !== 'granted') {
          setPhase('denied');
          return;
        }
        await PushNotifications.register();
      } else {
        const permission = await permissionRequest;
        if (identity.current !== currentUser) return;
        if (permission !== 'granted') {
          setPhase(permission === 'denied' ? 'denied' : 'off');
          return;
        }
        if (!publicKey.current) {
          const status = await api<{ publicKey: string | null }>('/push/status');
          if (!status.publicKey) {
            setPhase('unconfigured');
            return;
          }
          publicKey.current = status.publicKey;
        }
        const registration = await worker();
        const subscription =
          (await registration.pushManager.getSubscription()) ||
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationKey(publicKey.current!),
          }));
        if (identity.current !== currentUser) {
          await subscription.unsubscribe();
          return;
        }
        await api('/push/subscriptions', 'POST', subscription.toJSON());
        preference(key, 'on');
        if (identity.current === currentUser) setPhase('enabled');
      }
    } catch {
      if (identity.current === currentUser) setPhase('error');
    } finally {
      operation.current = false;
    }
  }
  function notify(chatId: string) {
    if (!demo && userId && phase === 'enabled' && validChat(chatId) && window.galinkaDesktop)
      void window.galinkaDesktop.notifications.show({ chatId }).catch(() => {});
  }
  return { phase, toggle, notify, background };
}
export function NotificationSettings({
  state,
  demo,
}: {
  state: ReturnType<typeof useNotifications>;
  demo: boolean;
}) {
  const desktop = Boolean(window.galinkaDesktop);
  const descriptions: Record<Phase, string> = {
    unavailable:
      'Уведомления не поддерживаются этим браузером. Откройте Galinka в приложении или другом браузере.',
    install:
      'На iPhone и iPad добавьте Galinka на экран «Домой» через меню «Поделиться», затем включите уведомления в приложении. Нужна iOS 16.4 или новее.',
    unconfigured: 'Уведомления временно недоступны. Попробуйте позже.',
    off: desktop
      ? 'Уведомлять о новых сообщениях, пока Galinka работает.'
      : 'Новые сообщения — даже когда Galinka закрыта.',
    denied: isNative
      ? 'Разрешите уведомления Galinka в настройках Android.'
      : 'Разрешите уведомления для Galinka в настройках браузера или устройства.',
    enabled: desktop
      ? state.background
        ? 'Galinka остаётся в трее после закрытия окна. «Выйти» в меню трея полностью завершает приложение.'
        : 'Уведомления приходят, пока приложение запущено.'
      : 'Уведомления включены на этом устройстве. Чаты без звука не беспокоят.',
    busy: 'Подключение…',
    error: 'Не удалось подключить уведомления. Повторите попытку.',
  };
  return (
    <section className="settings-section notification-settings">
      <div className="settings-row">
        <span className="settings-icon">
          {state.phase === 'enabled' ? <Bell size={22} /> : <BellOff size={22} />}
        </span>
        <div>
          <h3>Уведомления</h3>
          <p>{demo ? 'Недоступны в демоверсии.' : descriptions[state.phase]}</p>
        </div>
        {!demo && !['unavailable', 'unconfigured', 'denied', 'install'].includes(state.phase) && (
          <button
            className={`switch ${state.phase === 'enabled' ? 'on' : ''}`}
            role="switch"
            aria-label="Пуш-уведомления"
            aria-checked={state.phase === 'enabled'}
            disabled={state.phase === 'busy'}
            onClick={toggleSafe}
          >
            <span />
          </button>
        )}
      </div>
    </section>
  );
  function toggleSafe() {
    void state.toggle();
  }
}
