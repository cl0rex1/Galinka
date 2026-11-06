import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Download, FileText, Play, X, ZoomIn, ZoomOut } from 'lucide-react';
import { API_BASE, isDemo } from './api';
import { getDemoFileUrl } from './demo';
import type { Attachment } from './types';
import { AudioPlayer } from './AudioPlayer';
import { motionAllowed } from './ui';
import { VideoPlayer } from './VideoPlayer';

const size = (bytes: number) =>
  bytes < 1048576
    ? `${Math.max(1, Math.round(bytes / 1024))} КБ`
    : `${(bytes / 1048576).toFixed(1)} МБ`;
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
/** Recorded voice and round videos carry a date in their file names; show what they are instead. */
export const fileLabel = (name: string) =>
  name.startsWith('Кружок')
    ? 'Кружок'
    : name.startsWith('Голосовое-')
      ? 'Голосовое сообщение'
      : /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(name)
        ? 'Фотография'
        : /\.(mp4|mov|webm|m4v)$/i.test(name)
          ? 'Видео'
          : name;
/** Round video messages are recorded by Galinka under this name. */
export const isVideoNote = (file: { name: string; mime?: string }) =>
  /^video\//.test(file.mime || '') && file.name.startsWith('Кружок');
export const isAudioFile = (name: string, mime?: string) =>
  /^audio\/(webm|ogg|mp4|mpeg|wav|x-wav|flac|aac)$/.test(mime || '') ||
  ((!mime || mime === 'application/octet-stream') && /\.(mp3|wav|flac|aac)$/i.test(name));

export function MediaAttachment({
  file,
  onDownload,
}: {
  file: Attachment;
  onDownload: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);
  const url = isDemo()
    ? getDemoFileUrl(file.id)
    : `${API_BASE}/files/${encodeURIComponent(file.id)}?inline=1`;
  const mime = file.mime || '';
  const image = /^image\/(png|jpeg|gif|webp)$/.test(mime) && url && !failed;
  const audio = isAudioFile(file.name, mime) && url;
  const video = /^video\/(mp4|webm|quicktime)$/.test(mime) && url && !failed;
  if (audio && url)
    return (
      <div className="media-attachment audio-attachment">
        {!file.name.startsWith('Голосовое-') && (
          <div className="audio-file-name" title={file.name}>
            {file.name}
          </div>
        )}
        <AudioPlayer
          src={url}
          name={file.name}
          size={file.size}
          mime={file.mime}
          onDownload={onDownload}
        />
      </div>
    );
  if (video && url)
    return isVideoNote(file) ? (
      <div className="media-attachment video-note-attachment">
        <VideoNote src={url} onError={() => setFailed(true)} />
      </div>
    ) : (
      <div className="media-attachment video-attachment">
        <VideoPlayer src={url} name={file.name} onError={() => setFailed(true)} />
      </div>
    );
  if (!image || !url)
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
      <button
        type="button"
        className="image-preview"
        onClick={() => setExpanded(true)}
        aria-label={`Открыть фото ${file.name}`}
      >
        <img src={url} alt={file.name} loading="lazy" onError={() => setFailed(true)} />
      </button>
      {expanded && (
        <PhotoViewer
          src={url}
          name={file.name}
          onDownload={onDownload}
          onClose={() => setExpanded(false)}
        />
      )}
    </div>
  );
}

/**
 * Full-screen photo. Wheel, pinch, double click or tap and the buttons zoom around the pointer;
 * dragging pans a zoomed photo. At normal size a downward drag closes the viewer.
 */
