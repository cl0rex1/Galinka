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
export function AttachmentPreview({
  file,
  transfer,
  original,
  onOriginal,
  onRemove,
  onRetry,
}: {
  file: File;
  transfer?: Transfer;
  original?: File;
  onOriginal?: () => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  const url = preview?.file === file ? preview.url : '';
  const audio = isAudioFile(file.name, file.type);
  const image = file.type.startsWith('image/');
  const video = file.type.startsWith('video/');
  const note = video && isVideoNote({ name: file.name, mime: file.type });
  const busy = transfer?.phase === 'uploading' || transfer?.phase === 'sending';
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setPreview({ file, url: next });
    return () => URL.revokeObjectURL(next);
  }, [file]);
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
        <strong title={file.name}>{fileLabel(file.name)}</strong>
        {video && !note && url && <VideoPlayer key={url} src={url} name={file.name} compact />}
        {audio && url && (
          <AudioPlayer src={url} name={file.name} size={file.size} mime={file.type} compact />
        )}
        <span className="pending-file-status" role="status">
          {busy && <LoaderCircle size={13} className="spin" />}
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
