import { useEffect, useRef, useState } from 'react';
import { Download, FileText, X, Expand } from 'lucide-react';
import { API_BASE, isDemo } from './api';
import { getDemoFileUrl } from './demo';
import type { Attachment } from './types';
import { AudioPlayer } from './AudioPlayer';

const size = (bytes: number) =>
  bytes < 1048576
    ? `${Math.max(1, Math.round(bytes / 1024))} КБ`
    : `${(bytes / 1048576).toFixed(1)} МБ`;

export function MediaAttachment({
  file,
  onDownload,
}: {
  file: Attachment;
  onDownload: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const url = isDemo()
    ? getDemoFileUrl(file.id)
    : `${API_BASE}/files/${encodeURIComponent(file.id)}?inline=1`;
  const image = /^(image\/(png|jpeg|gif|webp))$/.test(file.mime || '') && url && !failed;
  const audio = /^(audio\/(webm|ogg|mp4|mpeg|wav|x-wav))$/.test(file.mime || '') && url;
  useEffect(() => {
    if (!expanded || !dialog.current) return;
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, [expanded]);
  if (audio && url)
    return (
      <div className="media-attachment audio-attachment">
        <AudioPlayer
          src={url}
          name={file.name}
          size={file.size}
          mime={file.mime}
          onDownload={onDownload}
        />
      </div>
    );
  if (!image)
    return (
      <button type="button" className="file-attachment" onClick={onDownload}>
        <FileText size={25} />
        <span>
          <strong>{file.name}</strong>
          <small>{size(file.size)} · Скачать</small>
        </span>
        <Download size={17} />
      </button>
    );
  return (
    <div className="media-attachment image-attachment">
      {image && (
        <button
          type="button"
          className="image-preview"
          onClick={() => setExpanded(true)}
          aria-label={`Открыть фото ${file.name}`}
        >
          <img src={url} alt={file.name} loading="lazy" onError={() => setFailed(true)} />
          <span>
            <Expand size={16} />
          </span>
        </button>
      )}
      <div className="media-meta">
        <span>
          <strong>{file.name}</strong>
          <small>{size(file.size)}</small>
        </span>
        <button
          type="button"
          className="icon-button"
          onClick={onDownload}
          aria-label={`Скачать ${file.name}`}
        >
          <Download size={18} />
        </button>
      </div>
      {expanded && (
        <dialog
          ref={dialog}
          className="media-dialog"
          aria-label={`Просмотр фото ${file.name}`}
          onCancel={() => setExpanded(false)}
          onClick={(event) => {
            if (event.target === event.currentTarget) setExpanded(false);
          }}
        >
          <div className="media-dialog-head">
            <h2>{file.name}</h2>
            <button
              type="button"
              className="icon-button"
              onClick={onDownload}
              aria-label="Скачать фотографию"
            >
              <Download size={20} />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => setExpanded(false)}
              aria-label="Закрыть фотографию"
            >
              <X size={22} />
            </button>
          </div>
          <img className="media-full-image" src={url} alt={file.name} />
        </dialog>
      )}
    </div>
  );
}
