import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { PHONE_LAYOUT } from './layout';
import { haptic, motionAllowed } from './ui';

/**
 * A screen dragged back from the left edge, as in iOS: it follows the finger one to one, the
 * screen under it shows through, and on release it either leaves (far enough or flicked) or
 * settles back. `shell` gets data-swipe while dragging, so CSS can reveal what lies beneath.
 */
export class EdgeDrag {
  private width: number;
  private last = { x: 0, t: 0 };
  private speed = 0;
  private past = false;
  distance = 0;
  constructor(
    private layer: HTMLElement,
    private shell: HTMLElement | null,
    private x: number,
  ) {
    this.width = layer.getBoundingClientRect().width || window.innerWidth;
    this.last = { x, t: performance.now() };
    layer.style.transition = 'none';
    layer.style.willChange = 'translate';
    shell?.setAttribute('data-swipe', 'back');
  }
  move(clientX: number) {
    const now = performance.now();
    this.speed = (clientX - this.last.x) / Math.max(1, now - this.last.t);
    this.last = { x: clientX, t: now };
    this.distance = Math.max(0, Math.min(this.width, clientX - this.x));
    // A light tap of the motor as the screen passes the point where letting go leaves.
    const past = this.distance > this.threshold;
    if (past && !this.past) haptic();
    this.past = past;
    this.layer.style.translate = `${this.distance}px 0`;
    this.shell?.style.setProperty('--back-progress', String(this.distance / this.width));
  }
  /** Where letting go leaves: a third of the screen, but never more than a short reach. */
  private get threshold() {
    return Math.min(this.width * 0.3, 110);
  }
  /** Far enough, or a quick flick to the right. */
  get leaving() {
    return this.distance > this.threshold || (this.speed > 0.5 && this.distance > 32);
  }
  release(leave: boolean, onLeave: () => void) {
    const { layer, shell } = this;
    const finish = () => {
      layer.style.removeProperty('translate');
      layer.style.removeProperty('transition');
      layer.style.removeProperty('will-change');
      shell?.removeAttribute('data-swipe');
      shell?.style.removeProperty('--back-progress');
    };
    if (!motionAllowed()) {
      finish();
      if (leave) onLeave();
      return;
    }
    if (leave && !shell) layer.style.removeProperty('will-change');
    const duration = leave ? 220 : 260;
    layer.style.transition = `translate ${duration}ms cubic-bezier(0.23, 1, 0.32, 1)`;
    layer.style.translate = leave ? `${this.width}px 0` : '0 0';
    shell?.style.setProperty('transition', `--back-progress ${duration}ms`);
    shell?.style.setProperty('--back-progress', leave ? '1' : '0');
    setTimeout(() => {
      shell?.style.removeProperty('transition');
      if (!leave) return finish();
      // A panel stays where the finger left it until it unmounts, without its exit animation.
      if (!shell) {
        layer.setAttribute('data-swiped', '');
        onLeave();
        return;
      }
      // The screen under it is already in place: it must not play its own entrance again.
      shell.setAttribute('data-swiped', '');
      onLeave();
      requestAnimationFrame(() => requestAnimationFrame(finish));
      setTimeout(() => shell?.removeAttribute('data-swiped'), 450);
    }, duration);
  }
  cancel() {
    this.release(false, () => {});
  }
}

type Gesture = {
  pointer: number;
  x: number;
  y: number;
  row: HTMLElement | null;
  mode: 'reply' | 'back';
  drag?: EdgeDrag;
  horizontal: boolean;
  distance: number;
};
const interactive = 'button, a, input, textarea, select, audio, video, details, [role="button"]';

