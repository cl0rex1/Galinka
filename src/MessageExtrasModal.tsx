import { useEffect, useState } from 'react';
import { Clock3, Plus, Send, Timer, Trash2, X } from 'lucide-react';
import { api } from './api';

import { CloseButton, Modal } from './ui';
import type { Chat, Message, MessageEdit, ScheduledMessage } from './types';

const dateTimeFmt = new Intl.DateTimeFormat('ru', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function toLocalDateTimeInput(msFromNow: number): string {
  const d = new Date(Date.now() + msFromNow);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ScheduleMessageModal({
  chat,
  initialBody,
  onClose,
  onSchedule,
}: {
  chat: Chat;
  initialBody: string;
  onClose: () => void;
  onSchedule: (whenIso: string, body: string) => Promise<void>;
}) {
  const [when, setWhen] = useState(() => toLocalDateTimeInput(10 * 60_000));
  const [body, setBody] = useState(initialBody);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isSaved = chat.kind === 'saved';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ts = Date.parse(when);
    if (!Number.isFinite(ts) || ts <= Date.now()) {
      setError('Выберите время в будущем.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSchedule(new Date(ts).toISOString(), body.trim());
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Не удалось запланировать.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      error={error}
      title={isSaved ? 'Напоминание в Избранном' : 'Отложенная отправка'}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <label>
          Текст
          <textarea
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={8000}
            required
          />
        </label>
        <div className="schedule-presets">
          {[
            ['Через 1 мин', 60_000],
            ['Через 15 мин', 15 * 60_000],
            ['Через час', 3600_000],
            ['Завтра', 24 * 3600_000],
          ].map(([label, offset]) => (
            <button
              key={label}
              type="button"
              className="secondary"
              onClick={() => setWhen(toLocalDateTimeInput(Number(offset)))}
            >
              {label}
            </button>
          ))}
        </div>
        <label>
          Дата и время
          <input
            type="datetime-local"
            value={when}
            min={toLocalDateTimeInput(60_000)}
            onChange={(e) => setWhen(e.target.value)}
            required
          />
        </label>
        <div className="modal-actions">
          <CloseButton>Отмена</CloseButton>
          <button type="submit" className="primary" disabled={busy || !body.trim()}>
            <Clock3 size={16} />
            {isSaved ? 'Поставить напоминание' : 'Запланировать'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ScheduledListModal({
  chat,
  onClose,
  onChanged,
  report,
}: {
  chat: Chat;
  onClose: () => void;
  onChanged: () => void;
  report: (e: unknown) => void;
}) {
  const [items, setItems] = useState<ScheduledMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api<ScheduledMessage[]>(`/chats/${chat.id}/scheduled`)
      .then(setItems)
      .catch(report)
      .finally(() => setLoading(false));
  };

  useEffect(load, [chat.id]);

  async function sendNow(id: string) {
    setBusyId(id);
    try {
      await api(`/chats/${chat.id}/scheduled/${id}/send`, 'POST');
      onChanged();
      load();
    } catch (e) {
      report(e);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    try {
      await api(`/chats/${chat.id}/scheduled/${id}`, 'DELETE');
      onChanged();
      load();
    } catch (e) {
      report(e);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal
      error=""
      title={chat.kind === 'saved' ? 'Напоминания и отложенные' : 'Отложенные сообщения'}
      onClose={onClose}
    >
      {loading ? (
        <p className="muted">Загрузка…</p>
      ) : items.length === 0 ? (
        <p className="muted">Нет запланированных сообщений.</p>
      ) : (
        <ul className="scheduled-list">
          {items.map((item) => (
            <li key={item.id} className="scheduled-item">
              <div className="scheduled-item-body">
                <strong>
                  {item.is_reminder ? 'Напоминание · ' : ''}
                  {dateTimeFmt.format(new Date(item.scheduled_for))}
                </strong>
                <p>{item.body || item.file_name || 'Вложение'}</p>
              </div>
              <div className="scheduled-item-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={busyId === item.id}
                  onClick={() => void sendNow(item.id)}
                  title="Отправить сейчас"
                >
                  <Send size={14} />
                  Сейчас
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={busyId === item.id}
                  onClick={() => void remove(item.id)}
                  aria-label="Удалить отложенное"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export function PollCreatorModal({
  chatId,
  onClose,
  onCreated,
  report,
}: {
  chatId: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
  report: (e: unknown) => void;
}) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);

  const validOptions = options.map((o) => o.trim()).filter(Boolean);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || validOptions.length < 2) return;
    setBusy(true);
    try {
      await api(`/chats/${chatId}/polls`, 'POST', {
        question: question.trim(),
        options: validOptions,
        multiple,
        anonymous,
        nonce: crypto.randomUUID(),
      });
      await onCreated();
      onClose();
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal error="" title="Создать опрос" onClose={onClose}>
      <form onSubmit={submit} className="poll-creator-form">
        <label>
          Вопрос
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="О чём спросим?"
            maxLength={300}
            required
            autoFocus
          />
        </label>
        <div className="poll-options-edit">
          <span>Варианты ответа</span>
          {options.map((opt, idx) => (
            <div key={idx} className="poll-option-input-row">
              <input
                value={opt}
                onChange={(e) =>
                  setOptions((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))
                }
                placeholder={`Вариант ${idx + 1}`}
                maxLength={120}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Удалить вариант"
                  onClick={() => setOptions((prev) => prev.filter((_, i) => i !== idx))}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          ))}
          {options.length < 10 && (
            <button
              type="button"
              className="secondary"
              onClick={() => setOptions((prev) => [...prev, ''])}
            >
              <Plus size={15} />
              Добавить вариант
            </button>
          )}
        </div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={multiple}
            onChange={(e) => setMultiple(e.target.checked)}
          />
          <span>Несколько вариантов ответа</span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
          />
          <span>Анонимное голосование</span>
        </label>
        <div className="modal-actions">
          <CloseButton>Отмена</CloseButton>
          <button
            type="submit"
            className="primary"
            disabled={busy || !question.trim() || validOptions.length < 2}
          >
            Создать опрос
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function EditHistoryModal({
  message,
  onClose,
  report,
}: {
  message: Message;
  onClose: () => void;
  report: (e: unknown) => void;
}) {
  const [data, setData] = useState<{ current: string; edits: MessageEdit[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api<{ current: string; edits: MessageEdit[] }>(
      `/chats/${message.chat_id}/messages/${message.id}/edits`,
    )
      .then(setData)
      .catch(report)
      .finally(() => setLoading(false));
  }, [message.chat_id, message.id]);

  return (
    <Modal error="" title="История изменений" onClose={onClose}>
      {loading ? (
        <p className="muted">Загрузка…</p>
      ) : (
        <div className="edit-history-list">
          <div className="edit-history-entry current">
            <span className="muted">Текущая версия</span>
            <p>{data?.current || message.body}</p>
          </div>
          {data?.edits?.length ? (
            data.edits.map((entry) => (
              <div key={entry.id} className="edit-history-entry">
                <span className="muted">{dateTimeFmt.format(new Date(entry.edited_at))}</span>
                <p>{entry.previous_body}</p>
              </div>
            ))
          ) : (
            <p className="muted">Предыдущих версий не сохранилось.</p>
          )}
        </div>
      )}
    </Modal>
  );
}

export function AutoDeleteModal({
  chat,
  onClose,
  onSelect,
}: {
  chat: Chat;
  onClose: () => void;
  onSelect: (seconds: number | null) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const options: { label: string; seconds: number | null }[] = [
    { label: 'Выключено', seconds: null },
    { label: '30 секунд', seconds: 30 },
    { label: '5 минут', seconds: 300 },
    { label: '1 час', seconds: 3600 },
    { label: '24 часа', seconds: 86400 },
    { label: '7 дней', seconds: 7 * 86400 },
  ];

  return (
    <Modal error={error} title="Автоудаление сообщений" onClose={onClose}>
      <p className="muted">
        Новые сообщения в этом чате удалятся у всех участников через выбранное время. Уже
        отправленные останутся.
      </p>
      <div className="auto-delete-options">
        {options.map((opt) => {
          const active = (chat.auto_delete_seconds ?? null) === opt.seconds;
          return (
            <button
              key={opt.label}
              type="button"
              disabled={busy}
              className={`auto-delete-option ${active ? 'selected' : ''}`}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await onSelect(opt.seconds);
                  onClose();
                } catch (e) {
                  setError((e as Error).message || 'Не удалось изменить таймер.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Timer size={16} />
              <span>{opt.label}</span>
              {active && <strong>Выбрано</strong>}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
