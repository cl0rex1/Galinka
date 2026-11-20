import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import {
  Download,
  ExternalLink,
  FileText,
  Images,
  Link2,
  LoaderCircle,
  MessageSquare,
  Mic,
  Play,
} from 'lucide-react';
import { api } from './api';
import { AudioPlayer } from './AudioPlayer';
import { fileLabel, fileUrl, GalleryViewer, isVideoNote } from './MediaAttachment';
import { messageAddress, plainText } from './MessageText';
import type { Attachment, LinkPreview } from './types';

const tabs = [
  {
    kind: 'media',
    label: 'Медиа',
    icon: Images,
    empty: 'Фото и видео из этого чата появятся здесь.',
  },
  { kind: 'file', label: 'Файлы', icon: FileText, empty: 'Файлов пока нет.' },
  { kind: 'link', label: 'Ссылки', icon: Link2, empty: 'Ссылок пока нет.' },
  {
    kind: 'voice',
    label: 'Голосовые',
    icon: Mic,
    empty: 'Голосовых сообщений и кружков пока нет.',
  },
] as const;
type Tab = (typeof tabs)[number];
type Item = {
  id: string;
  created_at: string;
  cursor: string;
  body: string;
  link_preview: LinkPreview | null;
  sender_name: string;
  file: Attachment | null;
};
type Props = {
  chatId: string;
  onOpen: (messageId: string) => void;
  onDownload: (file: Attachment) => void;
};
const month = new Intl.DateTimeFormat('ru', { month: 'long', year: 'numeric' });
const day = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' });
const size = (bytes: number) =>
  bytes < 1048576
    ? `${Math.max(1, Math.round(bytes / 1024))} КБ`
    : `${(bytes / 1048576).toFixed(1).replace('.', ',')} МБ`;

