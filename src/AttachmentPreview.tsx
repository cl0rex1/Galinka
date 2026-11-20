import { useEffect, useState } from 'react';
import { FileText, LoaderCircle, RotateCw, X } from 'lucide-react';
import { AudioPlayer } from './AudioPlayer';
import { fileLabel, isAudioFile, isVideoNote } from './MediaAttachment';
import { VideoPlayer } from './VideoPlayer';

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} КБ`
    : `${(bytes / 1048576).toFixed(1).replace('.', ',')} МБ`;
export type Transfer = { phase: 'uploading' | 'sending' | 'error'; progress: number };
/** Several files waiting in the composer: a strip of thumbnails, each with its own remove button. */
export function AttachmentStrip({
  items,
  transfer,
  onRemove,
  onRetry,
}: {
  items: { file: File; asFile?: boolean }[];
  transfer?: Transfer;
  onRemove: (index: number) => void;
  onRetry: () => void;
}) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const next = items.map(({ file, asFile }) => (asFile ? '' : URL.createObjectURL(file)));
    setUrls(next);
    return () =>
      next.forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
  }, [items]);
  const busy = transfer?.phase === 'uploading' || transfer?.phase === 'sending';
  const total = items.reduce((sum, { file }) => sum + file.size, 0);
  return (
    <div className={`pending-strip ${transfer?.phase === 'error' ? 'has-error' : ''}`}>
      <ul>
        {items.map(({ file, asFile }, index) => (
          <li key={`${index}:${file.name}:${file.size}`}>
            {!asFile && file.type.startsWith('image/') && urls[index] ? (
              <img src={urls[index]} alt={file.name} />
            ) : !asFile && file.type.startsWith('video/') && urls[index] ? (
              <video src={`${urls[index]}#t=0.1`} muted playsInline preload="metadata" />
            ) : (
              <span className="pending-strip-file" title={file.name}>
                <FileText size={22} />
                <small>{fileLabel(file.name, asFile)}</small>
              </span>
            )}
            <button
              type="button"
              className="pending-strip-remove"
              aria-label={`Убрать файл ${file.name}`}
              disabled={busy}
              onClick={() => onRemove(index)}
            >
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
      <span className="pending-file-status" role="status">
        {busy && <LoaderCircle size={13} className="spin" />}
        {transfer?.phase === 'error'
          ? 'Не отправлено'
          : transfer?.phase === 'sending'
            ? 'Отправка…'
            : transfer?.phase === 'uploading'
              ? `Загрузка ${transfer.progress}%`
              : `Файлов: ${items.length} · ${formatSize(total)}`}
        {transfer?.phase === 'error' && (
          <button type="button" className="text-button" onClick={onRetry}>
            Повторить
          </button>
        )}
      </span>
      {transfer?.phase === 'uploading' && (
        <progress aria-label="Загрузка вложений" value={transfer.progress} max={100} />
      )}
    </div>
  );
}

export function AttachmentPreview({
  file,
  transfer,
  asFile,
  original,
  onOriginal,
  onRemove,
  onRetry,
}: {
  file: File;
  transfer?: Transfer;
  asFile?: boolean;
  original?: File;
  onOriginal?: () => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  const url = preview?.file === file ? preview.url : '';
  const audio = !asFile && isAudioFile(file.name, file.type);
  const image = !asFile && file.type.startsWith('image/');
  const video = !asFile && file.type.startsWith('video/');
  const note = video && isVideoNote({ name: file.name, mime: file.type });
  const busy = transfer?.phase === 'uploading' || transfer?.phase === 'sending';
  useEffect(() => {
    if (asFile) return;
    const next = URL.createObjectURL(file);
    setPreview({ file, url: next });
    return () => URL.revokeObjectURL(next);
  }, [file, asFile]);
  const label =
    transfer?.phase === 'error'
      ? 'Не отправлено'
      : transfer?.phase === 'sending'
        ? 'Отправка…'
        : transfer?.phase === 'uploading'
          ? transfer.progress >= 100
            ? 'Обработка…'
            : `Загрузка ${transfer.progress}%`
          : formatSize(file.size);
  return (
    <div
      className={`pending-file ${audio ? 'pending-voice' : ''} ${transfer?.phase === 'error' ? 'has-error' : ''}`}
    >
      {image && url ? (
        <img className="pending-thumbnail" src={url} alt="Прикреплённое фото" />
      ) : note && url ? (
        <video
          className="pending-thumbnail round"
          src={`${url}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          aria-label="Записанный кружок"
        />
      ) : (
        !audio && !video && <FileText size={22} />
      )}
      <div className="pending-file-content">
        <strong title={file.name}>{fileLabel(file.name, asFile)}</strong>
        {video && !note && url && <VideoPlayer key={url} src={url} name={file.name} compact />}
        {audio && url && (
          <AudioPlayer src={url} name={file.name} size={file.size} mime={file.type} compact />
        )}
        <span className="pending-file-status" role="status">
          {busy && <LoaderCircle size={13} className="spin" />}
          {asFile && 'Файл · '}
          {label}
          {original && onOriginal && (
            <button type="button" className="text-button" onClick={onOriginal}>
              Отправить оригинал ({formatSize(original.size)})
            </button>
          )}
        </span>
        {transfer?.phase === 'uploading' && (
          <progress aria-label="Загрузка вложения" value={transfer.progress} max={100} />
        )}
      </div>
      {transfer?.phase === 'error' && (
        <button
          type="button"
          className="icon-button"
          aria-label="Повторить отправку"
          title="Повторить отправку"
          onClick={onRetry}
        >
          <RotateCw size={20} />
        </button>
      )}
      <button
        type="button"
        className="icon-button"
        aria-label="Убрать файл"
        title="Убрать файл"
        disabled={busy}
        onClick={onRemove}
      >
        <X size={18} />
      </button>
    </div>
  );
}
