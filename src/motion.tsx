import { useEffect, useRef, useSyncExternalStore } from 'react';
import { motionAllowed } from './ui';
const listeners = new Set<() => void>();
function read() {
  try {
    return localStorage.getItem('galinka-reduce-motion') === 'true';
  } catch {
    return document.documentElement.dataset.motion === 'reduced';
  }
}
function apply() {
  document.documentElement.dataset.motion = read() ? 'reduced' : 'system';
  listeners.forEach((listener) => listener());
}
window.addEventListener('storage', apply);
apply();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function MotionSettings() {
  const reduced = useSyncExternalStore(subscribe, read);
  return (
    <div className="settings-row">
      <div>
        <h3>Меньше анимации</h3>
      </div>
      <button
        className={`switch ${reduced ? 'on' : ''}`}
        role="switch"
        aria-label="Уменьшить анимацию"
        aria-checked={reduced}
        onClick={() => {
          document.documentElement.dataset.motion = reduced ? 'system' : 'reduced';
          try {
            localStorage.setItem('galinka-reduce-motion', String(!reduced));
          } catch {}
          apply();
        }}
      >
        <span />
      </button>
    </div>
  );
}


/** A short cross-fade with a touch of blur: an icon or a line of text replaced in place. */
export const SWAP_IN: Keyframe[] = [
  { opacity: 0, scale: 0.6, filter: 'blur(2px)' },
  { opacity: 1, scale: 1, filter: 'blur(0)' },
];
export const TEXT_IN: Keyframe[] = [
  { opacity: 0, filter: 'blur(2px)' },
  { opacity: 1, filter: 'blur(0)' },
];

/**
 * Plays `keyframes` on the element when `value` changes while it stays on screen. Nothing plays
 * on the first paint, on a remount (a virtualized row scrolled back in) or when `scope` changes
 * (another chat opened): only a real change of state is animated.
 */
export function useAnimateOnChange<T extends HTMLElement>(
  value: unknown,
  keyframes: Keyframe[] = SWAP_IN,
  scope?: unknown,
  duration = 200,
) {
  const ref = useRef<T>(null);
  const last = useRef({ value, scope });
  useEffect(() => {
    const previous = last.current;
    last.current = { value, scope };
    if (previous.scope !== scope || Object.is(previous.value, value)) return;
    if (!ref.current || !motionAllowed()) return;
    ref.current.animate(keyframes, { duration, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  }, [value, scope, keyframes, duration]);
  return ref;
}

/** A line of text that cross-fades when it changes in place ("в сети" → "печатает…"). */
export function AnimatedText({
  text,
  scope,
  className,
}: {
  text: string;
  /** Changing it (another chat) swaps the text without animation. */
  scope?: unknown;
  className?: string;
}) {
  const ref = useAnimateOnChange<HTMLParagraphElement>(text, TEXT_IN, scope, 160);
  return (
    <p ref={ref} className={className}>
      {text}
    </p>
  );
}
