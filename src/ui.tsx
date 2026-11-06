import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';

export function IconButton({
  label,
  children,
  onClick,
  className = '',
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function Modal({
  title,
  onClose,
  children,
  error,
  closeDisabled = false,
  open = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  error?: string;
  closeDisabled?: boolean;
  /** Set to false to play the exit animation; onClose runs when it ends. */
  open?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [closing, setClosing] = useState(false);
  const pressedOutside = useRef(false);
  // Play the exit transition, then let the parent unmount the dialog.
  const requestClose = (force = false) => {
    if ((closeDisabled && !force) || closing) return;
    setClosing(true);
    setTimeout(onClose, motionAllowed() ? 220 : 0);
  };
  useEffect(() => {
    if (!open) requestClose(true);
  }, [open]);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      // Close only when the press both starts and ends outside the card: selecting text in a
      // field and releasing the mouse over the backdrop must not dismiss the dialog.
      onPointerDown={(e) => {
        pressedOutside.current = outside(e);
      }}
      onClick={(e) => {
        if (pressedOutside.current && outside(e)) requestClose();
        pressedOutside.current = false;
      }}
      className="modal"
      data-closing={closing || undefined}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <IconButton label="Закрыть" disabled={closeDisabled} onClick={() => requestClose()}>
          <X size={20} />
        </IconButton>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <CloseModal.Provider value={() => requestClose()}>{children}</CloseModal.Provider>
    </dialog>
  );
}
const CloseModal = createContext(() => {});
/** A button that closes the surrounding Modal with its exit animation. */
export function CloseButton({
  className = 'secondary',
  children,
  disabled,
}: {
  className?: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  const close = useContext(CloseModal);
  return (
    <button type="button" className={className} disabled={disabled} onClick={close}>
      {children}
    </button>
  );
}

/** Second step for destructive actions: a small dialog over the current one. */
export function Confirm({
  title,
  text,
  action,
  onConfirm,
  onClose,
}: {
  title: string;
  text: string;
  action: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(true);
  return (
    <Modal title={title} onClose={onClose} closeDisabled={busy} error={error} open={open}>
      <p className="muted">{text}</p>
      <div className="modal-actions">
        <CloseButton disabled={busy}>Отмена</CloseButton>
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await onConfirm();
              setOpen(false);
            } catch (cause) {
              setError((cause as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Сохраняем…' : action}
        </button>
      </div>
    </Modal>
  );
}

/** True when a pointer event on a <dialog> landed on its backdrop, not on the card itself. */
export function outside(event: {
  clientX: number;
  clientY: number;
  target: EventTarget;
  currentTarget: Element;
}) {
  if (event.target !== event.currentTarget) return false;
  const box = event.currentTarget.getBoundingClientRect();
  return (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  );
}

/**
 * Keep something mounted for its exit animation: `closing` is true for `ms` after `open` turns
 * false, so the element can play a leave animation before it unmounts.
 */
export function usePresence(open: boolean, ms = 200) {
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) {
      setShown(true);
      return;
    }
    const timer = setTimeout(() => setShown(false), motionAllowed() ? ms : 0);
    return () => clearTimeout(timer);
  }, [open, ms]);
  return { mounted: open || shown, closing: !open && shown };
}

/**
 * Slide an underline (the list's ::after) to the selected tab; it does not move on first paint.
 * Returns a callback ref, so a list that mounts later (after loading) is measured too.
 */
export function useTabIndicator(selected: unknown) {
  const list = useRef<HTMLElement | null>(null);
  const measure = useCallback(() => {
    const el = list.current;
    if (!el) return;
    const tab = el.querySelector<HTMLElement>('[aria-selected="true"], [aria-pressed="true"]');
    el.style.setProperty('--tab-x', `${tab?.offsetLeft ?? 0}px`);
    el.style.setProperty('--tab-w', `${tab?.offsetWidth ?? 0}px`);
    tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    requestAnimationFrame(() => el.classList.add('ready'));
  }, []);
  useLayoutEffect(measure, [selected, measure]);
  return useCallback(
    (el: HTMLElement | null) => {
      list.current = el;
      if (!el) return;
      measure();
      // Tab widths change once the web font arrives.
      void document.fonts?.ready.then(measure);
    },
    [measure],
  );
}

export const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11
    ? one
    : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
      ? few
      : many;

/** False when the user asked for less motion, in the system or in Galinka settings. */
export const motionAllowed = () =>
  !matchMedia('(prefers-reduced-motion: reduce)').matches &&
  document.documentElement.dataset.motion !== 'reduced';

/**
 * Close a menu built on <details> with a short fade. Done in script rather than with CSS
 * ::details-content: that needs allow-discrete support (missing in Safari) and its containment
 * shifts the fixed-position message menu.
 */
export function closeMenu(details: Element) {
  const content = details.querySelector<HTMLElement>('.message-menu-content, .chat-actions-menu');
  if (!details.hasAttribute('open')) return;
  if (!content || !motionAllowed()) {
    details.removeAttribute('open');
    return;
  }
  if (details.hasAttribute('data-closing')) return;
  details.setAttribute('data-closing', '');
  const fade = content.animate(
    [
      { opacity: 1, scale: 1 },
      { opacity: 0, scale: 0.92 },
    ],
    { duration: 130, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
  );
  const done = () => {
    fade.cancel();
    // Reopened while fading: keep it open.
    if (!details.hasAttribute('data-closing')) return;
    details.removeAttribute('data-closing');
    details.removeAttribute('open');
  };
  // Background tabs pause animations; the timer still closes the menu.
  void Promise.race([fade.finished, new Promise((r) => setTimeout(r, 170))]).then(done, done);
}

/** Open a <details> menu, cancelling a fade-out that is still running. */
export function openMenu(details: HTMLDetailsElement) {
  details.removeAttribute('data-closing');
  details
    .querySelector<HTMLElement>('.message-menu-content, .chat-actions-menu')
    ?.getAnimations()
    .forEach((animation) => animation.cancel());
  details.open = true;
}

/** Summary click handler: toggle with the exit animation instead of the instant native close. */
export function toggleMenu(event: { preventDefault: () => void; currentTarget: Element }) {
  event.preventDefault();
  const details = event.currentTarget.closest('details')!;
  if (details.open && !details.hasAttribute('data-closing')) closeMenu(details);
  else openMenu(details);
}