function PhotoViewer({
  src,
  name,
  onDownload,
  onClose,
}: {
  src: string;
  name: string;
  onDownload: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const view = useRef({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ distance: number; scale: number; dragY: number; moved: boolean }>({
    distance: 0,
    scale: 1,
    dragY: 0,
    moved: false,
  });
  const lastTap = useRef(0);
  const [zoomed, setZoomed] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  const close = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, motionAllowed() ? 180 : 0);
  };

  // Write the transform straight to the image; React does not re-render on every move.
  function apply(animated: boolean) {
    const img = picture.current;
    const box = stage.current?.getBoundingClientRect();
    if (!img || !box) return;
    const v = view.current;
    v.scale = Math.min(5, Math.max(1, v.scale));
    const limitX = ((v.scale - 1) * box.width) / 2;
    const limitY = ((v.scale - 1) * box.height) / 2;
    v.x = Math.min(limitX, Math.max(-limitX, v.x));
    v.y = Math.min(limitY, Math.max(-limitY, v.y));
    img.style.transition = animated ? '' : 'none';
    img.style.transform = `translate(${v.x}px, ${v.y + gesture.current.dragY}px) scale(${v.scale})`;
    setZoomed(v.scale > 1.01);
  }
  /** Zoom to `next`, keeping the point under (clientX, clientY) in place. */
  function zoomAt(next: number, clientX?: number, clientY?: number, animated = true) {
    const box = stage.current?.getBoundingClientRect();
    if (!box) return;
    const v = view.current;
    const target = Math.min(5, Math.max(1, next));
    const dx = (clientX ?? box.left + box.width / 2) - (box.left + box.width / 2);
    const dy = (clientY ?? box.top + box.height / 2) - (box.top + box.height / 2);
    v.x = dx - (target / v.scale) * (dx - v.x);
    v.y = dy - (target / v.scale) * (dy - v.y);
    v.scale = target;
    apply(animated);
  }
  const toggleZoom = (x?: number, y?: number) => zoomAt(view.current.scale > 1.01 ? 1 : 2.5, x, y);

  function down(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    gesture.current.moved = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.distance = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.current.scale = view.current.scale;
    }
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const last = pointers.current.get(event.pointerId);
    if (!last) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    if (Math.hypot(point.x - last.x, point.y - last.y) > 0) gesture.current.moved = true;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture.current.distance)
        zoomAt(
          (gesture.current.scale * distance) / gesture.current.distance,
          (a.x + b.x) / 2,
          (a.y + b.y) / 2,
          false,
        );
      return;
    }
    if (view.current.scale > 1.01) {
      view.current.x += point.x - last.x;
      view.current.y += point.y - last.y;
      apply(false);
    } else if (event.pointerType !== 'mouse' || event.buttons === 1) {
      // Not zoomed: follow a vertical drag, fading the backdrop, to swipe the photo away.
      gesture.current.dragY = Math.max(-200, gesture.current.dragY + point.y - last.y);
      dialog.current?.style.setProperty(
        '--drag',
        String(Math.min(1, Math.abs(gesture.current.dragY) / 300)),
      );
      apply(false);
    }
  }
  function up(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size) return;
    const drag = gesture.current.dragY;
    gesture.current.dragY = 0;
    dialog.current?.style.setProperty('--drag', '0');
    if (Math.abs(drag) > 110) {
      close();
      return;
    }
    apply(true);
    if (gesture.current.moved) return;
    // Double tap (touch) zooms; a mouse double click is handled by onDoubleClick.
    if (event.pointerType !== 'mouse') {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        toggleZoom(event.clientX, event.clientY);
        lastTap.current = 0;
      } else lastTap.current = now;
    }
  }

  return (
    <dialog
      ref={dialog}
      className="media-dialog"
      data-closing={closing || undefined}
      aria-label={`Просмотр фото ${name}`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key === '+' || event.key === '=') zoomAt(view.current.scale * 1.5);
        else if (event.key === '-') zoomAt(view.current.scale / 1.5);
        else if (event.key === '0') zoomAt(1);
      }}
    >
      <div className="media-dialog-head">
        <h2>{name}</h2>
        <button
          type="button"
          className="icon-button"
          onClick={() => zoomAt(view.current.scale / 1.5)}
          disabled={!zoomed}
          aria-label="Уменьшить"
          title="Уменьшить"
        >
          <ZoomOut size={20} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => zoomAt(view.current.scale * 1.5)}
          aria-label="Увеличить"
          title="Увеличить"
        >
          <ZoomIn size={20} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onDownload}
          aria-label="Скачать фотографию"
          title="Скачать"
        >
          <Download size={20} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={close}
          aria-label="Закрыть фотографию"
          title="Закрыть"
        >
          <X size={22} />
        </button>
      </div>
      <div
        ref={stage}
        className={`media-stage ${zoomed ? 'zoomed' : ''}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={(event) => toggleZoom(event.clientX, event.clientY)}
        onWheel={(event) =>
          zoomAt(
            view.current.scale * Math.exp(-event.deltaY * 0.002),
            event.clientX,
            event.clientY,
            false,
          )
        }
      >
        <img ref={picture} className="media-full-image" src={src} alt={name} draggable={false} />
      </div>
    </dialog>
  );
}

/** Round video message: a still until tapped, then plays with sound inside a progress ring. */
function VideoNote({ src, onError }: { src: string; onError: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState({ current: 0, duration: 0 });
  // Recorder output often has no duration in its header; seeking to the end reveals it.
  function measure() {
    const element = video.current!;
    if (Number.isFinite(element.duration)) {
      setTime({ current: 0, duration: element.duration });
      return;
    }
    const reveal = () => {
      element.removeEventListener('durationchange', reveal);
      if (!Number.isFinite(element.duration)) return;
      element.currentTime = 0;
      setTime({ current: 0, duration: element.duration });
    };
    element.addEventListener('durationchange', reveal);
    element.currentTime = 1e7;
  }
  function toggle() {
    const element = video.current!;
    // Only one round video plays at a time, like voice messages.
    document.querySelectorAll<HTMLVideoElement>('.video-note video').forEach((other) => {
      if (other !== element) other.pause();
    });
    if (element.paused) void element.play().catch(() => setPlaying(false));
    else element.pause();
  }
  const progress = time.duration ? time.current / time.duration : 0;
  return (
    <button
      type="button"
      className={`video-note ${playing ? 'playing' : ''}`}
      onClick={toggle}
      aria-label={playing ? 'Пауза' : 'Воспроизвести кружок'}
    >
      <video
        ref={video}
        src={`${src}#t=0.1`}
        playsInline
        preload="metadata"
        onLoadedMetadata={measure}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setTime((previous) => ({ ...previous, current: 0 }));
          if (video.current) video.current.currentTime = 0;
        }}
        onTimeUpdate={(event) => {
          // Paused updates come from seeking (measuring the length, rewinding at the end).
          if (event.currentTarget.paused) return;
          const current = event.currentTarget.currentTime;
          setTime((previous) => ({ ...previous, current }));
        }}
        onError={onError}
      />
      <svg className="video-note-ring" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="48.5" pathLength="100" strokeDashoffset={100 - progress * 100} />
      </svg>
      {!playing && (
        <span className="video-note-play" aria-hidden="true">
          <Play size={22} fill="currentColor" />
        </span>
      )}
      <span className="video-note-time">
        {clock(playing || time.current ? time.current : time.duration)}
      </span>
    </button>
  );
}
