import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Apple,
  Car,
  Clock3,
  Flag,
  Heart,
  Lightbulb,
  PawPrint,
  Search,
  Smile,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import { api, API_BASE } from './api';
import { codeEmoji, Sticker } from './Sticker';
import { STICKER_PACKS } from './stickerPacks';

export type StickerEntry = { id: string; label: string; accent: string };
export type GifEntry = { id: string; title: string; keywords: string; previewUrl?: string };

export const STICKERS: StickerEntry[] = [
  { id: 'hi', label: 'Привет!', accent: '#ff7a59' },
  { id: 'love', label: 'Обожаю', accent: '#f43f5e' },
  { id: 'haha', label: 'Ха-ха!', accent: '#f59e0b' },
  { id: 'ok', label: 'Принято!', accent: '#3b82f6' },
  { id: 'fire', label: 'Огонь!', accent: '#ea580c' },
  { id: 'tea', label: 'Чай-кофе', accent: '#10b981' },
  { id: 'sleep', label: 'Спать…', accent: '#6366f1' },
  { id: 'shock', label: 'Ого!', accent: '#8b5cf6' },
  { id: 'hug', label: 'Обнимаю', accent: '#ec4899' },
  { id: 'party', label: 'Ура!', accent: '#14b8a6' },
  { id: 'cat', label: 'Мур', accent: '#f97316' },
  { id: 'rocket', label: 'Погнали!', accent: '#0ea5e9' },
];

export const GIFS: GifEntry[] = [
  { id: 'dance', title: 'Танцы', keywords: 'танец веселье музыка party dance' },
  { id: 'applause', title: 'Браво!', keywords: 'браво хлопаю супер applause clap' },
  { id: 'rocket', title: 'В космос', keywords: 'ракета старт вперед космос rocket' },
  { id: 'coffee', title: 'Утренний кофе', keywords: 'кофе утро доброе coffee morning' },
  { id: 'heart', title: 'Сердечко', keywords: 'любовь сердце heart love' },
  { id: 'confetti', title: 'Праздник', keywords: 'праздник салют ура confetti party' },
  { id: 'cat-type', title: 'Котик печатает', keywords: 'кот работаю чат cat typing' },
  { id: 'thumb', title: 'Топчик', keywords: 'класс ок лайк cool ok' },
];

function safeProxiedGifUrl(rawUrl?: string): string | null {
  if (!rawUrl) return null;
  try {
    const u = new URL(rawUrl);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return `${API_BASE}/link-preview/image?url=${encodeURIComponent(u.href)}`;
    }
  } catch {
    return null;
  }
  return null;
}

