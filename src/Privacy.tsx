import { useEffect, useState } from 'react';
import { api } from './api';

type Account = {
  show_last_seen: boolean;
  group_invites: 'all' | 'nobody';
  notify_preview: 'full' | 'sender' | 'none';
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
        }),
      )
      .catch((cause) => setError((cause as Error).message));
  }, []);
  // Applied at once; put back if the server refuses.
  async function update(change: Partial<Account>) {
    const before = account;
    setAccount((current) => current && { ...current, ...change });
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
