import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { motionAllowed } from './ui';

export type MenuItem = {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
};

/**
 * A menu at a point: right click, or a long press on a phone. It grows out of the point, stays
 * inside the screen, takes keyboard focus and closes on Esc, a press outside, scrolling or a
 * choice. Rendered into <body>, so no transformed ancestor can clip or shift it.
 */
export function ContextMenu({
  point,
  items,
  label,
  onClose,
}: {
  point: { x: number; y: number };
  items: MenuItem[];
  label: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const close = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, motionAllowed() ? 130 : 0);
  };
  const latestClose = useRef(close);
  latestClose.current = close;

  useLayoutEffect(() => {
    const menu = ref.current!;
    // Layout size: the entrance starts scaled down, and the scaled box would be too small.
    const width = menu.offsetWidth,
      height = menu.offsetHeight;
    const viewport = window.visualViewport;
    const right = (viewport?.width ?? innerWidth) - 8;
    const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight) - 8;
    const left = Math.max(8, Math.min(point.x, right - width));
    const top = Math.max(8, Math.min(point.y, bottom - height));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.transformOrigin = `${point.x - left}px ${point.y - top}px`;
    menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [point.x, point.y]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) latestClose.current();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        latestClose.current();
      }
    };
    const away = () => latestClose.current();
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', away);
    window.addEventListener('blur', away);
    document.addEventListener('scroll', away, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', away);
      window.removeEventListener('blur', away);
      document.removeEventListener('scroll', away, true);
    };
  }, []);

  return createPortal(
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label={label}
      data-closing={closing || undefined}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const all = [...ref.current!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
        const index = all.indexOf(document.activeElement as HTMLElement);
        all[(index + (event.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
      }}
    >
      {items.map(({ label: text, icon: Icon, onSelect, danger }) => (
        <button
          key={text}
          type="button"
          role="menuitem"
          className={danger ? 'danger-text' : undefined}
          onClick={() => {
            onSelect();
            close();
          }}
        >
          <Icon size={18} />
          {text}
        </button>
      ))}
    </div>,
    document.body,
  );
}
