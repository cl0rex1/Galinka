import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from './api';
import type { Announcement, Page } from './types';

export function Announcements() {
  const [data, setData] = useState<Page<Announcement>>({ items: [], total: 0, page: 1 });
  const [page, setPage] = useState(1),
    [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    request.current?.abort();
    const current = new AbortController();
    request.current = current;
    setBusy(true);
    setError('');
    try {
      const result = await api<Page<Announcement>>(
        `/announcements?page=${page}`,
        'GET',
        undefined,
        { signal: current.signal },
      );
      if (!current.signal.aborted) setData(result);
    } catch (e) {
      if (!current.signal.aborted) setError((e as Error).message);
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  }, [page]);
  useEffect(() => {
    void load();
    return () => request.current?.abort();
  }, [load]);
  return (
    <section className="announcement-feed" aria-labelledby="announcements-title">
      <div className="announcement-heading">
        <div>
          <h2 id="announcements-title">Объявления</h2>
        </div>
        <button className="secondary" onClick={load} disabled={busy}>
          <RefreshCw size={16} />
          Обновить
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {busy ? (
        <p role="status" className="muted">
          Загрузка…
        </p>
      ) : !error && !data.items.length ? (
        <p className="muted">Объявлений пока нет.</p>
      ) : (
        data.page === page &&
        data.items.map((item) => (
          <article className="announcement" key={item.id}>
            <time dateTime={item.updated_at}>
              {new Date(item.updated_at).toLocaleDateString('ru')}
            </time>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </article>
        ))
      )}
      {data.total > 50 && (
        <div className="admin-pagination">
          <button
            className="secondary"
            disabled={busy || page === 1}
            onClick={() => setPage(page - 1)}
          >
            Назад
          </button>
          <span>Страница {page}</span>
          <button
            className="secondary"
            disabled={busy || page * 50 >= data.total}
            onClick={() => setPage(page + 1)}
          >
            Далее
          </button>
        </div>
      )}
    </section>
  );
}