/** Expressive transparent-background vector SVG sticker artwork (matches Telegram/Signal sticker packs). */
export function StickerArtwork({
  id,
  label,
  size = 128,
}: {
  id: string;
  label?: string;
  size?: number;
}) {
  const uid = useId().replace(/:/g, '');
  const g1 = `sg1-${uid}`;
  const g2 = `sg2-${uid}`;
  const sticker = STICKERS.find((s) => s.id === id);
  const accent = sticker?.accent || '#6366f1';

  return (
    <svg
      className="sticker-svg"
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label={label || sticker?.label || 'Стикер'}
    >
      <defs>
        <linearGradient id={g1} x1="15%" y1="10%" x2="85%" y2="90%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="100%" stopColor={accent} stopOpacity="0.24" />
        </linearGradient>
        <linearGradient id={g2} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fde047" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      {/* Die-cut white sticker outline */}
      <circle cx="60" cy="60" r="50" fill="#ffffff" stroke="#e2e8f0" strokeWidth="2.5" />
      <circle cx="60" cy="60" r="45" fill={`url(#${g1})`} />
      {id === 'hi' && (
        <g>
          <circle cx="60" cy="62" r="28" fill={`url(#${g2})`} stroke="#78350f" strokeWidth="2.5" />
          <circle cx="51" cy="56" r="3.4" fill="#1e293b" />
          <circle cx="69" cy="56" r="3.4" fill="#1e293b" />
          <ellipse cx="44" cy="64" rx="4.5" ry="2.8" fill="#fb7185" opacity="0.65" />
          <ellipse cx="76" cy="64" rx="4.5" ry="2.8" fill="#fb7185" opacity="0.65" />
          <path
            d="M49 67 Q60 78 71 67"
            fill="none"
            stroke="#78350f"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <g className="sticker-anim-wave" transform="translate(82 32)">
            <path
              d="M4 18 C2 8 10 2 14 10 C17 2 24 6 20 16 C25 14 27 22 20 26 L10 27 Z"
              fill="#fed7aa"
              stroke="#78350f"
              strokeWidth="2.2"
              strokeLinejoin="round"
            />
            <path
              d="M-4 4 Q-9 -2 -3 -8"
              fill="none"
              stroke={accent}
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </g>
        </g>
      )}
      {id === 'love' && (
        <g>
          <path
            className="sticker-anim-beat"
            d="M60 90 C30 70 22 48 34 34 C44 23 56 29 60 39 C64 29 76 23 86 34 C98 48 90 70 60 90 Z"
            fill="#f43f5e"
            stroke="#881337"
            strokeWidth="2.8"
            strokeLinejoin="round"
          />
          <path
            d="M39 40 C42 35 48 34 51 37"
            fill="none"
            stroke="#fff"
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.85"
          />
          <circle cx="30" cy="28" r="3.5" fill="#fb7185" />
          <circle cx="92" cy="30" r="4.5" fill="#fda4af" />
          <path d="M88 78 l4 -4 4 4 -4 4 z" fill="#f43f5e" />
        </g>
      )}
      {id === 'haha' && (
        <g>
          <circle cx="60" cy="62" r="29" fill={`url(#${g2})`} stroke="#78350f" strokeWidth="2.5" />
          <path
            d="M44 54 Q50 48 56 54"
            fill="none"
            stroke="#1e293b"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M64 54 Q70 48 76 54"
            fill="none"
            stroke="#1e293b"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path d="M45 64 Q60 85 75 64 Z" fill="#991b1b" stroke="#78350f" strokeWidth="2.2" />
          <path d="M51 74 Q60 81 69 74" fill="#fb7185" />
          <path d="M31 58 C24 58 23 68 31 68 Z" fill="#38bdf8" stroke="#0284c7" strokeWidth="1.8" />
          <path d="M89 58 C96 58 97 68 89 68 Z" fill="#38bdf8" stroke="#0284c7" strokeWidth="1.8" />
        </g>
      )}
      {id === 'ok' && (
        <g>
          <circle cx="60" cy="60" r="29" fill="#3b82f6" stroke="#1e3a8a" strokeWidth="2.5" />
          <path
            d="M44 60 L55 71 L77 48"
            fill="none"
            stroke="#ffffff"
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="28" cy="36" r="3.5" fill="#60a5fa" />
          <circle cx="93" cy="81" r="4" fill="#93c5fd" />
        </g>
      )}
      {id === 'fire' && (
        <g>
          <path
            className="sticker-anim-beat"
            d="M62 22 C74 38 89 48 86 70 C84 85 72 93 60 93 C44 93 34 81 35 66 C36 53 45 45 48 35 C52 43 56 44 58 37 C59 31 60 27 62 22 Z"
            fill="#f97316"
            stroke="#7c2d12"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <path
            d="M61 48 C69 57 74 64 72 75 C71 84 65 89 59 89 C51 89 46 83 47 73 C48 64 56 57 61 48 Z"
            fill="#fde047"
          />
          <circle cx="34" cy="36" r="3" fill="#fb923c" />
          <circle cx="88" cy="34" r="2.5" fill="#fbbf24" />
        </g>
      )}
      {id === 'tea' && (
        <g>
          <path
            d="M46 34 Q42 26 48 20"
            fill="none"
            stroke="#94a3b8"
            strokeWidth="2.6"
            strokeLinecap="round"
            className="sticker-anim-steam"
          />
          <path
            d="M60 32 Q56 24 62 18"
            fill="none"
            stroke="#94a3b8"
            strokeWidth="2.6"
            strokeLinecap="round"
            className="sticker-anim-steam"
          />
          <path
            d="M74 34 Q70 26 76 20"
            fill="none"
            stroke="#94a3b8"
            strokeWidth="2.6"
            strokeLinecap="round"
            className="sticker-anim-steam"
          />
          <path
            d="M78 52 H88 C94 52 96 67 88 69 H77"
            fill="none"
            stroke="#78350f"
            strokeWidth="4.5"
            strokeLinecap="round"
          />
          <path
            d="M36 46 H80 L76 78 C75 84 69 88 58 88 C47 88 41 84 40 78 Z"
            fill="#fef3c7"
            stroke="#78350f"
            strokeWidth="2.8"
            strokeLinejoin="round"
          />
          <ellipse
            cx="58"
            cy="46"
            rx="22"
            ry="6"
            fill="#92400e"
            stroke="#78350f"
            strokeWidth="2.2"
          />
          <path
            d="M51 64 Q58 70 65 64"
            fill="none"
            stroke="#78350f"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </g>
      )}
      {id === 'sleep' && (
        <g>
          <circle cx="58" cy="64" r="27" fill="#a5b4fc" stroke="#312e81" strokeWidth="2.5" />
          <path
            d="M44 60 Q50 65 55 60"
            fill="none"
            stroke="#1e1b4b"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          <path
            d="M62 60 Q68 65 73 60"
            fill="none"
            stroke="#1e1b4b"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          <ellipse cx="58" cy="72" rx="4.5" ry="5.5" fill="#312e81" />
          <text
            x="72"
            y="38"
            fill="#4f46e5"
            fontSize="16"
            fontWeight="800"
            className="sticker-anim-steam"
          >
            Z
          </text>
          <text x="84" y="27" fill="#6366f1" fontSize="13" fontWeight="800">
            z
          </text>
        </g>
      )}
      {id === 'shock' && (
        <g>
          <circle cx="60" cy="62" r="28" fill={`url(#${g2})`} stroke="#581c87" strokeWidth="2.5" />
          <circle cx="50" cy="56" r="5" fill="#ffffff" stroke="#1e293b" strokeWidth="2" />
          <circle cx="70" cy="56" r="5" fill="#ffffff" stroke="#1e293b" strokeWidth="2" />
          <circle cx="50" cy="56" r="2.2" fill="#0f172a" />
          <circle cx="70" cy="56" r="2.2" fill="#0f172a" />
          <ellipse cx="60" cy="73" rx="6" ry="8" fill="#7c2d12" />
          <path
            d="M27 32 L36 39 M93 32 L84 39 M60 19 V29"
            stroke="#8b5cf6"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>
      )}
      {id === 'hug' && (
        <g>
          <circle cx="48" cy="58" r="19" fill="#fbcfe8" stroke="#831843" strokeWidth="2.4" />
          <circle cx="72" cy="58" r="19" fill="#bfdbfe" stroke="#1e3a8a" strokeWidth="2.4" />
          <path
            d="M36 74 Q60 90 84 74"
            fill="none"
            stroke="#db2777"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <path d="M60 32 C55 24 46 28 50 36 L60 44 L70 36 C74 28 65 24 60 32 Z" fill="#f43f5e" />
        </g>
      )}
      {id === 'party' && (
        <g>
          <circle cx="60" cy="64" r="26" fill={`url(#${g2})`} stroke="#0f766e" strokeWidth="2.5" />
          <path
            d="M46 42 L60 18 L74 42 Z"
            fill="#14b8a6"
            stroke="#0f766e"
            strokeWidth="2.3"
            strokeLinejoin="round"
          />
          <circle cx="60" cy="18" r="4" fill="#f43f5e" />
          <path
            d="M49 58 Q53 53 56 58 M64 58 Q68 53 71 58"
            fill="none"
            stroke="#1e293b"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          <path
            d="M51 70 Q60 77 69 70"
            fill="none"
            stroke="#78350f"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <circle cx="29" cy="40" r="3" fill="#ec4899" />
          <circle cx="91" cy="45" r="3.5" fill="#3b82f6" />
          <rect
            x="30"
            y="76"
            width="6"
            height="6"
            rx="1"
            fill="#10b981"
            transform="rotate(20 33 79)"
          />
        </g>
      )}
      {id === 'cat' && (
        <g>
          <path
            d="M34 52 L39 28 L55 40 H65 L81 28 L86 52 C88 73 77 88 60 88 C43 88 32 73 34 52 Z"
            fill="#fed7aa"
            stroke="#9a3412"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <path d="M40 42 L43 32 L51 39 Z M80 42 L77 32 L69 39 Z" fill="#fb7185" opacity="0.65" />
          <circle cx="49" cy="58" r="3.8" fill="#1e293b" />
          <circle cx="71" cy="58" r="3.8" fill="#1e293b" />
          <polygon points="60,64 56,68 64,68" fill="#f43f5e" />
          <path
            d="M53 72 Q60 77 60 69 Q60 77 67 72"
            fill="none"
            stroke="#9a3412"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <path
            d="M27 62 H40 M26 68 H40 M80 62 H93 M80 68 H94"
            stroke="#9a3412"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </g>
      )}
      {id === 'rocket' && (
        <g>
          <g className="sticker-anim-wave">
            <path
              d="M60 22 C74 36 76 58 68 74 H52 C44 58 46 36 60 22 Z"
              fill="#e0f2fe"
              stroke="#0369a1"
              strokeWidth="2.6"
              strokeLinejoin="round"
            />
            <circle cx="60" cy="49" r="7" fill="#38bdf8" stroke="#0369a1" strokeWidth="2.2" />
            <path
              d="M50 64 L38 75 L48 76 Z M70 64 L82 75 L72 76 Z"
              fill="#f43f5e"
              stroke="#9f1239"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path d="M54 75 L60 94 L66 75 Z" fill="#fb923c" />
            <path d="M57 75 L60 87 L63 75 Z" fill="#fde047" />
          </g>
          <circle cx="32" cy="34" r="2.8" fill="#fbbf24" />
          <circle cx="88" cy="32" r="3.2" fill="#38bdf8" />
        </g>
      )}
    </svg>
  );
}

