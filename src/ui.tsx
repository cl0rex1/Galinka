import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';
import { isPhoneLayout } from './layout';

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
  const sheet = useSheetDrag(() => requestClose());
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
        sheet.onPointerDown(e);
      }}
      onPointerMove={sheet.onPointerMove}
      onPointerUp={sheet.onPointerUp}
      onPointerCancel={sheet.onPointerCancel}
      onClickCapture={sheet.onClickCapture}
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

/**
 * A bottom sheet on a phone follows the finger down and closes when pulled far enough or
 * flicked. It is pulled by its head (with the grabber above the title), which does not scroll, so
 * scrolling the content never closes it by accident. Spread the handlers on the <dialog>;
 * `close` plays the usual exit from where the finger left it.
 */
/** Where a sheet can be grabbed: its head. CSS gives these `touch-action: none` on phones. */
const SHEET_HANDLE = '.modal-head, .attach-dialog-head, .sheet-handle';
export function useSheetDrag(close: () => void, enabled = true) {
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    dy: number;
    last: { y: number; t: number };
    speed: number;
    active: boolean;
  } | null>(null);
  const moved = useRef(false);
  const settle = (dialog: HTMLElement) => {
    dialog.style.transition = 'translate 260ms cubic-bezier(0.23, 1, 0.32, 1)';
    dialog.style.translate = '0 0';
    setTimeout(() => {
      dialog.style.removeProperty('transition');
      dialog.style.removeProperty('translate');
    }, 280);
  };
  return {
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      moved.current = false;
      const target = event.target as Element;
      if (
        !enabled ||
        event.pointerType === 'mouse' ||
        !event.isPrimary ||
        !isPhoneLayout() ||
        !target.closest(SHEET_HANDLE) ||
        target.closest('input, textarea, select, [role="slider"]')
      )
        return;
      drag.current = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        dy: 0,
        last: { y: event.clientY, t: performance.now() },
        speed: 0,
        active: false,
      };
    },
    onPointerMove(event: ReactPointerEvent<HTMLElement>) {
      const current = drag.current;
      if (!current || current.pointer !== event.pointerId) return;
      const dx = event.clientX - current.x;
      current.dy = event.clientY - current.y;
      if (!current.active) {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(current.dy)) return void (drag.current = null);
        if (current.dy < -6) return void (drag.current = null);
        if (current.dy < 10) return;
        current.active = true;
        moved.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.style.transition = 'none';
      }
      const now = performance.now();
      current.speed = (event.clientY - current.last.y) / Math.max(1, now - current.last.t);
      current.last = { y: event.clientY, t: now };
      // Upwards it gives a little and resists.
      const offset = current.dy > 0 ? current.dy : current.dy * 0.2;
      event.currentTarget.style.translate = `0 ${offset}px`;
    },
    onPointerUp(event: ReactPointerEvent<HTMLElement>) {
      const current = drag.current;
      drag.current = null;
      if (!current?.active || current.pointer !== event.pointerId) return;
      const dialog = event.currentTarget;
      const height = dialog.getBoundingClientRect().height;
      if (current.dy > Math.min(140, height * 0.3) || (current.speed > 0.5 && current.dy > 30)) {
        // The exit transition starts from where the finger left the sheet.
        dialog.style.removeProperty('transition');
        close();
        requestAnimationFrame(() => dialog.style.removeProperty('translate'));
      } else settle(dialog);
    },
    onPointerCancel(event: ReactPointerEvent<HTMLElement>) {
      if (drag.current?.active) settle(event.currentTarget);
      drag.current = null;
    },
    /** A drag is not a tap on whatever it started on. */
    onClickCapture(event: React.MouseEvent) {
      if (!moved.current) return;
      moved.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
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
  // Tabs that do not fit fade out at the edge where more of them hide, so it is clear the row
  // scrolls; the next tab peeks out half-cut, as in Telegram.
  const edges = useCallback(() => {
    const el = list.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    el.dataset.more = left && right ? 'both' : left ? 'left' : right ? 'right' : '';
  }, []);
  const measure = useCallback(() => {
    const el = list.current;
    if (!el) return;
    const tab = el.querySelector<HTMLElement>('[aria-selected="true"], [aria-pressed="true"]');
    el.style.setProperty('--tab-x', `${tab?.offsetLeft ?? 0}px`);
    el.style.setProperty('--tab-w', `${tab?.offsetWidth ?? 0}px`);
    // Bring the chosen tab towards the middle, so its neighbours on both sides show.
    if (tab && el.scrollWidth > el.clientWidth)
      el.scrollTo({
        left: tab.offsetLeft - (el.clientWidth - tab.offsetWidth) / 2,
        behavior: el.classList.contains('ready') && motionAllowed() ? 'smooth' : 'auto',
      });
    edges();
    requestAnimationFrame(() => el.classList.add('ready'));
  }, [edges]);
  useLayoutEffect(measure, [selected, measure]);
  return useCallback(
    (el: HTMLElement | null) => {
      list.current = el;
      if (!el) return;
      measure();
      // Tab widths change once the web font arrives.
      void document.fonts?.ready.then(measure);
      // A mouse wheel scrolls the row sideways.
      const wheel = (event: WheelEvent) => {
        if (el.scrollWidth <= el.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY))
          return;
        event.preventDefault();
        el.scrollBy({ left: event.deltaY });
      };
      const resize = new ResizeObserver(edges);
      resize.observe(el);
      el.addEventListener('scroll', edges, { passive: true });
      el.addEventListener('wheel', wheel, { passive: false });
      return () => {
        resize.disconnect();
        el.removeEventListener('scroll', edges);
        el.removeEventListener('wheel', wheel);
      };
    },
    [measure, edges],
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

/**
 * What "Назад" closes next. A screen opened over another (a settings page, a panel) registers a
 * handler while it is open; the Android back button and Esc run the newest one first.
 */
const backHandlers: (() => void)[] = [];
export function useBackHandler(active: boolean, handler: () => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!active) return;
    const entry = () => latest.current();
    backHandlers.push(entry);
    return () => {
      const index = backHandlers.lastIndexOf(entry);
      if (index >= 0) backHandlers.splice(index, 1);
    };
  }, [active]);
}
/** Runs the newest back handler; false when nothing registered one. */
export function runBackHandler() {
  const handler = backHandlers.at(-1);
  if (!handler) return false;
  handler();
  return true;
}

/**
 * A short tap of the vibration motor on phones that have one: a gesture passed its point, a menu
 * opened by a long press. Nothing on computers or when the person asked for less motion.
 */
export function haptic(strength: 'tick' | 'press' = 'tick') {
  if (!matchMedia('(pointer: coarse)').matches || !motionAllowed()) return;
  try {
    navigator.vibrate?.(strength === 'tick' ? 6 : 14);
  } catch {
    /* Some browsers refuse vibration without a recent tap; that is fine. */
  }
}
