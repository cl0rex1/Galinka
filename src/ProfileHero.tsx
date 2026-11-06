import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { motionAllowed } from './ui';
import { Avatar } from './Avatar';
import type { Chat, Person } from './types';

const PULL = 110; // px of overscroll that opens the large avatar

/**
 * Profile header in the manner of Telegram for iOS: pulling the page down past its top
 * (touch drag or trackpad overscroll) grows the avatar into a full-width picture;
 * scrolling back down folds it. A tap on the avatar does the same for mouse and keyboard.
 */
export function ProfileHero({
  person,
  chat,
  title,
  subtitle,
  children,
}: {
  person?: Person | null;
  chat?: Chat;
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  const hero = useRef<HTMLDivElement>(null);
  const [expanded, setOpen] = useState(false);
  const expandedRef = useRef(false);
  expandedRef.current = expanded;
  // The name and username glide between their places under the avatar and on the photo
  // (FLIP: remember where they were, then animate from there to the new layout).
  const before = useRef<DOMRect[] | null>(null);
  const lines = () => [...(hero.current?.querySelectorAll<HTMLElement>('.hero-text > *') ?? [])];
  const setExpanded = (value: boolean | ((current: boolean) => boolean)) => {
    const next = typeof value === 'function' ? value(expandedRef.current) : value;
    if (next === expandedRef.current) return;
    before.current = lines().map((line) => line.getBoundingClientRect());
    setOpen(next);
  };
  const setExpandedRef = useRef(setExpanded);
  setExpandedRef.current = setExpanded;
  useLayoutEffect(() => {
    const rects = before.current;
    before.current = null;
    if (!rects || !motionAllowed()) return;
    lines().forEach((line, index) => {
      const from = rects[index];
      const to = line.getBoundingClientRect();
      if (!from) return;
      line.animate(
        [{ translate: `${from.left - to.left}px ${from.top - to.top}px` }, { translate: '0 0' }],
        { duration: 420, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
      );
    });
  }, [expanded]);

  useEffect(() => {
    const el = hero.current!;
    let scroller: HTMLElement | null = el.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY))
      scroller = scroller.parentElement;
    if (!scroller) return;
    const box = scroller;
    let startY: number | null = null;
    let wheel = 0;
    let wheelTimer: ReturnType<typeof setTimeout> | undefined;
    const setPull = (value: number) => el.style.setProperty('--pull', String(value));
    const start = (event: TouchEvent) => {
      startY = box.scrollTop <= 0 ? event.touches[0].clientY : null;
    };
    const move = (event: TouchEvent) => {
      if (startY === null) return;
      const dy = event.touches[0].clientY - startY;
      if (expandedRef.current) {
        if (dy < -24) setExpandedRef.current(false);
        return;
      }
      setPull(Math.max(0, Math.min(1, dy / PULL)));
      if (dy > PULL) {
        setExpandedRef.current(true);
        setPull(0);
        startY = null;
      }
    };
    const end = () => {
      startY = null;
      setPull(0);
    };
    const onWheel = (event: WheelEvent) => {
      if (box.scrollTop > 0) return;
      if (expandedRef.current) {
        if (event.deltaY > 8) setExpandedRef.current(false);
        return;
      }
      if (event.deltaY >= 0) return;
      wheel -= event.deltaY;
      setPull(Math.min(1, wheel / (PULL * 2)));
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => {
        wheel = 0;
        setPull(0);
      }, 180);
      if (wheel > PULL * 2) {
        wheel = 0;
        setPull(0);
        setExpandedRef.current(true);
      }
    };
    const onScroll = () => {
      if (expandedRef.current && box.scrollTop > 40) setExpandedRef.current(false);
    };
    box.addEventListener('touchstart', start, { passive: true });
    box.addEventListener('touchmove', move, { passive: true });
    box.addEventListener('touchend', end);
    box.addEventListener('touchcancel', end);
    box.addEventListener('wheel', onWheel, { passive: true });
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(wheelTimer);
      box.removeEventListener('touchstart', start);
      box.removeEventListener('touchmove', move);
      box.removeEventListener('touchend', end);
      box.removeEventListener('touchcancel', end);
      box.removeEventListener('wheel', onWheel);
      box.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <div ref={hero} className={`profile-hero ${expanded ? 'expanded' : ''}`}>
      <button
        type="button"
        className="hero-avatar"
        aria-expanded={expanded}
        aria-label={expanded ? 'Свернуть аватар' : 'Развернуть аватар'}
        onClick={() => setExpanded((v) => !v)}
      >
        <Avatar person={person} chat={chat} size="large" />
      </button>
      <div className="hero-text">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}