/** Animated GIF renderer: displays real proxied animated GIFs when upstream URL is present, or looping SVG motion scenes. */
export function GifArtwork({
  id,
  title,
  previewUrl,
  compact = false,
}: {
  id: string;
  title?: string;
  previewUrl?: string;
  compact?: boolean;
}) {
  const gif = GIFS.find((g) => g.id === id);
  const label = title || gif?.title || 'GIF';
  const proxied = safeProxiedGifUrl(previewUrl);

  return (
    <div className={`gif-scene gif-theme-${id} ${compact ? 'compact' : ''}`}>
      <span className="gif-badge">GIF</span>
      {proxied ? (
        <img className="gif-media-img" src={proxied} alt={label} loading="lazy" />
      ) : (
        <svg className="gif-scene-svg" viewBox="0 0 180 110" role="img" aria-label={label}>
          {id === 'dance' && (
            <g>
              <circle cx="54" cy="30" r="26" fill="rgba(255,255,255,0.12)" className="gif-pulse" />
              <circle cx="130" cy="34" r="20" fill="rgba(255,255,255,0.1)" className="gif-pulse" />
              {[24, 42, 60, 78, 96, 114, 132, 150].map((x, idx) => (
                <rect
                  key={x}
                  x={x}
                  y={52 - (idx % 3) * 8}
                  width="10"
                  height={38 + (idx % 3) * 8}
                  rx="4"
                  fill="rgba(255,255,255,0.34)"
                  className={`gif-bar gif-bar-${idx % 3}`}
                />
              ))}
              <g className="gif-bounce">
                <circle cx="90" cy="36" r="10" fill="#fde047" />
                <path
                  d="M74 62 Q90 48 106 62 M90 48 V74 L79 92 M90 74 L102 92"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="4.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            </g>
          )}
          {id === 'applause' && (
            <g>
              <g className="gif-bounce">
                <path
                  d="M62 72 L76 42 C79 36 86 40 83 47 L73 74 Z"
                  fill="#fde68a"
                  stroke="#065f46"
                  strokeWidth="2.5"
                />
                <path
                  d="M118 72 L104 42 C101 36 94 40 97 47 L107 74 Z"
                  fill="#fcd34d"
                  stroke="#065f46"
                  strokeWidth="2.5"
                />
              </g>
              <path
                d="M90 16 V28 M68 24 L75 33 M112 24 L105 33"
                stroke="#fef08a"
                strokeWidth="3.5"
                strokeLinecap="round"
                className="gif-pulse"
              />
            </g>
          )}
          {id === 'rocket' && (
            <g>
              <circle cx="30" cy="24" r="2.5" fill="#fff" className="gif-pulse" />
              <circle cx="146" cy="22" r="3" fill="#bae6fd" className="gif-pulse" />
              <circle cx="132" cy="76" r="2" fill="#fff" className="gif-pulse" />
              <circle cx="44" cy="80" r="2" fill="#93c5fd" className="gif-pulse" />
              <g className="gif-rocket-fly">
                <path
                  d="M90 18 C105 32 106 54 98 70 H82 C74 54 75 32 90 18 Z"
                  fill="#f8fafc"
                  stroke="#1e3a8a"
                  strokeWidth="2.5"
                />
                <circle cx="90" cy="45" r="7" fill="#38bdf8" stroke="#1e3a8a" strokeWidth="2" />
                <path d="M80 60 L68 72 H79 Z M100 60 L112 72 H101 Z" fill="#f43f5e" />
                <path d="M84 71 L90 95 L96 71 Z" fill="#fb923c" />
                <path d="M87 71 L90 86 L93 71 Z" fill="#fde047" />
              </g>
            </g>
          )}
          {id === 'coffee' && (
            <g>
              <path
                d="M74 36 Q69 26 75 16"
                fill="none"
                stroke="#fef3c7"
                strokeWidth="3"
                strokeLinecap="round"
                className="gif-steam"
              />
              <path
                d="M90 34 Q85 24 91 14"
                fill="none"
                stroke="#fef3c7"
                strokeWidth="3"
                strokeLinecap="round"
                className="gif-steam"
              />
              <path
                d="M106 36 Q101 26 107 16"
                fill="none"
                stroke="#fef3c7"
                strokeWidth="3"
                strokeLinecap="round"
                className="gif-steam"
              />
              <path
                d="M114 48 H124 C131 48 131 66 123 68 H113"
                fill="none"
                stroke="#fffbeb"
                strokeWidth="4.5"
                strokeLinecap="round"
              />
              <path
                d="M64 42 H116 L112 80 C110 86 102 90 90 90 C78 90 70 86 68 80 Z"
                fill="#fffbeb"
                stroke="#78350f"
                strokeWidth="2.5"
              />
              <ellipse cx="90" cy="42" rx="26" ry="6" fill="#78350f" />
            </g>
          )}
          {id === 'heart' && (
            <g>
              <path
                className="gif-pulse"
                d="M90 88 C55 66 47 43 60 30 C71 19 85 26 90 37 C95 26 109 19 120 30 C133 43 125 66 90 88 Z"
                fill="#ffe4e6"
                stroke="#fff"
                strokeWidth="2.5"
              />
              <circle cx="48" cy="34" r="4" fill="#fda4af" className="gif-steam" />
              <circle cx="136" cy="30" r="5" fill="#fecdd3" className="gif-steam" />
            </g>
          )}
          {id === 'confetti' && (
            <g>
              <g className="gif-confetti-fall">
                <rect
                  x="34"
                  y="18"
                  width="8"
                  height="8"
                  rx="2"
                  fill="#fde047"
                  transform="rotate(18 38 22)"
                />
                <rect
                  x="64"
                  y="28"
                  width="9"
                  height="5"
                  rx="2"
                  fill="#38bdf8"
                  transform="rotate(-24 68 30)"
                />
                <circle cx="96" cy="20" r="4.5" fill="#4ade80" />
                <rect
                  x="122"
                  y="24"
                  width="8"
                  height="8"
                  rx="2"
                  fill="#fb7185"
                  transform="rotate(32 126 28)"
                />
                <circle cx="146" cy="40" r="4" fill="#fde047" />
              </g>
              <path
                d="M68 86 L86 42 L114 68 Z"
                fill="#fde047"
                stroke="#9d174d"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
            </g>
          )}
          {id === 'cat-type' && (
            <g>
              <path
                d="M64 46 L68 24 L82 36 H98 L112 24 L116 46 C117 62 106 72 90 72 C74 72 63 62 64 46 Z"
                fill="#fed7aa"
              />
              <circle cx="80" cy="48" r="3" fill="#0f172a" />
              <circle cx="100" cy="48" r="3" fill="#0f172a" />
              <rect
                x="52"
                y="68"
                width="76"
                height="24"
                rx="5"
                fill="#e2e8f0"
                stroke="#334155"
                strokeWidth="2.5"
              />
              <rect
                x="60"
                y="74"
                width="60"
                height="12"
                rx="3"
                fill="#38bdf8"
                opacity="0.55"
                className="gif-pulse"
              />
            </g>
          )}
          {id === 'thumb' && (
            <g>
              <circle cx="90" cy="54" r="34" fill="rgba(255,255,255,0.14)" className="gif-pulse" />
              <g className="gif-bounce">
                <rect x="64" y="48" width="14" height="32" rx="4" fill="#e0e7ff" />
                <path
                  d="M78 50 L87 28 C90 22 98 24 96 34 L94 45 H112 C118 45 120 53 116 61 L113 74 C112 78 107 80 100 80 H78 Z"
                  fill="#fde047"
                  stroke="#312e81"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                />
              </g>
            </g>
          )}
          {!GIFS.some((g) => g.id === id) && (
            <circle cx="90" cy="54" r="24" fill="rgba(255,255,255,0.28)" className="gif-pulse" />
          )}
        </svg>
      )}
      <span className="gif-label">{label}</span>
    </div>
  );
}

