import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { Download, X } from 'lucide-react';
import { motionAllowed } from './ui';

const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

/**
 * A profile photo on the whole screen. It grows out of the round avatar it was opened from and
 * shrinks back into it on close (a shared-element transition), so the eye never loses it.
 * Closed by a tap, Esc, the back button or a swipe down; the photo can be saved.
 */
export function AvatarViewer({
  src,
  name,
  from,
  onClose,
}: {
  src: string;
  name: string;
  /** The avatar on the page the photo grows out of and returns to. */
  from: HTMLElement | null;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const photo = useRef<HTMLImageElement>(null);
  const closing = useRef(false);
  const drag = useRef<{ pointer: number; y: number; dy: number } | null>(null);

  /** The transform that puts the full photo exactly over the small avatar. */
  const onAvatar = () => {
    const image = photo.current!.getBoundingClientRect();
    const avatar = from?.isConnected ? from.getBoundingClientRect() : null;
    if (!avatar?.width || !image.width) return null;
    const x = avatar.left + avatar.width / 2 - (image.left + image.width / 2);
    const y = avatar.top + avatar.height / 2 - (image.top + image.height / 2);
    return `translate(${x}px, ${y}px) scale(${avatar.width / image.width})`;
  };

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    // One photo at a time: the small one waits, hidden, for the big one to come back.
    if (from) from.style.visibility = 'hidden';
    const start = onAvatar();
    if (start && motionAllowed())
      photo.current!.animate(
        [
          { transform: start, borderRadius: '50%' },
          { transform: 'none', borderRadius: '14px' },
        ],
        { duration: 380, easing: EASE },
      );
    return () => {
      element.close();
      if (from) from.style.removeProperty('visibility');
    };
  }, []);

  function close() {
    if (closing.current) return;
    closing.current = true;
    dialog.current!.dataset.closing = '';
    const end = onAvatar();
    if (!end || !motionAllowed()) return onClose();
    const current = getComputedStyle(photo.current!).transform;
    photo.current!.animate(
      [
        { transform: current === 'none' ? 'none' : current, borderRadius: '14px' },
        { transform: end, borderRadius: '50%' },
      ],
      { duration: 300, easing: EASE, fill: 'forwards' },
    ).onfinish = onClose;
  }

  // A swipe down carries the photo with the finger and lets it go.
  const down = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (event.pointerType === 'mouse') return;
    drag.current = { pointer: event.pointerId, y: event.clientY, dy: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent<HTMLImageElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    current.dy = event.clientY - current.y;
    event.currentTarget.style.transform = `translateY(${current.dy}px)`;
    dialog.current!.style.setProperty('--fade', String(Math.max(0.3, 1 - Math.abs(current.dy) / 400)));
  };
  const up = (event: ReactPointerEvent<HTMLImageElement>) => {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    if (Math.abs(current.dy) > 90) {
      close();
      return;
    }
    const image = event.currentTarget;
    image.style.transition = 'transform 240ms cubic-bezier(0.23, 1, 0.32, 1)';
    image.style.transform = '';
    dialog.current!.style.removeProperty('--fade');
    setTimeout(() => image.style.removeProperty('transition'), 260);
    // A tap without a drag closes.
    if (Math.abs(current.dy) < 6) close();
  };

  return (
    <dialog
      ref={dialog}
      className="avatar-viewer"
      aria-label={`Фото: ${name}`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="avatar-viewer-bar">
        <strong>{name}</strong>
        <a
          className="icon-button"
          href={src}
          download={`${name}.jpg`}
          aria-label="Сохранить фото"
          title="Сохранить фото"
        >
          <Download size={20} />
        </a>
        <button
          type="button"
          className="icon-button"
          aria-label="Закрыть фото"
          title="Закрыть"
          onClick={close}
        >
          <X size={22} />
        </button>
      </div>
      <img
        ref={photo}
        src={src}
        alt={name}
        draggable={false}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClick={(event) => {
          // Mouse: a click on the photo closes it (touch is handled by the drag above).
          if ((event.nativeEvent as PointerEvent).pointerType !== 'touch') close();
        }}
      />
    </dialog>
  );
}
