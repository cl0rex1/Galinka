import { useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { Check, Copy, Download, Share2 } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { encodeTheme, type CustomTheme } from './theme';
import { Modal } from './ui';

// The app inside Android has no public address of its own; links point to the website.
const origin = () =>
  Capacitor.getPlatform() === 'android' ? 'https://mess.quiby.me' : location.origin;
export const profileLink = (username: string) =>
  `${origin()}/app?u=${encodeURIComponent(username)}`;
export const loginLink = (token: string) => `${origin()}/app?login=${token}`;
export const currentAccent = () =>
  getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#b3302a';
export const themeLink = (theme: CustomTheme) => `${origin()}/app?theme=${encodeTheme(theme)}`;

// The Galinka mark from public/icon.svg, drawn white in the middle of the code.
const glyph =
  'M89 42C67 20 29 38 34 67c3 23 26 33 47 23l15 5-4-19c-9 10-25 14-36 4-14-13-3-34 14-31 5 1 9 3 12 7';

/**
 * Branded QR code: round dots, rounded corner eyes in the accent colour, the logo in the middle.
 * High error correction (30 %) leaves room for the logo; dots stay dark on white for scanners.
 */
export function BrandQR({ value, accent }: { value: string; accent: string }) {
  const code = useMemo(() => {
    const qr = qrcode(0, 'H');
    qr.addData(value);
    qr.make();
    return qr;
  }, [value]);
  const n = code.getModuleCount();
  const logo = Math.round(n * 0.24) | 1;
  const from = (n - logo) / 2;
  const eye = (r: number, c: number) =>
    (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  const covered = (r: number, c: number) =>
    r >= from - 1 && r < from + logo + 1 && c >= from - 1 && c < from + logo + 1;
  const dots: string[] = [];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (code.isDark(r, c) && !eye(r, c) && !covered(r, c))
        dots.push(`M${c + 0.5} ${r + 0.08}a.42.42 0 1 1 0 .84a.42.42 0 1 1 0-.84`);
  return (
    <svg className="brand-qr" viewBox={`-2 -2 ${n + 4} ${n + 4}`} role="img" aria-label="QR-код">
      <rect x="-2" y="-2" width={n + 4} height={n + 4} fill="#ffffff" />
      <path d={dots.join('')} fill="#16161a" />
      {[
        [0, 0],
        [n - 7, 0],
        [0, n - 7],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`} fill={accent}>
          <rect x={x + 0.5} y={y + 0.5} width="6" height="6" rx="2" fill="none" stroke={accent} />
          <rect x={x + 2} y={y + 2} width="3" height="3" rx="1" />
        </g>
      ))}
      <rect x={from} y={from} width={logo} height={logo} rx={logo * 0.27} fill={accent} />
      <g transform={`translate(${from} ${from}) scale(${logo / 128})`}>
        <path
          d={glyph}
          fill="none"
          stroke="#fff"
          strokeWidth="11"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="70" cy="68" r="5" fill="#fff" />
      </g>
    </svg>
  );
}

/** Share a link as a branded card with its QR code: copy, system share, save the picture. */
export function ShareSheet({
  title,
  subtitle,
  link,
  accent,
  heading = 'Поделиться',
  onClose,
}: {
  title: string;
  subtitle: string;
  link: string;
  accent: string;
  heading?: string;
  onClose: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Не удалось скопировать. Выделите ссылку и скопируйте вручную.');
    }
  }
  // Draw the code onto a canvas and save it as a PNG, white margin included.
  async function save() {
    const svg = card.current?.querySelector('svg');
    if (!svg) return;
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024;
    canvas.getContext('2d')!.drawImage(image, 0, 0, 1024, 1024);
    const linkElement = document.createElement('a');
    linkElement.href = canvas.toDataURL('image/png');
    linkElement.download = `galinka-${title.replace(/[^\p{L}\p{N}]+/gu, '-')}.png`;
    linkElement.click();
  }
  return (
    <Modal title={heading} onClose={onClose} error={error}>
      <div className="share-card" ref={card} style={{ '--share-accent': accent } as never}>
        <BrandQR value={link} accent={accent} />
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      <div className="share-link">
        <input aria-label="Ссылка" readOnly value={link} onFocus={(e) => e.target.select()} />
        <button type="button" className="primary" onClick={() => void copy()}>
          {copied ? <Check size={17} /> : <Copy size={17} />}
          {copied ? 'Скопировано' : 'Копировать'}
        </button>
      </div>
      <div className="share-actions">
        {'share' in navigator && (
          <button
            type="button"
            className="secondary"
            onClick={() => void navigator.share({ title, url: link }).catch(() => {})}
          >
            <Share2 size={17} />
            Отправить
          </button>
        )}
        <button type="button" className="secondary" onClick={() => void save()}>
          <Download size={17} />
          Сохранить QR
        </button>
      </div>
    </Modal>
  );
}