type EmojiItem = { emoji: string; label: string; tags: string };
type EmojiGroup = { key: string; title: string; items: EmojiItem[] };

const GROUPS: { key: string; title: string; ids: number[]; icon: LucideIcon }[] = [
  { key: 'people', title: 'Смайлы и люди', ids: [0, 1], icon: Smile },
  { key: 'nature', title: 'Животные и природа', ids: [3], icon: PawPrint },
  { key: 'food', title: 'Еда и напитки', ids: [4], icon: Apple },
  { key: 'activity', title: 'Занятия', ids: [6], icon: Trophy },
  { key: 'travel', title: 'Путешествия', ids: [5], icon: Car },
  { key: 'objects', title: 'Предметы', ids: [7], icon: Lightbulb },
  { key: 'symbols', title: 'Символы', ids: [8], icon: Heart },
  { key: 'flags', title: 'Флаги', ids: [9], icon: Flag },
];
// Windows draws flags as two letters.
const flagsDrawn = typeof navigator === 'undefined' || !/Windows/.test(navigator.userAgent);
const shownGroups = GROUPS.filter((group) => group.key !== 'flags' || flagsDrawn);

let emojiData: Promise<EmojiGroup[]> | null = null;
function loadEmoji() {
  emojiData ??= import('emojibase-data/ru/compact.json').then(({ default: data }) =>
    shownGroups.map((group) => ({
      key: group.key,
      title: group.title,
      items: data
        .filter((item) => item.group !== undefined && group.ids.includes(item.group))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((item) => ({
          emoji: item.unicode,
          label: item.label,
          tags: `${item.label} ${(item.tags ?? []).join(' ')}`.toLowerCase(),
        })),
    })),
  );
  return emojiData;
}

