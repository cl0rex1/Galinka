import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

type Gesture = {
  pointer: number;
  x: number;
  y: number;
  row: HTMLElement | null;
  mode: 'reply' | 'back';
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
    if (current?.row) {
      current.row.style.removeProperty('--swipe-distance');
      current.row.style.removeProperty('--swipe-progress');
      current.row.removeAttribute('data-swiping');
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
    const mobile = matchMedia(
      '(max-width: 800px), (max-width: 960px) and (max-height: 500px) and (pointer: coarse)',
    ).matches;
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
    }
    current.distance = Math.max(0, dx);
    if (current.row) {
      current.row.setAttribute('data-swiping', 'true');
      current.row.style.setProperty('--swipe-distance', `${Math.min(86, dx * 0.7)}px`);
      current.row.style.setProperty('--swipe-progress', String(Math.min(1, dx / 72)));
    }
  }
  function up(event: ReactPointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    const activate = current.horizontal && current.distance >= (current.mode === 'back' ? 100 : 72);
    const id = current.row?.dataset.messageId;
    suppressClick.current = current.horizontal;
    reset();
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (activate) {
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