export function ChatMedia(props: Props) {
  const [index, setIndex] = useState(0);
  const id = useId();
  const tab = tabs[index];
  function navigate(event: KeyboardEvent<HTMLButtonElement>) {
    let next = index;
    switch (event.key) {
      case 'ArrowRight':
        next = (index + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        next = (index + tabs.length - 1) % tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    setIndex(next);
    event.currentTarget.parentElement?.querySelectorAll('button')[next]?.focus();
  }
  return (
    <section className="info-section chat-media" aria-labelledby={id + '-heading'}>
      <h4 id={id + '-heading'}>Вложения чата</h4>
      <div className="media-tab-bar">
        <div
          className="media-tabs"
          role="tablist"
          aria-label="Вложения чата"
          style={{ '--tab-index': index } as CSSProperties}
        >
          {tabs.map(({ kind, label, icon: Icon }, i) => (
            <button
              key={kind}
              type="button"
              role="tab"
              id={id + kind}
              aria-controls={id + '-panel'}
              aria-selected={index === i}
              tabIndex={index === i ? 0 : -1}
              onKeyDown={navigate}
              onClick={() => setIndex(i)}
            >
              <Icon size={17} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel" id={id + '-panel'} aria-labelledby={id + tab.kind} tabIndex={0}>
        <MediaPage key={props.chatId + tab.kind} {...props} tab={tab} />
      </div>
    </section>
  );
}

function MediaPage({ chatId, tab, onOpen, onDownload }: Props & { tab: Tab }) {
  const [items, setItems] = useState<Item[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const current = useRef(0);
  async function load(before?: string) {
    const ticket = ++current.current;
    setLoading(true);
    setFailed(false);
    try {
      const page = await api<{ items: Item[]; more: boolean }>(
        `/chats/${chatId}/media?type=${tab.kind}${before ? '&before=' + encodeURIComponent(before) : ''}`,
      );
      if (ticket !== current.current) return;
      setItems((previous) => (before ? [...previous, ...page.items] : page.items));
      setMore(page.more);
    } catch {
      if (ticket === current.current) setFailed(true);
    } finally {
      if (ticket === current.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      ++current.current;
    };
  }, [chatId, tab.kind]);

  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const label = month.format(new Date(item.created_at));
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(item);
  }
  const selectedIndex = items.findIndex((item) => item.id === selected);
  const opened = items[selectedIndex];
  const Icon = tab.icon;
  return (
    <div className="library-content">
      {Array.from(groups, ([label, group]) => (
        <div className="library-month" key={label}>
          <h5>{label}</h5>
          {tab.kind === 'media' ? (
            <div className="media-grid">
              {group.map(({ id, file, sender_name, created_at }) => {
                if (!file) return null;
                const video = file.mime?.startsWith('video/');
                const url = fileUrl(file);
                return (
                  <button
                    type="button"
                    key={id}
                    onClick={() => setSelected(id)}
                    aria-label={`${file.name} · ${sender_name}, ${day.format(new Date(created_at))}`}
                  >
                    {video && !file.thumb ? (
                      <video src={url && url + '#t=0.1'} preload="metadata" muted playsInline />
                    ) : (
                      <img src={(video && file.thumb) || url} loading="lazy" alt="" />
                    )}
                    {video && <Play size={22} fill="currentColor" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          ) : (
            <ul className="media-list">
              {group.map((item) => (
                <LibraryRow
                  key={item.id}
                  item={item}
                  kind={tab.kind}
                  onOpen={onOpen}
                  onDownload={onDownload}
                  onPlay={setSelected}
                />
              ))}
            </ul>
          )}
        </div>
      ))}
      {loading && (
        <p className="library-state" role="status">
          <LoaderCircle className="spin" size={18} /> Загрузка…
        </p>
      )}
      {!loading && !failed && !items.length && (
        <div className="library-state">
          <Icon size={24} aria-hidden="true" />
          <p>{tab.empty}</p>
        </div>
      )}
      {failed && (
        <p className="library-state" role="alert">
          Не удалось загрузить вложения.
        </p>
      )}
      {!loading && (failed || more) && (
        <button
          className="library-more"
          type="button"
          onClick={() => void load(items.at(-1)?.cursor)}
        >
          {failed ? 'Повторить' : 'Показать ещё'}
        </button>
      )}
      {opened?.file && (
        <GalleryViewer
          item={{
            id: opened.id,
            file: opened.file,
            sender: { name: opened.sender_name },
            at: opened.created_at,
            caption: plainText(opened.body || ''),
          }}
          index={selectedIndex}
          count={items.length}
          steps={{
            previous:
              tab.kind === 'media' && selectedIndex > 0
                ? () => setSelected(items[selectedIndex - 1].id)
                : undefined,
            next:
              tab.kind === 'media' && selectedIndex < items.length - 1
                ? () => setSelected(items[selectedIndex + 1].id)
                : undefined,
          }}
          onDownload={onDownload}
          onClose={() => setSelected(null)}
          onShowMessage={() => {
            setSelected(null);
            onOpen(opened.id);
          }}
        />
      )}
    </div>
  );
}

function LibraryRow({
  item,
  kind,
  onOpen,
  onDownload,
  onPlay,
}: {
  item: Item;
  kind: Tab['kind'];
  onOpen: Props['onOpen'];
  onDownload: Props['onDownload'];
  onPlay: (id: string) => void;
}) {
  const file = item.file;
  const meta = item.sender_name + ' · ' + day.format(new Date(item.created_at));
  let content;
  if (kind === 'link') {
    const links = (item.body.match(/https?:\/\/[^\s<>"']+/gi) ?? [])
      .map(messageAddress)
      .filter((url): url is string => Boolean(url));
    content = (
      <>
        <span className="library-symbol">
          <Link2 size={18} />
        </span>
        <div className="library-detail">
          {[...new Set(links)].map((link) => (
            <a key={link} href={link} target="_blank" rel="noopener noreferrer" title={link}>
              <strong>
                {item.link_preview?.url === link ? item.link_preview.title || link : link}
              </strong>
              <ExternalLink size={13} />
            </a>
          ))}
          <small>{meta}</small>
        </div>
      </>
    );
  } else if (!file) {
    return null;
  } else if (kind === 'file') {
    content = (
      <button
        className="media-row"
        type="button"
        title="Скачать файл"
        aria-label={'Скачать ' + file.name}
        onClick={() => onDownload(file)}
      >
        <span className="library-symbol">
          <Download size={18} />
        </span>
        <span className="library-detail">
          <strong>{file.name}</strong>
          <small>
            {size(file.size)} · {meta}
          </small>
        </span>
      </button>
    );
  } else {
    const url = fileUrl(file);
    content = (
      <div className="library-detail">
        <strong>{fileLabel(file.name)}</strong>
        <small>{meta}</small>
        {url &&
          (isVideoNote(file) ? (
            <button type="button" className="library-play" onClick={() => onPlay(item.id)}>
              <Play size={16} />
              Открыть кружок
            </button>
          ) : (
            <AudioPlayer
              src={url}
              name={file.name}
              mime={file.mime}
              size={file.size}
              waveform={file.waveform}
              compact
            />
          ))}
      </div>
    );
  }
  return (
    <li>
      {content}
      <button
        type="button"
        className="icon-button library-action"
        title="Показать в чате"
        aria-label="Показать в чате"
        onClick={() => onOpen(item.id)}
      >
        <MessageSquare size={18} />
      </button>
    </li>
  );
}
