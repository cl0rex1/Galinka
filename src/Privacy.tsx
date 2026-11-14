import { useEffect, useState } from 'react';
import { api } from './api';
import { playTone, readInAppAlerts, saveInAppAlerts } from './sounds';

type Account = {
  show_last_seen: boolean;
  group_invites: 'all' | 'nobody';
  notify_preview: 'full' | 'sender' | 'none';
  notify_direct: boolean;
  notify_groups: boolean;
  mention_policy: 'all' | 'known' | 'none';
  quiet_from: number | null;
  quiet_to: number | null;
};
/** What PATCH /me/settings takes beyond the stored fields. */
type AccountChange = Partial<Account> & {
  quiet_hours?: { from: number; to: number } | null;
  time_zone?: string;
};

/** Account settings kept on the server, so they hold on every device and for pushes. */
function useAccount() {
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<Partial<Account>>('/me')
      .then((me) =>
        setAccount({
          show_last_seen: me.show_last_seen ?? true,
          group_invites: me.group_invites ?? 'all',
          notify_preview: me.notify_preview ?? 'full',
          notify_direct: me.notify_direct ?? true,
          notify_groups: me.notify_groups ?? true,
          mention_policy: me.mention_policy ?? 'all',
          quiet_from: me.quiet_from ?? null,
          quiet_to: me.quiet_to ?? null,
        }),
      )
      .catch((cause) => setError((cause as Error).message));
  }, []);
  // Applied at once; put back if the server refuses.
  async function update(change: AccountChange) {
    const before = account;
    const { quiet_hours, time_zone: _zone, ...stored } = change;
    const shown: Partial<Account> =
      quiet_hours === undefined
        ? stored
        : { ...stored, quiet_from: quiet_hours?.from ?? null, quiet_to: quiet_hours?.to ?? null };
    setAccount((current) => current && { ...current, ...shown });
    setError('');
    try {
      await api('/me/settings', 'PATCH', change);
    } catch (cause) {
      setAccount(before);
      setError((cause as Error).message);
    }
  }
  return { account, update, error };
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <div
      className="segmented"
      role="group"
      aria-label={label}
      style={{ '--options': options.length } as never}
    >
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          className={value === id ? 'selected' : ''}
          aria-pressed={value === id}
          disabled={value === undefined}
          onClick={() => onChange(id)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function PrivacySettings() {
  const { account, update, error } = useAccount();
  return (
    <>
      <section className="settings-section">
        <h2>Последняя активность</h2>
        <Choice
          label="Кто видит, когда вы в сети"
          value={account ? (account.show_last_seen ? 'all' : 'nobody') : undefined}
          options={[
            ['all', 'Все'],
            ['nobody', 'Никто'],
          ]}
          onChange={(value) => void update({ show_last_seen: value === 'all' })}
        />
        <p className="settings-hint">
          {account?.show_last_seen === false
            ? 'Другие видят только «был(а) недавно». Взамен вы тоже не видите, когда были в сети они.'
            : 'Собеседники видят «в сети» и время последнего захода.'}
        </p>
      </section>
      <section className="settings-section">
        <h2>Добавление в группы</h2>
        <Choice
          label="Кто может добавлять вас в группы"
          value={account?.group_invites}
          options={[
            ['all', 'Все'],
            ['nobody', 'Никто'],
          ]}
          onChange={(group_invites) => void update({ group_invites })}
        />
        <p className="settings-hint">
          {account?.group_invites === 'nobody'
            ? 'В группу можно попасть только по ссылке-приглашению, которую вы откроете сами.'
            : 'Владелец группы может добавить вас без вопросов.'}
        </p>
      </section>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** Settings → General: what a notification shows. */
export function PreviewSettings() {
  const { account, update, error } = useAccount();
  return (
    <section className="settings-section">
      <h2>Текст уведомлений</h2>
      <Choice
        label="Что показывать в уведомлении"
        value={account?.notify_preview}
        options={[
          ['full', 'Автор и текст'],
          ['sender', 'Только автор'],
          ['none', 'Ничего'],
        ]}
        onChange={(notify_preview) => void update({ notify_preview })}
      />
      <p className="settings-hint">
        {account?.notify_preview === 'none'
          ? 'Только «Новое сообщение», без имени и текста.'
          : account?.notify_preview === 'sender'
            ? 'Видно, кто написал, но не что.'
            : 'Как в Telegram: кто написал и начало сообщения. На Android текст проходит через службу уведомлений Google.'}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

const clockText = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const clockMinutes = (text: string) => {
  const [hours, minutes] = text.split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
};
const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function Switch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean | undefined;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`switch ${checked ? 'on' : ''}`}
      role="switch"
      aria-label={label}
      aria-checked={!!checked}
      disabled={disabled || checked === undefined}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

/** Settings → General: which chats notify, who may mention you, quiet hours, in-app alerts. */
export function NotificationPreferences() {
  const { account, update, error } = useAccount();
  const [alerts, setAlerts] = useState(readInAppAlerts);
  const quiet = account && account.quiet_from !== null && account.quiet_to !== null;
  const setQuiet = (from: number, to: number) =>
    void update({ quiet_hours: { from, to }, time_zone: localZone() });
  const setAlert = (change: Partial<typeof alerts>) => {
    const next = { ...alerts, ...change };
    setAlerts(next);
    saveInAppAlerts(next);
    if (change.sound) playTone('default');
    if (change.vibrate) navigator.vibrate?.(30);
  };
  return (
    <>
      <section className="settings-section">
        <h2>Какие чаты уведомляют</h2>
        <div className="settings-row">
          <div>
            <h3>Личные чаты</h3>
          </div>
          <Switch
            label="Уведомления из личных чатов"
            checked={account?.notify_direct}
            onChange={(notify_direct) => void update({ notify_direct })}
          />
        </div>
        <div className="settings-row">
          <div>
            <h3>Группы</h3>
          </div>
          <Switch
            label="Уведомления из групп"
            checked={account?.notify_groups}
            onChange={(notify_groups) => void update({ notify_groups })}
          />
        </div>
        <p className="settings-hint">
          Упоминания приходят всегда, даже из групп без звука. Отдельный чат можно выключить в
          его профиле.
        </p>
      </section>
      <section className="settings-section">
        <h2>Упоминания</h2>
        <Choice
          label="Кто может упоминать вас"
          value={account?.mention_policy}
          options={[
            ['all', 'Все'],
            ['known', 'Знакомые'],
            ['none', 'Никто'],
          ]}
          onChange={(mention_policy) => void update({ mention_policy })}
        />
        <p className="settings-hint">
          {account?.mention_policy === 'none'
            ? '@ваш_логин в группах остаётся просто текстом: ни значка, ни уведомления.'
            : account?.mention_policy === 'known'
              ? 'Упоминание считается, только если с этим человеком у вас есть личный чат.'
              : 'Любой участник общей группы может позвать вас через @логин.'}
        </p>
      </section>
      <section className="settings-section">
        <h2>Тихие часы</h2>
        <div className="settings-row">
          <div>
            <h3>Без звука по расписанию</h3>
            <p>Уведомления приходят, но не звенят и не вибрируют.</p>
          </div>
          <Switch
            label="Тихие часы"
            checked={account ? !!quiet : undefined}
            onChange={(on) =>
              on
                ? setQuiet(22 * 60, 8 * 60)
                : void update({ quiet_hours: null, time_zone: localZone() })
            }
          />
        </div>
        {quiet && (
          <div className="quiet-hours">
            <label>
              С
              <input
                type="time"
                value={clockText(account.quiet_from!)}
                onChange={(event) => {
                  const from = clockMinutes(event.target.value);
                  if (from !== null) setQuiet(from, account.quiet_to!);
                }}
              />
            </label>
            <label>
              до
              <input
                type="time"
                value={clockText(account.quiet_to!)}
                onChange={(event) => {
                  const to = clockMinutes(event.target.value);
                  if (to !== null) setQuiet(account.quiet_from!, to);
                }}
              />
            </label>
          </div>
        )}
      </section>
      <section className="settings-section">
        <h2>Когда Galinka открыта</h2>
        <div className="settings-row">
          <div>
            <h3>Звук новых сообщений</h3>
          </div>
          <Switch
            label="Звук новых сообщений"
            checked={alerts.sound}
            onChange={(sound) => setAlert({ sound })}
          />
        </div>
        {'vibrate' in navigator && (
          <div className="settings-row">
            <div>
              <h3>Вибрация</h3>
            </div>
            <Switch
              label="Вибрация"
              checked={alerts.vibrate}
              onChange={(vibrate) => setAlert({ vibrate })}
            />
          </div>
        )}
        <p className="settings-hint">На этом устройстве. Свой звук для чата — в его профиле.</p>
      </section>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