function recentList(key: string, limit: number): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(raw)
      ? raw.filter((v): v is string => typeof v === 'string').slice(0, limit)
      : [];
  } catch {
    return [];
  }
}
function remember(key: string, value: string, limit: number) {
  try {
    const next = [value, ...recentList(key, limit).filter((v) => v !== value)].slice(0, limit);
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* Private browsing: recents last for this visit only. */
  }
}
const RECENT_EMOJI = 'galinka-recent-emojis';
const RECENT_STICKERS = 'galinka-recent-stickers';

/** The section whose title last scrolled past the top, for the category bar. */
function useSectionSpy(scroller: React.RefObject<HTMLDivElement | null>, deps: unknown[]) {
  const [current, setCurrent] = useState('');
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => {
      const top = el.getBoundingClientRect().top + 24;
      let found = '';
      el.querySelectorAll<HTMLElement>('[data-section]').forEach((section) => {
        if (section.getBoundingClientRect().top <= top) found = section.dataset.section!;
      });
      setCurrent(found || el.querySelector<HTMLElement>('[data-section]')?.dataset.section || '');
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    return () => el.removeEventListener('scroll', update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  const jump = (key: string) => {
    const el = scroller.current;
    const section = el?.querySelector<HTMLElement>(`[data-section="${key}"]`);
    if (el && section)
      el.scrollTo({
        top: section.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop,
        behavior: 'smooth',
      });
  };
  return [current, jump] as const;
}

/**
 * Emoji, stickers and GIFs laid out as in Telegram: tabs on top, sections whose titles stay
 * while they scroll, and a category bar at the bottom. `reaction` is the emoji grid alone,
 * for the message menu.
 */
export function EmojiPicker({
  open,
  mode = 'composer',
  onSelectEmoji,
  onSelectSticker,
  onSelectGif,
}: {
  open: boolean;
  mode?: 'composer' | 'reaction';
  onSelectEmoji: (emoji: string) => void;
  onSelectSticker?: (token: string) => void;
  onSelectGif?: (token: string) => void;
}) {
  const [tab, setTab] = useState<'emoji' | 'sticker' | 'gif'>(() => {
    try {
      const saved = localStorage.getItem('galinka-picker-tab');
      return mode === 'composer' && (saved === 'sticker' || saved === 'gif') ? saved : 'emoji';
    } catch {
      return 'emoji';
    }
  });
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<EmojiGroup[] | null>(null);
  const [recents, setRecents] = useState(() => recentList(RECENT_EMOJI, 24));
  const [recentStickers, setRecentStickers] = useState(() => recentList(RECENT_STICKERS, 16));
  const [gifs, setGifs] = useState<GifEntry[] | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const emojiTab = tab === 'emoji' || mode === 'reaction';

  useEffect(() => {
    if (!open || !emojiTab || groups) return;
    let live = true;
    void loadEmoji().then((data) => {
      if (live) setGroups(data);
    });
    return () => {
      live = false;
    };
  }, [open, emojiTab, groups]);

  const normalized = query.trim().toLowerCase();
  const found = useMemo(() => {
    if (!normalized || !groups) return null;
    const words = normalized.split(/\s+/);
    return groups
      .flatMap((group) => group.items)
      .filter(
        (item) => item.emoji === normalized || words.every((word) => item.tags.includes(word)),
      )
      .slice(0, 160);
  }, [normalized, groups]);

  useEffect(() => {
    if (!open || tab !== 'gif' || mode !== 'composer') return;
    let live = true;
    const timer = setTimeout(() => {
      api<{ items: Array<{ id: string; title: string; previewUrl?: string }> }>(
        `/gifs?q=${encodeURIComponent(query.trim())}`,
      )
        .then((res) => {
          if (live) setGifs(res.items.map((item) => ({ ...item, keywords: '' })));
        })
        .catch(() => {
          if (live) setGifs(null);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, tab, mode, query]);

  const fallbackGifs = useMemo(
    () =>
      normalized
        ? GIFS.filter((g) => `${g.title} ${g.keywords}`.toLowerCase().includes(normalized))
        : GIFS,
    [normalized],
  );
  const shownGifs = gifs ?? fallbackGifs;
  const [section, jump] = useSectionSpy(scroller, [tab, groups, normalized, open]);

  function switchTab(next: typeof tab) {
    setTab(next);
    setQuery('');
    scroller.current?.scrollTo({ top: 0 });
    try {
      localStorage.setItem('galinka-picker-tab', next);
    } catch {
      /* Not remembered. */
    }
  }
  function pickEmoji(emoji: string) {
    remember(RECENT_EMOJI, emoji, 24);
    setRecents(recentList(RECENT_EMOJI, 24));
    onSelectEmoji(emoji);
  }
  function pickSticker(code: string) {
    remember(RECENT_STICKERS, code, 16);
    setRecentStickers(recentList(RECENT_STICKERS, 16));
    onSelectSticker?.(`[sticker:${code}]`);
  }

  const emojiButton = (item: { emoji: string; label?: string }, key: string) => (
    <button
      type="button"
      key={key}
      title={item.label}
      aria-label={item.label ?? item.emoji}
      onClick={() => pickEmoji(item.emoji)}
    >
      {item.emoji}
    </button>
  );
  const stickerButton = (code: string, key: string) => (
    <button
      key={key}
      type="button"
      className="sticker-pick"
      aria-label={`Стикер ${codeEmoji(code)}`}
      onClick={() => pickSticker(code)}
    >
      <Sticker code={code} size={64} hover />
    </button>
  );
  const searchLabel =
    tab === 'gif' && mode === 'composer' ? 'Поиск GIF' : emojiTab ? 'Поиск эмодзи' : '';
  const categories: { key: string; title: string; glyph: ReactNode }[] = emojiTab
    ? [
        ...(recents.length
          ? [{ key: 'recent', title: 'Недавние', glyph: <Clock3 size={18} /> }]
          : []),
        ...shownGroups.map((group) => ({
          key: group.key,
          title: group.title,
          glyph: <group.icon size={18} />,
        })),
      ]
    : tab === 'sticker'
      ? [
          ...(recentStickers.length
            ? [{ key: 'recent', title: 'Недавние', glyph: <Clock3 size={18} /> }]
            : []),
          ...STICKER_PACKS.map((pack, index) => ({
            key: `pack-${index}`,
            title: pack.title,
            glyph: <span className="emoji-category-glyph">{codeEmoji(pack.codes[0])}</span>,
          })),
        ]
      : [];

  return (
    <div
      className={`emoji-picker ${mode === 'reaction' ? 'reaction-picker' : ''} ${open ? 'open' : ''}`}
      inert={!open}
      // Scrolling the picker must not scroll, or close menus over, the conversation.
      onWheel={(event) => event.stopPropagation()}
    >
      {mode === 'composer' && (
        <div className="emoji-tabs" role="tablist" aria-label="Эмодзи, стикеры и GIF">
          {(
            [
              ['emoji', 'Эмодзи'],
              ['sticker', 'Стикеры'],
              ['gif', 'GIF'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? 'selected' : ''}
              onClick={() => switchTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {searchLabel && (
        <label className="emoji-search-wrap">
          <Search size={15} />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              scroller.current?.scrollTo({ top: 0 });
            }}
            placeholder={`${searchLabel}…`}
            aria-label={searchLabel}
          />
        </label>
      )}
      <div className={`emoji-scroll ${tab === 'gif' && !emojiTab ? 'gifs' : ''}`} ref={scroller}>
        {emojiTab ? (
          found ? (
            found.length ? (
              <div className="emoji-grid">{found.map((item) => emojiButton(item, item.emoji))}</div>
            ) : (
              <p className="emoji-empty">Ничего не найдено</p>
            )
          ) : (
            <>
              {recents.length > 0 && (
                <section data-section="recent">
                  <h4 className="emoji-section-label">Недавние</h4>
                  <div className="emoji-grid">
                    {recents.map((emoji) => emojiButton({ emoji }, `recent-${emoji}`))}
                  </div>
                </section>
              )}
              {groups ? (
                groups.map((group) => (
                  <section key={group.key} data-section={group.key}>
                    <h4 className="emoji-section-label">{group.title}</h4>
                    <div className="emoji-grid">
                      {group.items.map((item) => emojiButton(item, item.emoji))}
                    </div>
                  </section>
                ))
              ) : (
                <p className="emoji-empty">Загрузка…</p>
              )}
            </>
          )
        ) : tab === 'sticker' ? (
          <>
            {recentStickers.length > 0 && (
              <section data-section="recent">
                <h4 className="emoji-section-label">Недавние</h4>
                <div className="sticker-grid">
                  {recentStickers.map((code) => stickerButton(code, `recent-${code}`))}
                </div>
              </section>
            )}
            {STICKER_PACKS.map((pack, index) => (
              <section key={pack.title} data-section={`pack-${index}`}>
                <h4 className="emoji-section-label">{pack.title}</h4>
                <div className="sticker-grid">
                  {pack.codes.map((code) => stickerButton(code, code))}
                </div>
              </section>
            ))}
          </>
        ) : shownGifs.length ? (
          <div className="gif-grid">
            {shownGifs.map((g) => (
              <button
                key={g.id}
                type="button"
                className="gif-pick"
                aria-label={g.title}
                onClick={() =>
                  onSelectGif?.(
                    g.previewUrl
                      ? `[gif:${g.id}|${encodeURIComponent(g.previewUrl)}|${g.title}]`
                      : `[gif:${g.id}:${g.title}]`,
                  )
                }
              >
                <GifArtwork id={g.id} title={g.title} previewUrl={g.previewUrl} compact />
              </button>
            ))}
          </div>
        ) : (
          <p className="emoji-empty">GIF не найдены</p>
        )}
      </div>
      {!normalized && categories.length > 0 && (
        <nav className="emoji-categories" aria-label="Разделы">
          {categories.map((category) => (
            <button
              key={category.key}
              type="button"
              aria-label={category.title}
              title={category.title}
              className={section === category.key ? 'selected' : ''}
              onClick={() => jump(category.key)}
            >
              {category.glyph}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
