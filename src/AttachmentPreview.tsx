import { useEffect, useState } from 'react';
import { FileText, LoaderCircle, RotateCw, X } from 'lucide-react';
import { AudioPlayer } from './AudioPlayer';

export type Transfer = { phase: 'uploading' | 'sending' | 'error'; progress: number };
export function AttachmentPreview({
  file,
  transfer,
  onRemove,
  onRetry,
}: {
  file: File;
  transfer?: Transfer;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  const url = preview?.file === file ? preview.url : '';
  const audio = file.type.startsWith('audio/');
  const image = file.type.startsWith('image/');
  const busy = transfer?.phase === 'uploading' || transfer?.phase === 'sending';
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setPreview({ file, url: next });
    return () => URL.revokeObjectURL(next);
  }, [file]);
  const label =
    transfer?.phase === 'error'
      ? 'Не отправлено. Файл сохранён — попробуйте ещё раз.'
      : transfer?.phase === 'sending'
        ? 'Отправляем сообщение…'
        : transfer?.phase === 'uploading'
          ? transfer.progress >= 100
            ? audio
              ? 'Обрабатываем голосовое…'
              : 'Обрабатываем файл…'
            : `Загружаем: ${transfer.progress}%`
          : audio
            ? 'Прослушайте запись и нажмите «Отправить».'
            : 'Готово к отправке';
  return (
    <div
      className={`pending-file ${audio ? 'pending-voice' : ''} ${transfer?.phase === 'error' ? 'has-error' : ''}`}
    >
      {image && url ? (
        <img className="pending-thumbnail" src={url} alt="Прикреплённое фото" />
      ) : (
        !audio && <FileText size={22} />
      )}
      <div className="pending-file-content">
        <strong>{audio ? 'Голосовое сообщение' : file.name}</strong>
        {audio && url && (
          <AudioPlayer src={url} name={file.name} size={file.size} mime={file.type} compact />
        )}
        <span className="pending-file-status" role="status">
          {busy && <LoaderCircle size={13} className="spin" />}
          {label}
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
