import { useEffect, useRef, useState } from 'react';
import { FileText, Link2, MessageSquare, Mic, Play, Video } from 'lucide-react';
import { api, API_BASE, isDemo } from './api';
import { getDemoFileUrl } from './demo';
import { fileLabel, isVideoNote } from './MediaAttachment';
import type { Attachment, LinkPreview } from './types';

type Kind = 'media' | 'file' | 'link' | 'voice';
type Item = {
  id: string;
  created_at: string;
  cursor: string;
  body: string;
  link_preview: LinkPreview | null;
  sender_name: string;
  file: Attachment | null;
};
const TABS: [Kind, string][] = [
  ['media', 'Медиа'],
  ['file', 'Файлы'],
  ['link', 'Ссылки'],
  ['voice', 'Голосовые'],
];
const EMPTY: Record<Kind, string> = {
  media: 'Фото и видео из этого чата появятся здесь.',
  file: 'Файлов пока нет.',
  link: 'Ссылок пока нет.',
  voice: 'Голосовых сообщений и кружков пока нет.',
};
const day = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', year: 'numeric' });
const size = (bytes: number) =>
  bytes < 1048576
    ? `${Math.max(1, Math.round(bytes / 1024))} КБ`
    : `${(bytes / 1048576).toFixed(1).replace('.', ',')} МБ`;
const fileUrl = (id: string) =>
  isDemo() ? getDemoFileUrl(id) : `${API_BASE}/files/${encodeURIComponent(id)}?inline=1`;
const linksIn = (text: string) => text.match(/https?:\/\/[^\s<>"']+/g) ?? [];

/** The chat profile's shared content: photos and videos, files, links, voice messages and circles. */
export function ChatMedia({
  chatId,
  onOpen,
}: {
  chatId: string;
  onOpen: (messageId: string) => void;
}) {
  const [tab, setTab] = useState<Kind>('media');
  const [loaded, setLoaded] = useState<{ kind: Kind; items: Item[] }>({ kind: 'media', items: [] });
  // Never draw one tab's items under another: they differ in shape.
  const items = loaded.kind === tab ? loaded.items : [];
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  /** Answers to a tab the user already left must not land in the new one. */
  const current = useRef(0);

  async function load(kind: Kind, before?: string) {
    const ticket = ++current.current;
    setLoading(true);
    setFailed(false);
    try {
      const page = await api<{ items: Item[]; more: boolean }>(
        `/chats/${chatId}/media?type=${kind}${before ? `&before=${encodeURIComponent(before)}` : ''}`,
      );
      if (ticket !== current.current) return;
      setLoaded((previous) => ({
        kind,
        items: before && previous.kind === kind ? [...previous.items, ...page.items] : page.items,
      }));
      setMore(page.more);
    } catch {
      if (ticket === current.current) setFailed(true);
    } finally {
      if (ticket === current.current) setLoading(false);
    }
  }
  useEffect(() => {
    setMore(false);
    setLoaded({ kind: tab, items: [] });
    void load(tab);
    return () => {
      ++current.current;
    };
  }, [chatId, tab]);

  return (
    <div className="info-section chat-media">
      <h4>Медиа и файлы</h4>
      <div className="media-tabs" role="tablist" aria-label="Что показать">
        {TABS.map(([kind, label]) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={tab === kind}
            onClick={() => setTab(kind)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'media' ? (
        <div className="media-grid">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-label={`${fileLabel(item.file!.name)} от ${item.sender_name}, ${day.format(new Date(item.created_at))}`}
              onClick={() => onOpen(item.id)}
            >
              {item.file!.mime?.startsWith('video/') ? (
                <>
                  {item.file!.thumb ? (
                    <img src={item.file!.thumb} alt="" loading="lazy" />
                  ) : (
                    <video
                      src={`${fileUrl(item.file!.id)}#t=0.1`}
                      preload="metadata"
                      muted
                      playsInline
                    />
                  )}
                  <Play size={18} aria-hidden="true" />
                </>
              ) : (
                <img src={fileUrl(item.file!.id)} alt="" loading="lazy" />
              )}
            </button>
          ))}
        </div>
      ) : (
        <ul className="media-list">
          {items.map((item) => (
            <li key={item.id}>
              {tab === 'link' ? (
                <>
                  <Link2 size={20} aria-hidden="true" />
                  <span>
                    {item.link_preview && <strong>{item.link_preview.title}</strong>}
                    {linksIn(item.body).map((url) => (
                      <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                        {url}
                      </a>
                    ))}
                    <small>
                      {item.sender_name} · {day.format(new Date(item.created_at))}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Показать в чате"
                    title="Показать в чате"
                    onClick={() => onOpen(item.id)}
                  >
                    <MessageSquare size={18} />
                  </button>
                </>
              ) : (
                <button type="button" className="media-row" onClick={() => onOpen(item.id)}>
                  {tab === 'voice' ? (
                    isVideoNote(item.file!) ? (
                      <Video size={20} />
                    ) : (
                      <Mic size={20} />
                    )
                  ) : (
                    <FileText size={20} />
                  )}
                  <span>
                    <strong>
                      {tab === 'voice' ? fileLabel(item.file!.name) : item.file!.name}
                    </strong>
                    <small>
                      {tab === 'file' && `${size(item.file!.size)} · `}
                      {item.sender_name} · {day.format(new Date(item.created_at))}
                    </small>
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!loading && !failed && !items.length && <p className="media-empty">{EMPTY[tab]}</p>}
      {failed && (
        <p className="media-empty" role="alert">
          Не удалось загрузить.{' '}
          <button
            type="button"
            className="text-button"
            onClick={() => void load(tab, items.at(-1)?.cursor)}
          >
            Повторить
          </button>
        </p>
      )}
      {more && !loading && !failed && (
        <button
          type="button"
          className="text-button"
          onClick={() => void load(tab, items.at(-1)?.cursor)}
        >
          Показать ещё
        </button>
      )}
    </div>
  );
}
