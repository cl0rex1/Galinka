import { useEffect, useRef, useState } from 'react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { Bell, BellOff } from 'lucide-react';
import { api } from './api';

export const isNative = Capacitor.getPlatform() === 'android';
const nativePush = isNative && import.meta.env.VITE_NATIVE_PUSH === 'true';
let deviceToken: string | undefined;
type Phase = 'unavailable' | 'unconfigured' | 'off' | 'denied' | 'enabled' | 'busy' | 'error';
export async function clearPushDevice() {
  if (!nativePush) return;
  // The server also revokes devices with their session on logout/expiry.
  if (deviceToken) await api('/push/devices', 'DELETE', { token: deviceToken });
  await PushNotifications.removeAllDeliveredNotifications();
  await PushNotifications.unregister();
  deviceToken = undefined;
}
export function useNotifications(
  userId: string | undefined,
  demo: boolean,
  onOpen: (chatId: string) => void,
) {
  const [phase, setPhase] = useState<Phase>(
    nativePush ? 'busy' : isNative ? 'unconfigured' : 'unavailable',
  );
  const open = useRef(onOpen);
  open.current = onOpen;
  const initialized = useRef<Promise<void>>(Promise.resolve());
  const key = `galinka-push-${userId}`;
  useEffect(() => {
    if (!nativePush || !userId || demo) return;
    let disposed = false;
    const handles: PluginListenerHandle[] = [];
    async function listen(handle: Promise<PluginListenerHandle>) {
      const value = await handle;
      if (disposed) await value.remove();
      else handles.push(value);
    }
    initialized.current = (async () => {
      const { enabled } = await api<{ enabled: boolean }>('/push/status');
      if (disposed) return;
      if (!enabled) {
        setPhase('unconfigured');
        return;
      }
      await listen(
        PushNotifications.addListener('registration', async ({ value }) => {
          if (disposed) return;
          deviceToken = value;
          try {
            await api('/push/devices', 'POST', { token: value });
            if (!disposed) {
              localStorage.setItem(key, 'on');
              setPhase('enabled');
            }
          } catch {
            if (!disposed) setPhase('error');
          }
        }),
      );
      await listen(
        PushNotifications.addListener('registrationError', () => {
          if (!disposed) setPhase('error');
        }),
      );
      await listen(
        PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
          const chatId = notification.data?.chatId;
          if (!disposed && typeof chatId === 'string' && /^[0-9a-f-]{36}$/i.test(chatId))
            open.current(chatId);
        }),
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
      if (permission.receive === 'denied') setPhase('denied');
      else if (localStorage.getItem(key) === 'on' && permission.receive === 'granted')
        await PushNotifications.register();
      else setPhase('off');
    })().catch(() => {
      if (!disposed) setPhase('error');
    });
    return () => {
      disposed = true;
      handles.forEach((handle) => {
        void handle.remove();
      });
    };
  }, [userId, demo]);
  async function toggle() {
    const previous = phase;
    setPhase('busy');
    try {
      await initialized.current;
      if (previous === 'enabled') {
        await clearPushDevice();
        localStorage.removeItem(key);
        setPhase('off');
      } else {
        let permission = await PushNotifications.checkPermissions();
        if (permission.receive !== 'granted')
          permission = await PushNotifications.requestPermissions();
        if (permission.receive !== 'granted') {
          setPhase('denied');
          return;
        }
        await PushNotifications.register();
      }
    } catch {
      setPhase('error');
    }
  }
  return { phase, toggle };
}
export function NotificationSettings({
  state,
  demo,
}: {
  state: ReturnType<typeof useNotifications>;
  demo: boolean;
}) {
  const descriptions: Record<Phase, string> = {
    unavailable: 'Фоновые уведомления доступны в Android-приложении.',
    unconfigured: 'Пуши пока не подключены.',
    off: 'Сообщения, даже когда приложение закрыто.',
    denied: 'Разрешите уведомления в настройках Android.',
    enabled: 'Уведомления включены на этом устройстве.',
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
        {!demo && !['unavailable', 'unconfigured', 'denied'].includes(state.phase) && (
          <button
            className={`switch ${state.phase === 'enabled' ? 'on' : ''}`}
            role="switch"
            aria-label="Пуш-уведомления"
            aria-checked={state.phase === 'enabled'}
            disabled={state.phase === 'busy'}
            onClick={state.toggle}
          >
            <span />
          </button>
        )}
      </div>
    </section>
  );
}
