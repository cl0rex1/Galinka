import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, Crop, Pencil, RotateCcw, Undo2, X } from 'lucide-react';

type Point = [number, number];
type Stroke = { color: string; size: number; points: Point[] };
type Rect = { x: number; y: number; w: number; h: number };
const full: Rect = { x: 0, y: 0, w: 1, h: 1 };
const colors = ['#ffffff', '#111111', '#ff3b30', '#ffcc00', '#34c759', '#0a84ff'];
const LIMIT = 2560;
const MIN = 0.05;

/** A crop rectangle turned with the picture a quarter counter-clockwise (normalized 0..1). */
export const rotateRect = (r: Rect): Rect => ({ x: r.y, y: 1 - (r.x + r.w), w: r.h, h: r.w });
/** Moves an edge or the whole rectangle, keeping it inside the picture and not too small. */
export function dragRect(start: Rect, part: string, dx: number, dy: number): Rect {
  let { x, y, w, h } = start;
  if (part === 'move') {
    x = Math.min(1 - w, Math.max(0, x + dx));
    y = Math.min(1 - h, Math.max(0, y + dy));
    return { x, y, w, h };
  }
  if (part.includes('w')) {
    const left = Math.min(x + w - MIN, Math.max(0, x + dx));
    w += x - left;
    x = left;
  }
  if (part.includes('e')) w = Math.min(1 - x, Math.max(MIN, w + dx));
  if (part.includes('n')) {
    const top = Math.min(y + h - MIN, Math.max(0, y + dy));
    h += y - top;
    y = top;
  }
  if (part.includes('s')) h = Math.min(1 - y, Math.max(MIN, h + dy));
  return { x, y, w, h };
}

function paint(
  context: CanvasRenderingContext2D,
  image: ImageBitmap,
  strokes: Stroke[],
  w: number,
  h: number,
) {
  context.drawImage(image, 0, 0, w, h);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const stroke of strokes) {
    context.strokeStyle = stroke.color;
    context.lineWidth = stroke.size * w;
    context.beginPath();
    stroke.points.forEach(([px, py], i) =>
      i ? context.lineTo(px * w, py * h) : context.moveTo(px * w, py * h),
    );
    if (stroke.points.length === 1)
      context.lineTo(stroke.points[0][0] * w + 0.1, stroke.points[0][1] * h);
    context.stroke();
  }
}
function canvasOf(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return [canvas, canvas.getContext('2d')!] as const;
}

/**
 * Before sending a photo: crop by dragging the frame's corners and edges, turn it a quarter,
 * draw over it. "Готово" gives back a new JPEG; the original stays untouched.
 */
