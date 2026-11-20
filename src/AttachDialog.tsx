import { useEffect, useRef, useState } from 'react';
import { FileText, Pencil, Plus, X } from 'lucide-react';
import { fileLabel } from './MediaAttachment';
import { ImageEditor } from './ImageEditor';
import { useSheetDrag } from './ui';

const editable = (file: File) => /^image\/(jpeg|png|webp)$/.test(file.type);
const count = (files: File[]) => {
  const photos = files.filter((file) => file.type.startsWith('image/')).length;
  const videos = files.filter((file) => file.type.startsWith('video/')).length;
  const n = files.length;
  const word =
    photos === n
      ? ['фото', 'фото', 'фото']
      : videos === n
        ? ['видео', 'видео', 'видео']
        : ['файл', 'файла', 'файлов'];
  const form =
    n % 10 === 1 && n % 100 !== 11
      ? 0
      : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
        ? 1
        : 2;
  return `${n} ${word[form]}`;
};

/**
 * Telegram-style window for photos and videos before sending: previews, a pencil to edit a photo,
 * a caption field and Send. Closing it keeps the files in the composer.
 */
export function AttachDialog({
  items,
  caption,
  onCaption,
  onRemove,
  onReplace,
  onAddMore,
  onSend,
  onClose,
}: {
  items: { file: File; asFile?: boolean }[];
  caption: string;
  onCaption: (value: string) => void;
  onRemove: (index: number) => void;
  onReplace: (index: number, file: File) => void;
  onAddMore: () => void;
  onSend: () => void;
  onClose: () => void;
}) {
  const files = items.map(({ file }) => file);
  const label = items.some((item) => item.asFile) ? 'вложения' : count(files);
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState<number | null>(null);
  // Pulling the sheet down folds it back into the composer, as the close button does.
  const sheet = useSheetDrag(onClose, editing === null);
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    dialog.current?.showModal();
    if (matchMedia('(pointer:fine)').matches) field.current?.focus();
  }, []);
  useEffect(() => {
    const next = items.map(({ file, asFile }) => (asFile ? '' : URL.createObjectURL(file)));
    setUrls(next);
    return () =>
      next.forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
  }, [items]);

  return (
    <dialog
      ref={dialog}
      className="modal attach-dialog"
      aria-label={`Отправить ${label}`}
      {...sheet}
      onCancel={(event) => {
        event.preventDefault();
        if (editing === null) onClose();
      }}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <div className="attach-dialog-head">
          <strong>Отправить {label}</strong>
          <button type="button" className="icon-button" aria-label="Свернуть" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <ul className={`attach-dialog-grid n${Math.min(files.length, 4)}`}>
          {items.map(({ file, asFile }, index) => (
            <li key={`${index}:${file.name}:${file.size}:${file.lastModified}`}>
              {!asFile && file.type.startsWith('image/') && urls[index] ? (
                <img src={urls[index]} alt={file.name} />
              ) : !asFile && file.type.startsWith('video/') && urls[index] ? (
                <video src={`${urls[index]}#t=0.1`} muted playsInline preload="metadata" />
              ) : (
                <span className="pending-strip-file" title={file.name}>
                  <FileText size={26} />
                  <small>{fileLabel(file.name, asFile)}</small>
                </span>
              )}
              <span className="attach-dialog-actions">
                {!asFile && editable(file) && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Редактировать ${file.name}`}
                    title="Обрезать, повернуть, рисовать"
                    onClick={() => setEditing(index)}
                  >
                    <Pencil size={16} />
                  </button>
                )}
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Убрать ${file.name}`}
                  onClick={() => onRemove(index)}
                >
                  <X size={16} />
                </button>
              </span>
            </li>
          ))}
        </ul>
        <textarea
          ref={field}
          className="attach-dialog-caption"
          aria-label="Подпись"
          placeholder="Подпись"
          rows={1}
          maxLength={8000}
          value={caption}
          onChange={(event) => onCaption(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              matchMedia('(pointer:fine)').matches
            ) {
              event.preventDefault();
              onSend();
            }
          }}
        />
        <div className="attach-dialog-foot">
          {files.length < 10 && (
            <button type="button" className="text-button" onClick={onAddMore}>
              <Plus size={16} /> Добавить
            </button>
          )}
          <button type="submit" className="primary">
            Отправить
          </button>
        </div>
      </form>
      {editing !== null && files[editing] && (
        <ImageEditor
          file={files[editing]}
          onCancel={() => setEditing(null)}
          onDone={(edited) => {
            onReplace(editing, edited);
            setEditing(null);
          }}
        />
      )}
    </dialog>
  );
}
