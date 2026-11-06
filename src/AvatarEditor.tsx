import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { CloseButton, Modal } from './ui';

const STAGE = 260; // px, the crop circle on screen
const OUTPUT = 512; // px, the saved square

/**
 * Crop a picked photo to a circle, as in Telegram: drag to frame, slider to zoom. Saves a
 * 512 px square (WebP where the browser can, JPEG otherwise).
 */
function AvatarEditor({
  file,
  onSave,
  onClose,
}: {
  file: File;
  onSave: (blob: Blob) => Promise<void>;
  onClose: () => void;
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(true);
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setImage(img);
    img.onerror = () => setError('Не удалось открыть фото. Попробуйте другое.');
    img.src = url;
    return () => {
      // Detach first: revoking the URL would otherwise report a load error.
      img.onload = img.onerror = null;
      URL.revokeObjectURL(url);
    };
  }, [file]);
  // The photo always covers the circle; offsets are limited so no empty edge shows.
  const cover = image ? Math.max(STAGE / image.width, STAGE / image.height) : 1;
  const width = (image?.width ?? STAGE) * cover * view.zoom;
  const height = (image?.height ?? STAGE) * cover * view.zoom;
  const clamp = (next: typeof view) => ({
    ...next,
    x: Math.max(-(width - STAGE) / 2, Math.min((width - STAGE) / 2, next.x)),
    y: Math.max(-(height - STAGE) / 2, Math.min((height - STAGE) / 2, next.y)),
  });
  function move(event: ReactPointerEvent) {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x,
      dy = event.clientY - drag.current.y;
    drag.current = { x: event.clientX, y: event.clientY };
    setView((current) => clamp({ ...current, x: current.x + dx, y: current.y + dy }));
  }
  async function save() {
    if (!image) return;
    setBusy(true);
    setError('');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = OUTPUT;
    const k = OUTPUT / STAGE;
    canvas
      .getContext('2d')!
      .drawImage(
        image,
        ((STAGE - width) / 2 + view.x) * k,
        ((STAGE - height) / 2 + view.y) * k,
        width * k,
        height * k,
      );
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(
        (webp) =>
          webp?.type === 'image/webp' ? resolve(webp) : canvas.toBlob(resolve, 'image/jpeg', 0.9),
        'image/webp',
        0.9,
      ),
    );
    try {
      if (!blob) throw Error('Не удалось подготовить фото.');
      await onSave(blob);
      setOpen(false);
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal title="Фото профиля" onClose={onClose} open={open} closeDisabled={busy} error={error}>
      <div className="avatar-editor">
        <div
          className="avatar-stage"
          style={{ width: STAGE, height: STAGE }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerMove={move}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onWheel={(event) =>
            setView((current) =>
              clamp({
                ...current,
                zoom: Math.min(3, Math.max(1, current.zoom * Math.exp(-event.deltaY * 0.002))),
              }),
            )
          }
        >
          {image && (
            <img
              src={image.src}
              alt="Новое фото профиля"
              draggable={false}
              style={{
                width,
                height,
                transform: `translate(${(STAGE - width) / 2 + view.x}px, ${(STAGE - height) / 2 + view.y}px)`,
              }}
            />
          )}
        </div>
        <label className="range-row">
          <span>Масштаб</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={view.zoom}
            onChange={(event) =>
              setView((current) => clamp({ ...current, zoom: Number(event.target.value) }))
            }
          />
        </label>
        <p className="settings-hint">Передвиньте фото, чтобы лицо было в круге.</p>
      </div>
      <div className="modal-actions">
        <CloseButton disabled={busy}>Отмена</CloseButton>
        <button
          type="button"
          className="primary"
          disabled={!image || busy}
          onClick={() => void save()}
        >
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Change or remove a photo. `trigger` renders the control (a tile or a row); with a photo
 * already set it first offers "new photo" or "remove".
 */
export function PhotoPicker({
  hasPhoto,
  onUpload,
  onRemove,
  trigger,
}: {
  hasPhoto: boolean;
  onUpload: (blob: Blob) => Promise<void>;
  onRemove: () => Promise<void>;
  trigger: (open: () => void) => ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState('');
  return (
    <>
      {trigger(() => (hasPhoto ? setChoosing(true) : input.current?.click()))}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
        hidden
        onChange={(event) => {
          const picked = event.target.files?.[0];
          event.target.value = '';
          if (picked) setFile(picked);
        }}
      />
      {choosing && (
        <Modal title="Фото" onClose={() => setChoosing(false)} error={error}>
          <div className="action-list rows">
            <button
              type="button"
              onClick={() => {
                setChoosing(false);
                input.current?.click();
              }}
            >
              <ImagePlus size={19} />
              Выбрать новое фото
            </button>
            <button
              type="button"
              className="danger-text"
              onClick={async () => {
                try {
                  await onRemove();
                  setChoosing(false);
                } catch (cause) {
                  setError((cause as Error).message);
                }
              }}
            >
              <Trash2 size={19} />
              Удалить фото
            </button>
          </div>
        </Modal>
      )}
      {file && <AvatarEditor file={file} onSave={onUpload} onClose={() => setFile(null)} />}
    </>
  );
}

/** Send a cropped photo as multipart form data, the way the server expects it. */
export function photoForm(blob: Blob) {
  const form = new FormData();
  form.append('file', blob, blob.type === 'image/webp' ? 'avatar.webp' : 'avatar.jpg');
  return form;
}