export function ImageEditor({
  file,
  onDone,
  onCancel,
}: {
  file: File;
  onDone: (file: File) => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const original = useRef<ImageBitmap | null>(null);
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [crop, setCrop] = useState<Rect>(full);
  const [mode, setMode] = useState<'crop' | 'draw'>('crop');
  const [color, setColor] = useState(colors[2]);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const drag = useRef<{ part: string; x: number; y: number; start: Rect } | null>(null);
  /** The pointer drawing the current stroke. */
  const drawing = useRef<number | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
    let live = true;
    createImageBitmap(file)
      .then((bitmap) => {
        if (!live) return bitmap.close();
        original.current = bitmap;
        setImage(bitmap);
      })
      .catch(() => setError('Это фото не получается открыть в редакторе.'));
    return () => {
      live = false;
    };
  }, [file]);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const style = getComputedStyle(element);
    setBox({
      width: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      height: element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
    });
    const observer = new ResizeObserver(([entry]) =>
      setBox({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const scale = image ? Math.min(box.width / image.width, box.height / image.height, 1) : 0;
  const shown = image ? { width: image.width * scale, height: image.height * scale } : null;
  useEffect(() => {
    const element = canvas.current;
    if (!element || !image || !shown?.width) return;
    const ratio = devicePixelRatio || 1;
    element.width = Math.round(shown.width * ratio);
    element.height = Math.round(shown.height * ratio);
    paint(element.getContext('2d')!, image, strokes, element.width, element.height);
  }, [image, strokes, shown?.width, shown?.height]);

  /** Bakes the drawing into the picture and turns it a quarter counter-clockwise. */
  async function rotate() {
    if (!image || busy) return;
    setBusy(true);
    const [flat, flatContext] = canvasOf(image.width, image.height);
    paint(flatContext, image, strokes, image.width, image.height);
    const [turned, context] = canvasOf(image.height, image.width);
    context.translate(0, image.width);
    context.rotate(-Math.PI / 2);
    context.drawImage(flat, 0, 0);
    const next = await createImageBitmap(turned);
    if (image !== original.current) image.close();
    setImage(next);
    setStrokes([]);
    setCrop(rotateRect(crop));
    setBusy(false);
  }

  async function finish() {
    if (!image || busy) return;
    setBusy(true);
    const [flat, flatContext] = canvasOf(image.width, image.height);
    paint(flatContext, image, strokes, image.width, image.height);
    const cw = crop.w * image.width,
      ch = crop.h * image.height;
    const fit = Math.min(1, LIMIT / Math.max(cw, ch));
    const [out, context] = canvasOf(
      Math.max(1, Math.round(cw * fit)),
      Math.max(1, Math.round(ch * fit)),
    );
    context.fillStyle = '#fff';
    context.fillRect(0, 0, out.width, out.height);
    context.drawImage(
      flat,
      crop.x * image.width,
      crop.y * image.height,
      cw,
      ch,
      0,
      0,
      out.width,
      out.height,
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      out.toBlob(resolve, 'image/jpeg', 0.9),
    );
    setBusy(false);
    if (!blob) {
      setError('Не удалось сохранить фото. Попробуйте ещё раз.');
      return;
    }
    onDone(new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }));
  }

  const point = (event: ReactPointerEvent): Point => {
    const rect = canvas.current!.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    ];
  };
  const capture = (event: ReactPointerEvent<HTMLElement>) => {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* The pointer is already gone; the stroke or drag still ends on pointerup. */
    }
  };
  function drawStart(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (mode !== 'draw' || !shown) return;
    capture(event);
    drawing.current = event.pointerId;
    setStrokes((previous) => [
      ...previous,
      { color, size: 6 / shown.width, points: [point(event)] },
    ]);
  }
  function drawMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (mode !== 'draw' || drawing.current !== event.pointerId) return;
    const next = point(event);
    setStrokes((previous) => {
      const last = previous.at(-1);
      if (!last) return previous;
      return [...previous.slice(0, -1), { ...last, points: [...last.points, next] }];
    });
  }
  function cropStart(event: ReactPointerEvent<HTMLElement>, part: string) {
    event.stopPropagation();
    capture(event);
    drag.current = { part, x: event.clientX, y: event.clientY, start: crop };
  }
  function cropMove(event: ReactPointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current || !shown) return;
    setCrop(
      dragRect(
        current.start,
        current.part,
        (event.clientX - current.x) / shown.width,
        (event.clientY - current.y) / shown.height,
      ),
    );
  }

  return (
    <dialog
      ref={dialog}
      className="image-editor"
      aria-label="Редактор фото"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <div className="image-editor-head">
        <button
          type="button"
          className="icon-button"
          aria-label="Отменить правку"
          onClick={onCancel}
        >
          <X size={22} />
        </button>
        <strong>Редактор</strong>
        <button
          type="button"
          className="primary"
          disabled={!image || busy}
          onClick={() => void finish()}
        >
          <Check size={18} /> Готово
        </button>
      </div>
      <div ref={stage} className="image-editor-stage">
        {error && <p role="alert">{error}</p>}
        {shown && (
          <div className="image-editor-canvas" style={{ width: shown.width, height: shown.height }}>
            <canvas
              ref={canvas}
              className={mode === 'draw' ? 'drawing' : undefined}
              style={{ width: shown.width, height: shown.height }}
              onPointerDown={drawStart}
              onPointerMove={drawMove}
              onPointerUp={() => (drawing.current = null)}
              onPointerCancel={() => (drawing.current = null)}
            />
            {mode === 'crop' && (
              <div
                className="image-editor-crop"
                style={{
                  left: `${crop.x * 100}%`,
                  top: `${crop.y * 100}%`,
                  width: `${crop.w * 100}%`,
                  height: `${crop.h * 100}%`,
                }}
                onPointerDown={(event) => cropStart(event, 'move')}
                onPointerMove={cropMove}
                onPointerUp={() => (drag.current = null)}
                onPointerCancel={() => (drag.current = null)}
              >
                {['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e'].map((part) => (
                  <span
                    key={part}
                    className={`crop-handle ${part}`}
                    aria-hidden="true"
                    onPointerDown={(event) => cropStart(event, part)}
                    onPointerMove={cropMove}
                    onPointerUp={() => (drag.current = null)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="image-editor-tools" role="toolbar" aria-label="Инструменты">
        <button
          type="button"
          className={`icon-button ${mode === 'crop' ? 'active' : ''}`}
          aria-pressed={mode === 'crop'}
          aria-label="Обрезать"
          title="Обрезать"
          onClick={() => setMode('crop')}
        >
          <Crop size={20} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Повернуть"
          title="Повернуть"
          disabled={busy}
          onClick={() => void rotate()}
        >
          <RotateCcw size={20} />
        </button>
        <button
          type="button"
          className={`icon-button ${mode === 'draw' ? 'active' : ''}`}
          aria-pressed={mode === 'draw'}
          aria-label="Рисовать"
          title="Рисовать"
          onClick={() => setMode('draw')}
        >
          <Pencil size={20} />
        </button>
        {mode === 'draw' && (
          <span className="image-editor-colors">
            {colors.map((value) => (
              <button
                type="button"
                key={value}
                className={value === color ? 'selected' : ''}
                style={{ background: value }}
                aria-label={`Цвет ${value}`}
                aria-pressed={value === color}
                onClick={() => setColor(value)}
              />
            ))}
          </span>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label="Отменить последний штрих"
          title="Отменить штрих"
          disabled={!strokes.length}
          onClick={() => setStrokes((previous) => previous.slice(0, -1))}
        >
          <Undo2 size={20} />
        </button>
        <button
          type="button"
          className="text-button"
          disabled={busy || (image === original.current && !strokes.length && crop === full)}
          onClick={() => {
            if (image && image !== original.current) image.close();
            setImage(original.current);
            setStrokes([]);
            setCrop(full);
          }}
        >
          Сбросить
        </button>
      </div>
    </dialog>
  );
}
