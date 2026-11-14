import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { api } from './api';
import type { MonitoringData } from './types';

const timeFormat = new Intl.DateTimeFormat('ru', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function formatUptime(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} д ${h} ч`;
  if (h > 0) return `${h} ч ${m} м`;
  if (m > 0) return `${m} м`;
  return `${seconds} с`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
}

export function AdminMonitor() {
  const [data, setData] = useState<MonitoringData | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api<MonitoringData>('/admin/monitoring'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function clearErrors() {
    setBusy(true);
    setError('');
    try {
      await api('/admin/client-errors', 'DELETE');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="admin-title">
        <div>
          <h1>Мониторинг</h1>
          <p className="muted">Состояние сервера, метрики и журнал ошибок клиента.</p>
        </div>
        <button className="secondary" disabled={loading || busy} onClick={() => void load()}>
          <RefreshCw size={16} />
          Обновить
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading && !data && <p role="status">Загружаем метрики…</p>}
      {data && (
        <>
          <div className="admin-metrics">
            <div className="admin-metric">
              <span>Состояние</span>
              <strong>
                <span className={`admin-state ${data.health.ok ? '' : 'is-blocked'}`}>
                  {data.health.ok ? 'Работает' : 'Не готов'}
                </span>
              </strong>
              <small>
                Версия {data.health.version} ({data.health.build})
              </small>
            </div>
            <div className="admin-metric">
              <span>Время работы</span>
              <strong>{formatUptime(data.health.uptimeSeconds)}</strong>
              <small>Память: {formatBytes(data.health.memoryBytes)}</small>
            </div>
            <div className="admin-metric">
              <span>Подключения SSE</span>
              <strong>{data.metrics.activeStreams}</strong>
              <small>В сети пользователей: {data.metrics.onlineUsers}</small>
            </div>
            <div className="admin-metric">
              <span>Запросы API</span>
              <strong>{data.metrics.requests.total}</strong>
              <small>
                4xx: {data.metrics.requests.clientError} · 5xx: {data.metrics.requests.serverError}
              </small>
            </div>
            <div className="admin-metric">
              <span>База и файлы</span>
              <strong>{data.metrics.messages} сообщ.</strong>
              <small>
                {data.metrics.users} польз. · {data.metrics.chats} чатов ·{' '}
                {formatBytes(data.metrics.storageBytes)}
              </small>
            </div>
            <div className="admin-metric">
              <span>Очередь пушей</span>
              <strong>{data.metrics.pushQueue}</strong>
              <small>Ошибок клиента: {data.metrics.clientErrors}</small>
            </div>
          </div>
          <div className="admin-toolbar">
            <h2>Журнал ошибок клиента ({data.metrics.clientErrors})</h2>
            {data.errors.length > 0 && (
              <button
                className="secondary"
                disabled={loading || busy}
                onClick={() => void clearErrors()}
              >
                <Trash2 size={16} />
                Очистить журнал
              </button>
            )}
          </div>
          <div className="admin-table-wrap">
            {data.errors.length ? (
              <div className="admin-errors">
                {data.errors.map((entry) => (
                  <article className="admin-error-item" key={entry.id}>
                    <header>
                      <strong>{entry.message}</strong>
                      <time dateTime={entry.created_at}>
                        {timeFormat.format(new Date(entry.created_at))}
                      </time>
                    </header>
                    <p className="muted">
                      {entry.username ? `@${entry.username}` : 'Гость'}
                      {entry.url ? ` · ${entry.url}` : ''}
                      {entry.release ? ` · ${entry.release}` : ''}
                    </p>
                    {entry.stack && <pre>{entry.stack}</pre>}
                  </article>
                ))}
              </div>
            ) : (
              <p className="admin-empty">Ошибок клиента не зафиксировано.</p>
            )}
          </div>
        </>
      )}
    </>
  );
}
