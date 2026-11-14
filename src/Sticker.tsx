import { useEffect, useRef, useState } from 'react';
import type { AnimationItem } from 'lottie-web';
import { API_BASE } from './api';
import { STICKER_PACKS } from './stickerPacks';

const known = new Set(STICKER_PACKS.flatMap((pack) => pack.codes));

export const codeEmoji = (code: string) =>
  String.fromCodePoint(...code.split('_').map((hex) => parseInt(hex, 16)));

/** The animated sticker for an emoji, if there is one ("❤️" → "2764_fe0f"). */
export function animatedCode(emoji: string) {
  const points = [...emoji].map((char) => char.codePointAt(0)!.toString(16));
  const full = points.join('_');
  if (known.has(full)) return full;
  const bare = points.filter((hex) => hex !== 'fe0f').join('_');
  return known.has(bare) ? bare : null;
}
export const isStickerCode = (code: string) => known.has(code);

// The light build has no expression support, so it needs no eval under the CSP.
let player: Promise<typeof import('lottie-web/build/player/lottie_light')> | null = null;
const animations = new Map<string, Promise<unknown>>();
function animationData(code: string) {
  let found = animations.get(code);
  if (!found) {
    found = fetch(`${API_BASE}/stickers/${code}`).then((response) =>
      response.ok ? response.json() : Promise.reject(new Error(String(response.status))),
    );
    found.catch(() => animations.delete(code));
    animations.set(code, found);
  }
  return found;
}
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * An animated sticker. It loads once it scrolls into view and pauses outside it.
 * `hover`: the first frame until pointed at, for grids of many stickers.
 */
export function Sticker({
  code,
  size,
  hover = false,
  label,
}: {
  code: string;
  size: number;
  hover?: boolean;
  label?: string;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const el = box.current!;
    let animation: AnimationItem | undefined;
    let visible = false;
    let stopped = false;
    const still = hover || reducedMotion();
    const update = () => {
      if (!animation) return;
      if (visible && !still && !document.hidden) animation.play();
      else animation.pause();
    };
    const start = () => {
      player ??= import('lottie-web/build/player/lottie_light');
      Promise.all([player, animationData(code)])
        .then(([lottie, data]) => {
          if (stopped) return;
          animation = lottie.default.loadAnimation({
            container: el,
            renderer: 'svg',
            loop: true,
            autoplay: false,
            // The player writes into the data it is given.
            animationData: structuredClone(data),
          });
          animation.addEventListener('DOMLoaded', () => setReady(true));
          update();
        })
        .catch(() => {
          /* The emoji itself stays in place. */
        });
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !animation && !stopped) start();
      update();
    });
    observer.observe(el);
    const enter = () => hover && animation?.play();
    const leave = () => hover && animation?.goToAndStop(0, true);
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    document.addEventListener('visibilitychange', update);
    return () => {
      stopped = true;
      observer.disconnect();
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', leave);
      document.removeEventListener('visibilitychange', update);
      animation?.destroy();
    };
  }, [code, hover]);
  return (
    <span
      ref={box}
      className={`sticker-lottie ${ready ? 'ready' : ''}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label ?? codeEmoji(code)}
    >
      <span className="sticker-fallback" aria-hidden="true" style={{ fontSize: size * 0.7 }}>
        {codeEmoji(code)}
      </span>
    </span>
  );
}