// One delegated pointer handler for the conversation: no React render on each pixel.
export function useConversationGestures(options: {
  enabled: boolean;
  chatId: string | null;
  onReply: (id: string) => void;
  onBack: () => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  function reset() {
    const current = gesture.current;
    current?.drag?.cancel();
    if (current?.row) {
      current.row.style.removeProperty('--swipe-distance');
      current.row.style.removeProperty('--swipe-progress');
      current.row.removeAttribute('data-swiping');
      current.row.removeAttribute('data-armed');
    }
    gesture.current = null;
  }
  useEffect(() => {
    reset();
    return reset;
  }, [options.chatId, options.enabled]);
  function down(event: ReactPointerEvent<HTMLElement>) {
    suppressClick.current = false;
    if (gesture.current) {
      reset();
      return;
    }
    if (
      !latest.current.enabled ||
      event.pointerType === 'mouse' ||
      !event.isPrimary ||
      !(event.target instanceof Element) ||
      event.target.closest(interactive) ||
      window.getSelection()?.toString()
    )
      return;
    const row = event.target.closest<HTMLElement>('[data-message-id]');
    const mobile = matchMedia(PHONE_LAYOUT).matches;
    const back = mobile && event.clientX - event.currentTarget.getBoundingClientRect().left < 28;
    if (!row && !back) return;
    suppressClick.current = false;
    gesture.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      row: back ? null : row,
      mode: back ? 'back' : 'reply',
      horizontal: false,
      distance: 0,
    };
  }
  function move(event: ReactPointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    const dx = event.clientX - current.x,
      dy = event.clientY - current.y;
    if (!current.horizontal) {
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) {
        reset();
        return;
      }
      if (dx < -10) {
        reset();
        return;
      }
      if (dx < 12 || dx < Math.abs(dy) * 1.4) return;
      current.horizontal = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      const screen = event.currentTarget.closest<HTMLElement>('.workspace');
      if (current.mode === 'back' && screen)
        current.drag = new EdgeDrag(screen, screen.closest('.app-shell'), current.x);
    }
    current.distance = Math.max(0, dx);
    current.drag?.move(event.clientX);
    if (current.row) {
      if (current.distance >= 72 !== current.row.hasAttribute('data-armed')) {
        current.row.toggleAttribute('data-armed');
        if (current.distance >= 72) haptic();
      }
      current.row.setAttribute('data-swiping', 'true');
      current.row.style.setProperty('--swipe-distance', `${Math.min(86, dx * 0.7)}px`);
      current.row.style.setProperty('--swipe-progress', String(Math.min(1, dx / 72)));
    }
  }
  function up(event: ReactPointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    const drag = current.drag;
    const activate = drag
      ? drag.leaving
      : current.horizontal && current.distance >= (current.mode === 'back' ? 100 : 72);
    const id = current.row?.dataset.messageId;
    suppressClick.current = current.horizontal;
    current.drag = undefined;
    reset();
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag) drag.release(activate, () => latest.current.onBack());
    else if (activate) {
      if (current.mode === 'back') latest.current.onBack();
      else if (id) latest.current.onReply(id);
    }
  }
  return {
    onPointerDown: down,
    onPointerMove: move,
    onPointerUp: up,
    onPointerCancel: reset,
    onClickCapture: (event: React.MouseEvent<HTMLElement>) => {
      if (suppressClick.current) {
        event.preventDefault();
        event.stopPropagation();
        suppressClick.current = false;
      }
    },
  };
}

/**
 * The same exit without a finger: "Назад" on a phone slides the chat off to the right while the
 * list comes in from under it, the reverse of opening. Elsewhere it simply runs `onDone`.
 */
export function slideBack(screen: Element | null, onDone: () => void) {
  if (!(screen instanceof HTMLElement) || !matchMedia(PHONE_LAYOUT).matches || !motionAllowed())
    return onDone();
  // Already on its way out: a second press must not start the exit again.
  if (screen.closest('.app-shell')?.hasAttribute('data-swipe')) return;
  new EdgeDrag(screen, screen.closest('.app-shell'), 0).release(true, onDone);
}

/** Drag a full-screen panel away from its left edge (the chat profile on a phone). */
export function usePanelSwipeBack(onBack: () => void) {
  const latest = useRef(onBack);
  latest.current = onBack;
  const drag = useRef<{ pointer: number; x: number; y: number; edge?: EdgeDrag } | null>(null);
  return {
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      if (
        event.pointerType === 'mouse' ||
        !event.isPrimary ||
        !matchMedia(PHONE_LAYOUT).matches ||
        event.clientX - event.currentTarget.getBoundingClientRect().left > 28
      )
        return;
      drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
    },
    onPointerMove(event: ReactPointerEvent<HTMLElement>) {
      const current = drag.current;
      if (!current || current.pointer !== event.pointerId) return;
      const dx = event.clientX - current.x,
        dy = event.clientY - current.y;
      if (!current.edge) {
        if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) return void (drag.current = null);
        if (dx < 12 || dx < Math.abs(dy) * 1.4) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        current.edge = new EdgeDrag(event.currentTarget, null, current.x);
      }
      current.edge.move(event.clientX);
    },
    onPointerUp(event: ReactPointerEvent<HTMLElement>) {
      const current = drag.current;
      drag.current = null;
      if (!current?.edge || current.pointer !== event.pointerId) return;
      current.edge.release(current.edge.leaving, () => latest.current());
    },
    onPointerCancel() {
      drag.current?.edge?.cancel();
      drag.current = null;
    },
  };
}
