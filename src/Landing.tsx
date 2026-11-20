import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  CheckCheck,
  Copy,
  Download,
  Globe,
  Laptop,
  Mic,
  Monitor,
  Package,
  Play,
  Plus,
  RefreshCw,
  Search,
  Smartphone,
  TabletSmartphone,
  Terminal,
} from 'lucide-react';
import { API_BASE } from './api';
import { BrandQR } from './Share';
import { inkOn, presets, ThemeToggle, useThemeState, type CustomTheme } from './theme';
import { motionAllowed } from './ui';
import {
  detectPlatform,
  platforms,
  releaseFiles,
  type Platform,
  type Release,
  type ReleaseAsset,
} from './platform';
import './landing.css';

const descriptions: Record<Platform, string> = {
  Android: 'Android 7 и новее. Обновления приходят прямо в приложение.',
  iOS: 'Веб-приложение для iPhone и iPad: откройте в Safari и добавьте на экран «Домой».',
  Windows: 'Windows 10 и новее, x64. Обновляется само.',
  macOS: 'Apple Silicon или Intel.',
  Linux: 'AppImage или DEB для Debian и Ubuntu, x64.',
  'Arch Linux': 'Пакет для pacman с системным Electron.',
  Web: 'Любой современный браузер.',
};

const icons: Record<Platform, typeof Monitor> = {
  Android: Smartphone,
  iOS: TabletSmartphone,
  Windows: Monitor,
  macOS: Laptop,
  Linux: Terminal,
  'Arch Linux': Package,
  Web: Globe,
};

function fileLabel(file: ReleaseAsset) {
  if (file.name.endsWith('.dmg'))
    return file.name.includes('arm64') ? 'Для Apple Silicon' : 'Для Intel';
  if (file.name.endsWith('.AppImage')) return 'Скачать AppImage';
  if (file.name.endsWith('.deb')) return 'Скачать .deb';
  if (file.name.endsWith('.pkg.tar.zst')) return 'Скачать пакет';
  if (file.name.endsWith('.apk')) return 'Скачать APK';
  return 'Скачать для Windows';
}

const GALINKA_GLYPH =
  'M89 42C67 20 29 38 34 67c3 23 26 33 47 23l15 5-4-19c-9 10-25 14-36 4-14-13-3-34 14-31 5 1 9 3 12 7';

/** Animated inline SVG brand mark that draws its spiral stroke smoothly on load. */
function BrandMark({ animate = false }: { animate?: boolean }) {
  return (
    <svg className={`brand-svg ${animate ? 'draw' : ''}`} viewBox="0 0 128 128" aria-hidden="true">
      <rect width="128" height="128" rx="34" fill="#b3302a" />
      <path
        className="brand-stroke"
        d={GALINKA_GLYPH}
        fill="none"
        stroke="#fff7f4"
        strokeWidth="11"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength="100"
      />
      <circle className="brand-core" cx="70" cy="68" r="5" fill="#fff7f4" />
    </svg>
  );
}

/** Tracks whether an element is visible in the viewport; pauses off-screen animations. */
function useInView(ref: React.RefObject<HTMLElement | null>, threshold = 0.1) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(Boolean(entry?.isIntersecting)),
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, threshold]);
  return visible;
}

/** Subtle physical magnetic pull toward cursor on desktop CTAs. */
function onMagneticMove(event: ReactPointerEvent<HTMLElement>) {
  if (event.pointerType === 'touch' || !motionAllowed()) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width - 0.5) * 14;
  const y = ((event.clientY - rect.top) / rect.height - 0.5) * 10;
  event.currentTarget.style.setProperty('--mag-x', `${x.toFixed(1)}px`);
  event.currentTarget.style.setProperty('--mag-y', `${y.toFixed(1)}px`);
}

function onMagneticLeave(event: ReactPointerEvent<HTMLElement>) {
  event.currentTarget.style.setProperty('--mag-x', '0px');
  event.currentTarget.style.setProperty('--mag-y', '0px');
}

/**
 * Interactive minimalist concentric orbit field ("свой круг"):
 * delicate hairline rings, orbiting people nodes, soft signal arcs between them,
 * and inertial cursor gravity. Pauses off-screen and renders calmly in reduced-motion.
 */
function CircleField({ heroRef }: { heroRef: React.RefObject<HTMLElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inView = useInView(heroRef, 0.05);
  useThemeState();

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = heroRef.current;
    if (!canvas || !host) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = !motionAllowed();
    let width = 0;
    let height = 0;
    let dpr = 1;
    let raf = 0;

    const pointer = { tx: 0, ty: 0, x: 0, y: 0, active: false };

    const nodes = [
      { ring: 0, angle: 0.4, speed: 0.14, label: 'А', accent: false },
      { ring: 1, angle: 2.3, speed: -0.1, label: 'М', accent: true },
      { ring: 1, angle: 5.1, speed: -0.1, label: 'Д', accent: false },
      { ring: 2, angle: 1.15, speed: 0.075, label: 'Н', accent: false },
      { ring: 2, angle: 3.9, speed: 0.075, label: 'С', accent: true },
    ];

    const resize = () => {
      const rect = host.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };

    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(host);

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || reduced) return;
      const rect = host.getBoundingClientRect();
      pointer.tx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      pointer.ty = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      pointer.active = true;
    };

    const onLeave = () => {
      pointer.tx = 0;
      pointer.ty = 0;
      pointer.active = false;
    };

    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);

    const readPalette = () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      return {
        ring: dark ? 'rgba(255, 255, 255, 0.075)' : 'rgba(25, 25, 26, 0.08)',
        ringInner: dark ? 'rgba(255, 138, 122, 0.16)' : 'rgba(179, 48, 42, 0.14)',
        accent: dark ? '#ff8a7a' : '#b3302a',
        accentSoft: dark ? 'rgba(255, 138, 122, 0.22)' : 'rgba(179, 48, 42, 0.16)',
        nodeBg: dark ? '#18191b' : '#ffffff',
        nodeBorder: dark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(25, 25, 26, 0.14)',
        nodeText: dark ? 'rgba(241, 241, 242, 0.72)' : 'rgba(25, 25, 26, 0.7)',
      };
    };

    let start = performance.now();

    const draw = (now: number) => {
      const t = reduced ? 12 : (now - start) / 1000;
      pointer.x += (pointer.tx - pointer.x) * 0.055;
      pointer.y += (pointer.ty - pointer.y) * 0.055;

      const p = readPalette();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const cx = width * 0.5;
      const cy = height * 0.49;
      const unit = Math.min(width, height);
      const radii = [unit * 0.37, unit * 0.5, unit * 0.64];

      // Subtle atmospheric center glow
      const glow = ctx.createRadialGradient(
        cx + pointer.x * 36,
        cy + pointer.y * 28,
        0,
        cx,
        cy,
        unit * 0.54,
      );
      glow.addColorStop(0, p.accentSoft);
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      // Concentric architectural rings with gentle depth parallax
      radii.forEach((r, idx) => {
        const shift = (idx + 1) * 11;
        const rx = cx + pointer.x * shift;
        const ry = cy + pointer.y * shift * 0.75;
        ctx.beginPath();
        ctx.arc(rx, ry, r, 0, Math.PI * 2);
        ctx.strokeStyle = idx === 0 ? p.ringInner : p.ring;
        ctx.lineWidth = 1;
        if (idx === 1) ctx.setLineDash([2, 8]);
        else ctx.setLineDash([]);
        ctx.stroke();
      });
      ctx.setLineDash([]);

      // Compute orbiting node positions
      const coords = nodes.map((n) => {
        const r = radii[n.ring];
        const shift = (n.ring + 1) * 11;
        const a = n.angle + t * n.speed;
        return {
          ...n,
          x: cx + pointer.x * shift + Math.cos(a) * r,
          y: cy + pointer.y * shift * 0.75 + Math.sin(a) * r * 0.86,
        };
      });

      // Quiet signal arc pulsing softly between two orbiting members
      const pulsePhase = (t * 0.34) % 1;
      const pairA = coords[Math.floor(t * 0.34) % coords.length];
      const pairB = coords[(Math.floor(t * 0.34) + 2) % coords.length];
      if (pairA && pairB) {
        const alpha = Math.sin(pulsePhase * Math.PI) * 0.42;
        const midX = (pairA.x + pairB.x) * 0.5 + (cx - (pairA.x + pairB.x) * 0.5) * 0.24;
        const midY = (pairA.y + pairB.y) * 0.5 + (cy - (pairA.y + pairB.y) * 0.5) * 0.24;
        ctx.beginPath();
        ctx.moveTo(pairA.x, pairA.y);
        ctx.quadraticCurveTo(midX, midY, pairB.x, pairB.y);
        ctx.strokeStyle = p.accent;
        ctx.globalAlpha = alpha * 0.48;
        ctx.lineWidth = 1.1;
        ctx.stroke();

        // Travelling berry signal dot along quadratic curve
        const u = pulsePhase;
        const inv = 1 - u;
        const sx = inv * inv * pairA.x + 2 * inv * u * midX + u * u * pairB.x;
        const sy = inv * inv * pairA.y + 2 * inv * u * midY + u * u * pairB.y;
        ctx.beginPath();
        ctx.arc(sx, sy, 2.8, 0, Math.PI * 2);
        ctx.fillStyle = p.accent;
        ctx.globalAlpha = Math.min(0.85, alpha * 1.6);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Draw crisp minimal orbiting nodes (hidden on very tight screens so text stays king)
      if (width >= 640) {
        coords.forEach((n, idx) => {
          // Subtle radar ping on accented nodes
          if (n.accent && !reduced) {
            const wave = (t * 0.45 + idx * 0.37) % 1;
            ctx.beginPath();
            ctx.arc(n.x, n.y, 13 + wave * 20, 0, Math.PI * 2);
            ctx.strokeStyle = p.accent;
            ctx.globalAlpha = (1 - wave) * 0.32;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.globalAlpha = 1;
          }

          ctx.beginPath();
          ctx.arc(n.x, n.y, 13, 0, Math.PI * 2);
          ctx.fillStyle = p.nodeBg;
          ctx.fill();
          ctx.strokeStyle = n.accent ? p.accent : p.nodeBorder;
          ctx.lineWidth = n.accent ? 1.4 : 1;
          ctx.stroke();

          ctx.fillStyle = n.accent ? p.accent : p.nodeText;
          ctx.font = '600 10px "Golos Text Variable", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(n.label, n.x, n.y + 0.5);
        });
      }

      if (!reduced && inView) {
        raf = requestAnimationFrame(draw);
      }
    };

    if (reduced || inView) {
      start = performance.now();
      raf = requestAnimationFrame(draw);
    }

    return () => {
      ro?.disconnect();
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [heroRef, inView]);

  return <canvas className="circle-field" ref={canvasRef} aria-hidden="true" />;
}

/* ---- Chapter data for the Sticky Metamorphosing Scrollytelling Stage ---- */
type ChapterId = 0 | 1 | 2 | 3;

const CHAPTERS: {
  id: ChapterId;
  num: string;
  short: string;
  title: string;
  body: string;
  tags: string[];
}[] = [
  {
    id: 0,
    num: '01',
    short: 'Переписка',
    title: 'Привычно, как в Telegram. Только своё.',
    body: 'Пузыри с хвостиками, реакции, ответы свайпом, кружки и голосовые. Никакой рекламы, каналов и чужих людей — только те, кого вы пригласили.',
    tags: ['Группы до 100 человек', 'Онлайн и «печатает»', 'Реакции с кольцом'],
  },
  {
    id: 1,
    num: '02',
    short: 'Темы',
    title: 'Темы под настроение',
    body: 'Шесть готовых и редактор с живым предпросмотром: акцент, фон чата, цвет своих сообщений. Темой можно поделиться ссылкой или QR-кодом.',
    tags: ['6 готовых палитр', 'Живой редактор', 'Обмен ссылкой'],
  },
  {
    id: 2,
    num: '03',
    short: 'Вход по QR',
    title: 'Вход по QR',
    body: 'Покажите код на компьютере и наведите телефон — без пароля и СМС. Тем же встроенным сканером добавляются друзья, профили и группы.',
    tags: ['Без номера телефона', 'Без пароля', 'Карточка профиля с QR'],
  },
  {
    id: 3,
    num: '04',
    short: 'Поиск и медиа',
    title: 'Поиск, кружки, голосовые и альбомы',
    body: 'Поиск по всем чатам с фильтрами, кружки до минуты, голосовые с ускорением и расшифровкой на вашем сервере, фотоальбомы до 10 вложений и файлы до 100 МБ.',
    tags: ['Расшифровка whisper.cpp', 'Альбомы до 10 фото', 'Фильтры поиска'],
  },
];

const HERO_WAVE = [5, 9, 14, 8, 13, 17, 11, 6, 12, 16, 10, 5, 9, 14, 8, 6];
const SEARCH_SCENES = [
  {
    query: 'пицц',
    filter: 0,
    hits: [
      { chat: 'Свои люди', before: 'Макс: захвачу ', match: 'пицц', after: 'у к восьми' },
      { chat: 'Аня', before: 'Та ', match: 'пицц', after: 'ерия на углу?' },
    ],
  },
  {
    query: 'альбом',
    filter: 1,
    hits: [
      { chat: 'На выходные', before: 'Скинула ', match: 'альбом', after: ' · 8 фото' },
      { chat: 'Избранное', before: 'Идеи для ', match: 'альбом', after: 'а с поездки' },
    ],
  },
  {
    query: 'суббот',
    filter: 0,
    hits: [
      { chat: 'На выходные', before: 'Встретимся в ', match: 'суббот', after: 'у в 9' },
      { chat: 'Макс', before: 'На ', match: 'суббот', after: 'у беру термос' },
    ],
  },
];

/**
 * The ONE physical pinned device stage that choreographically morphs between:
 * 0 — Living Conversation | 1 — Live Theme Studio | 2 — Optical QR Scanner | 3 — Search + Media
 */
function MorphDevice({
  chapter,
  themeIdx,
  onSelectTheme,
  themes,
}: {
  chapter: ChapterId;
  themeIdx: number;
  onSelectTheme: (idx: number) => void;
  themes: CustomTheme[];
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLDivElement>(null);
  const inView = useInView(stageRef, 0.15);

  // Beat machine for Chapter 0 (Living Chat)
  const [beat, setBeat] = useState(() => (motionAllowed() ? 1 : 7));
  const [liked, setLiked] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [qrLocked, setQrLocked] = useState(false);
  const [searchIdx, setSearchIdx] = useState(0);
  const [fastVoice, setFastVoice] = useState(false);

  // Smooth spring 3D pointer tilt on desktop
  useEffect(() => {
    const stage = stageRef.current;
    const phone = phoneRef.current;
    if (!stage || !phone || !motionAllowed()) return;
    if (matchMedia('(pointer: coarse)').matches) return;

    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;
    let raf = 0;

    const tick = () => {
      cx += (tx - cx) * 0.1;
      cy += (ty - cy) * 0.1;
      phone.style.setProperty('--tilt-x', `${cx.toFixed(3)}deg`);
      phone.style.setProperty('--tilt-y', `${cy.toFixed(3)}deg`);
      phone.style.setProperty('--sheen-x', `${(50 + cy * 5).toFixed(1)}%`);
      phone.style.setProperty('--sheen-y', `${(28 - cx * 5).toFixed(1)}%`);
      if (Math.abs(tx - cx) > 0.01 || Math.abs(ty - cy) > 0.01) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
      }
    };

    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const rect = stage.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      ty = Math.max(-1, Math.min(1, nx)) * 6.5;
      tx = Math.max(-1, Math.min(1, -ny)) * 5.2;
      kick();
    };

    const onLeave = () => {
      tx = 0;
      ty = 0;
      kick();
    };

    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerleave', onLeave);
    return () => {
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Chapter 0 living chat loop
  useEffect(() => {
    if (chapter !== 0) return;
    if (!motionAllowed()) {
      setBeat(7);
      return;
    }
    if (!inView || hovered) return;
    const delays = [320, 820, 760, 720, 760, 880, 960, 5200];
    const timer = setTimeout(() => {
      setBeat((prev) => (prev >= 7 ? 0 : prev + 1));
    }, delays[beat] ?? 3600);
    return () => clearTimeout(timer);
  }, [chapter, beat, inView, hovered]);

  // Chapter 1 ambient theme cycle
  useEffect(() => {
    if (chapter !== 1 || !motionAllowed() || !inView || hovered) return;
    const timer = setInterval(() => {
      onSelectTheme((themeIdx + 1) % themes.length);
    }, 3000);
    return () => clearInterval(timer);
  }, [chapter, inView, hovered, themeIdx, themes.length, onSelectTheme]);

  // Chapter 2 QR lock rhythm
  useEffect(() => {
    if (chapter !== 2 || !motionAllowed() || !inView) {
      setQrLocked(false);
      return;
    }
    const timer = setInterval(() => setQrLocked((v) => !v), 2800);
    return () => clearInterval(timer);
  }, [chapter, inView]);

  // Chapter 3 search cycle
  useEffect(() => {
    if (chapter !== 3 || !motionAllowed() || !inView || hovered) return;
    const timer = setInterval(() => {
      setSearchIdx((i) => (i + 1) % SEARCH_SCENES.length);
    }, 3200);
    return () => clearInterval(timer);
  }, [chapter, inView, hovered]);

  const activeTheme = themes[themeIdx] ?? themes[0];
  const themeDark = activeTheme.base === 'dark';
  const stageHaloColor = chapter === 1 ? activeTheme.accent : 'var(--color-accent)';

  const statusText =
    beat === 1
      ? 'Аня печатает'
      : beat === 4
        ? 'Макс печатает'
        : beat === 5
          ? 'Макс записывает кружок'
          : '4 участника · 2 в сети';
  const isTyping = beat === 1 || beat === 4;
  const isRecording = beat === 5;
  const scene = SEARCH_SCENES[searchIdx];

  return (
    <div
      className="morph-stage"
      ref={stageRef}
      data-chapter={chapter}
      aria-hidden="true"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={{ '--stage-accent': stageHaloColor } as CSSProperties}
    >
      {/* Architectural orbital aura behind pinned phone */}
      <div className="stage-halo" />
      <div className="stage-ring r1" />
      <div className="stage-ring r2" />

      {/* Quiet floating coordinate label */}
      <div className="stage-meta">
        <span>{CHAPTERS[chapter].num}</span>
        <i>/</i>
        <span>{CHAPTERS[chapter].short}</span>
      </div>

      <div className="phone morph-phone" ref={phoneRef}>
        <div className="phone-sheen" />
        <div className="phone-screen">
          <div className="phone-statusbar">
            <span>19:04</span>
            <i className="phone-island" />
            <span className="phone-signal">
              <i />
              <i />
              <i />
            </span>
          </div>

          {/* VIEW 0: LIVING CONVERSATION */}
          <div className={`screen-layer ${chapter === 0 ? 'active' : ''}`}>
            <div className="phone-head">
              <span className="phone-avatar">
                СЛ
                <i className="avatar-online" />
              </span>
              <span className="phone-meta">
                <strong>Свои люди</strong>
                <small
                  key={statusText}
                  className={isTyping || isRecording ? 'status-live' : undefined}
                >
                  {isRecording && <i className="rec-dot" />}
                  {statusText}
                  {isTyping && (
                    <span className="typing-dots">
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                </small>
              </span>
            </div>

            <div className="phone-chat">
              <span className="demo-day">Сегодня</span>

              {beat >= 2 && (
                <div className="demo-msg in">
                  <b className="tone-text-1">Аня</b>
                  Кто сегодня на настолки? 🎲
                  <time>19:02</time>
                </div>
              )}

              {beat >= 3 && (
                <div className={`demo-msg out ${beat >= 5 ? 'has-reaction' : ''}`}>
                  Я! Беру «Каркассон»
                  <time>
                    19:03 <CheckCheck size={13} />
                  </time>
                  {beat >= 5 && (
                    <span
                      className={`demo-reaction ${liked ? 'liked' : ''}`}
                      onClick={() => setLiked((v) => !v)}
                    >
                      ❤ {liked ? 3 : 2}
                    </span>
                  )}
                </div>
              )}

              {beat >= 5 && (
                <div className="demo-msg in">
                  <b className="tone-text-4">Макс</b>
                  Буду к восьми, захвачу пиццу
                  <time>19:04</time>
                </div>
              )}

              {beat >= 6 && (
                <div className="demo-note">
                  <span className="demo-note-glow" />
                  <span className="demo-note-face">🍕</span>
                  <svg viewBox="0 0 100 100">
                    <circle className="note-track" cx="50" cy="50" r="47.5" pathLength="100" />
                    <circle className="note-progress" cx="50" cy="50" r="47.5" pathLength="100" />
                  </svg>
                  <time>0:07</time>
                </div>
              )}

              {beat >= 7 && (
                <div className="demo-msg out voice">
                  <span className="voice-btn">
                    <Play size={11} fill="currentColor" />
                  </span>
                  <span className="demo-wave playing">
                    {HERO_WAVE.map((h, i) => (
                      <i key={i} style={{ height: h, '--i': i } as CSSProperties} />
                    ))}
                  </span>
                  <time>0:12</time>
                </div>
              )}

              {(beat === 1 || beat === 4) && (
                <div className="demo-typing-bubble">
                  <i />
                  <i />
                  <i />
                </div>
              )}
            </div>

            <div className="phone-composer">
              <span>Сообщение</span>
              <i>
                <Mic size={14} />
              </i>
            </div>
          </div>

          {/* VIEW 1: LIVE THEME STUDIO */}
          <div
            className={`screen-layer theme-screen ${chapter === 1 ? 'active' : ''}`}
            style={
              {
                '--t-wall': activeTheme.wallpaper,
                '--t-in': themeDark ? '#202125' : '#ffffff',
                '--t-in-ink': themeDark ? '#f1f1f2' : '#19191a',
                '--t-out': activeTheme.outgoing,
                '--t-out-ink': inkOn(activeTheme.outgoing),
                '--t-accent': activeTheme.accent,
                '--t-accent-ink': inkOn(activeTheme.accent),
                '--t-bar': themeDark ? '#18191b' : '#ffffff',
                '--t-rule': themeDark ? 'rgb(255 255 255 / 9%)' : 'rgb(20 18 16 / 9%)',
              } as CSSProperties
            }
          >
            <div className="ts-head">
              <span className="ts-dot" />
              <strong>{activeTheme.name}</strong>
              <small>Оформление</small>
            </div>
            <div className="ts-chat">
              <span className="ts-pill">Живой предпросмотр</span>
              <div className="ts-bubble in">Собрал новую палитру под вечер ✦</div>
              <div className="ts-bubble out">Ух, очень спокойно. Скинь ссылкой?</div>
              <div className="ts-link-card">
                <i className="ts-link-swatch" />
                <span>
                  <b>Тема «{activeTheme.name}»</b>
                  <small>mess.quiby.me/app?theme=…</small>
                </span>
              </div>
            </div>
            <div className="ts-dock">
              {themes.map((t, idx) => (
                <span
                  key={t.id}
                  className={`ts-chip ${idx === themeIdx ? 'active' : ''}`}
                  onClick={() => onSelectTheme(idx)}
                  style={
                    {
                      '--sw-wall': t.wallpaper,
                      '--sw-accent': t.accent,
                    } as CSSProperties
                  }
                >
                  <i />
                </span>
              ))}
            </div>
          </div>

          {/* VIEW 2: OPTICAL QR SCANNER */}
          <div className={`screen-layer qr-screen ${chapter === 2 ? 'active' : ''}`}>
            <div className="qs-top">
              <strong>Вход по QR-коду</strong>
              <small>Без пароля и номера телефона</small>
            </div>
            <div className={`qs-viewport ${qrLocked ? 'locked' : ''}`}>
              <i className="qr-corner tl" />
              <i className="qr-corner tr" />
              <i className="qr-corner bl" />
              <i className="qr-corner br" />
              <div className="qs-card">
                <BrandQR value="https://mess.quiby.me" accent="#b3302a" />
                <div className="qr-scanline" />
              </div>
            </div>
            <div className={`qs-pill ${qrLocked ? 'locked' : ''}`}>
              <i />
              <span>{qrLocked ? 'Вход подтверждён' : 'Наведите камеру'}</span>
            </div>
          </div>

          {/* VIEW 3: SEARCH + VOICE WHISPER + PHOTO ALBUMS */}
          <div className={`screen-layer media-screen ${chapter === 3 ? 'active' : ''}`}>
            <div className="ms-search">
              <div className="search-bar-mock">
                <Search size={13} />
                <span className="search-query" key={scene.query}>
                  {scene.query}
                </span>
                <i className="search-caret" />
              </div>
              <div className="search-filters-mock">
                {['Все', 'Медиа', 'Голосовые'].map((label, idx) => (
                  <span key={label} className={scene.filter === idx ? 'active' : ''}>
                    {label}
                  </span>
                ))}
              </div>
              <div className="search-hits-stack" key={searchIdx}>
                {scene.hits.map((hit, i) => (
                  <span className="search-hit" key={hit.chat} style={{ '--i': i } as CSSProperties}>
                    <b>{hit.chat}</b>
                    <span>
                      {hit.before}
                      <mark>{hit.match}</mark>
                      {hit.after}
                    </span>
                  </span>
                ))}
              </div>
            </div>

            <div className="ms-divider" />

            <div className="ms-media">
              <div
                className={`media-voice ${fastVoice ? 'fast' : ''}`}
                onClick={() => setFastVoice((v) => !v)}
              >
                <span className="voice-btn">
                  <Mic size={13} />
                </span>
                <span className="demo-wave playing">
                  {HERO_WAVE.slice(0, 13).map((h, i) => (
                    <i key={i} style={{ height: h, '--i': i } as CSSProperties} />
                  ))}
                </span>
                <span className="voice-speed">{fastVoice ? '1.5×' : '1×'}</span>
              </div>
              <div className="media-transcript">
                <span className="transcript-tag">Аа</span>
                <span>«Захвачу пиццу к восьми»</span>
              </div>
              <div className="ms-album-row">
                <span className="ms-thumb t1" />
                <span className="ms-thumb t2" />
                <span className="ms-thumb t3">
                  <b>+7</b>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Scroll-scrubbed cinema portal for the Desktop App Showcase. */
function DesktopPortal() {
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || !motionAllowed()) return;

    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 900;
      const raw = (vh - rect.top) / (vh * 0.72);
      const clamped = Math.max(0, Math.min(1, raw));
      const eased = 1 - Math.pow(1 - clamped, 3);
      el.style.setProperty('--portal', eased.toFixed(4));
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="portal-stage" ref={stageRef}>
      <div className="portal-glow" aria-hidden="true" />
      <div className="portal-tag left" aria-hidden="true">
        <i />
        Уведомления в фоне
      </div>
      <div className="portal-tag right" aria-hidden="true">
        <i />
        Обновляется само
      </div>
      <div className="window portal-window">
        <div className="window-bar" aria-hidden="true">
          <span className="window-dots">
            <i />
            <i />
            <i />
          </span>
          <span className="window-title">Galinka — На выходные</span>
          <span className="window-spacer" />
        </div>
        <img
          src="/preview.png"
          alt="Групповой чат в Galinka на компьютере"
          loading="lazy"
          width="1440"
          height="960"
        />
      </div>
    </div>
  );
}

const MARQUEE_TOP = [
  'Свой сервер',
  'Без рекламы',
  'Без номера телефона',
  'До 100 человек в группе',
  'Вход по приглашению',
];

const MARQUEE_BOTTOM = [
  'Альбомы до 10 фото',
  'Расшифровка голосовых',
  'Темы по ссылке',
  'Вход по QR-коду',
  'Файлы до 100 МБ',
];

export default function Landing() {
  useThemeState();
  const [release, setRelease] = useState<Release | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const detected = detectPlatform();
  const [platform, setPlatform] = useState<Platform>(detected);
  const [install, setInstall] = useState(false);
  const [request, setRequest] = useState(0);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeChapter, setActiveChapter] = useState<ChapterId>(0);
  const [themeIdx, setThemeIdx] = useState(0);
  const [actIndex, setActIndex] = useState('01');
  const [installPrompt, setInstallPrompt] = useState<{
    prompt: () => Promise<void>;
    userChoice: Promise<unknown>;
  } | null>(null);

  const heroRef = useRef<HTMLElement>(null);
  const storyRef = useRef<HTMLElement>(null);
  const marqueeRef = useRef<HTMLDivElement>(null);
  const navProgressRef = useRef<HTMLDivElement>(null);
  const compassRingRef = useRef<SVGCircleElement>(null);
  const platformGridRef = useRef<HTMLDivElement>(null);
  const chapterRefs = useRef<(HTMLElement | null)[]>([]);

  const darkSite = document.documentElement.dataset.theme === 'dark';
  const allThemes: CustomTheme[] = [
    darkSite
      ? {
          id: 'kalina',
          name: 'Калина',
          base: 'dark',
          accent: '#ff8a7a',
          wallpaper: '#0c0d0e',
          outgoing: '#5b2621',
        }
      : {
          id: 'kalina',
          name: 'Калина',
          base: 'light',
          accent: '#b3302a',
          wallpaper: '#e9e3d9',
          outgoing: '#fbe2da',
        },
    ...presets,
  ];

  // Unified scroll choreography: hero curtain split, marquee nudge, header morph, compass ring.
  useEffect(() => {
    let raf = 0;
    const sync = () => {
      raf = 0;
      const y = window.scrollY;
      const vh = window.innerHeight || 900;
      const max = Math.max(1, document.documentElement.scrollHeight - vh);
      const p = Math.max(0, Math.min(1, y / max));

      setScrolled(y > 28);
      navProgressRef.current?.style.setProperty('--scroll-p', p.toFixed(4));
      if (compassRingRef.current) {
        compassRingRef.current.style.strokeDashoffset = `${(100 - p * 100).toFixed(2)}`;
      }

      if (p < 0.16) setActIndex('01');
      else if (p < 0.54) setActIndex('02');
      else if (p < 0.74) setActIndex('03');
      else if (p < 0.9) setActIndex('04');
      else setActIndex('05');

      if (motionAllowed()) {
        // Hero kinetic curtain split as user scrolls down
        const heroP = Math.max(0, Math.min(1, y / (vh * 0.85)));
        heroRef.current?.style.setProperty('--hero-p', heroP.toFixed(4));

        // Scroll-linked subtle marquee drift
        if (marqueeRef.current) {
          const rect = marqueeRef.current.getBoundingClientRect();
          const mP = Math.max(-1, Math.min(1, (vh * 0.5 - rect.top) / vh));
          marqueeRef.current.style.setProperty('--m-shift', `${(mP * 54).toFixed(1)}px`);
        }
      }
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(sync);
    };

    sync();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Scrollytelling chapter observer: switches pinned phone automatically on scroll
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = Number((entry.target as HTMLElement).dataset.chapterId) as ChapterId;
            if (!Number.isNaN(id)) setActiveChapter(id);
          }
        }
      },
      { rootMargin: '-38% 0px -38% 0px', threshold: 0 },
    );

    chapterRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  // Measured spring-sliding indicator for the 6-platform download console
  useLayoutEffect(() => {
    const grid = platformGridRef.current;
    if (!grid) return;
    const measure = () => {
      const btn = grid.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
      if (!btn) return;
      grid.style.setProperty('--ind-x', `${btn.offsetLeft}px`);
      grid.style.setProperty('--ind-y', `${btn.offsetTop}px`);
      grid.style.setProperty('--ind-w', `${btn.offsetWidth}px`);
      grid.style.setProperty('--ind-h', `${btn.offsetHeight}px`);
      grid.dataset.ready = 'true';
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    return () => ro.disconnect();
  }, [platform]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      setFailed(true);
      setLoading(false);
    }, 15000);
    setLoading(true);
    setFailed(false);
    fetch(`${API_BASE}/downloads`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw Error();
        return response.json();
      })
      .then(setRelease)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      })
      .finally(() => {
        clearTimeout(timeout);
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [request]);

  useEffect(() => {
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as unknown as typeof installPrompt);
    };
    window.addEventListener('beforeinstallprompt', onInstall);
    return () => window.removeEventListener('beforeinstallprompt', onInstall);
  }, []);

  const copyArchCommand = async () => {
    try {
      await navigator.clipboard.writeText('sudo pacman -U ./Galinka-*.pkg.tar.zst');
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 1800);
    } catch {
      /* Clipboard unavailable: user can select text directly. */
    }
  };

  const jumpToChapter = (id: ChapterId) => {
    setActiveChapter(id);
    const el = chapterRefs.current[id];
    if (el && window.innerWidth > 920) {
      el.scrollIntoView({
        behavior: motionAllowed() ? 'smooth' : 'auto',
        block: 'center',
      });
    }
  };

  const files = releaseFiles(release, platform);
  const PlatformIcon = icons[platform];

  return (
    <main className="landing">
      {/* Sticky Minimalist Header -> morphs into floating capsule on scroll */}
      <header className="landing-nav" data-scrolled={scrolled}>
        <div className="landing-nav-inner">
          <a href="/" className="brand">
            <BrandMark animate />
            <span>Galinka</span>
          </a>
          <nav aria-label="Навигация сайта">
            <a className="nav-link" href="#features">
              Возможности
            </a>
            <a className="nav-link" href="#download">
              Скачать
            </a>
            <a className="nav-link" href="/changelog">
              Изменения
            </a>
            <ThemeToggle />
            <a className="nav-enter" href="/app">
              Войти
            </a>
          </nav>
          <div className="nav-progress" ref={navProgressRef} aria-hidden="true" />
        </div>
      </header>

      {/* ACT 1: MONUMENTAL CENTERED ORBITAL HERO */}
      <section className="hero-poster" ref={heroRef}>
        <CircleField heroRef={heroRef} />

        {/* Subtle parallax floating live message satellites on wide desktop */}
        <div className="hero-satellite left" aria-hidden="true">
          <span className="sat-avatar">А</span>
          <span>
            <b>Аня</b>
            <small>Кто сегодня на настолки? 🎲</small>
          </span>
        </div>
        <div className="hero-satellite right" aria-hidden="true">
          <span className="sat-badge">❤ 2</span>
          <span className="sat-wave">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          <small>0:12</small>
        </div>

        <div className="hero-center">
          <a className="hero-eyebrow" href="/changelog">
            <i className="eyebrow-dot" aria-hidden="true" />
            <span className="mono-tag">{release ? `v${release.version}` : '01'}</span>
            <span className="eyebrow-sep" aria-hidden="true">
              /
            </span>
            <span>Свой сервер · Вход по приглашению</span>
          </a>

          <h1 className="hero-title">
            <span className="line-mask split-left">
              <span className="line-inner" style={{ '--d': '60ms' } as CSSProperties}>
                Мессенджер
              </span>
            </span>{' '}
            <span className="line-mask split-right">
              <span className="line-inner" style={{ '--d': '160ms' } as CSSProperties}>
                для своего круга
              </span>
            </span>
          </h1>

          <p className="hero-lead">
            Чаты и группы до 100 человек, голосовые с расшифровкой, кружки и альбомы. Сервер ваш,
            без рекламы и номера телефона.
          </p>

          <div className="hero-cta">
            <a
              className="primary hero-download magnetic"
              href="#download"
              onPointerMove={onMagneticMove}
              onPointerLeave={onMagneticLeave}
            >
              <span className="cta-icon" aria-hidden="true">
                <Download size={19} />
              </span>
              <span>
                Скачать Galinka
                <small>
                  {detected === 'Web' ? 'для любой системы' : `для ${detected}`}
                  {release && ` · v${release.version}`}
                </small>
              </span>
            </a>
            <a className="hero-web" href="/app">
              Открыть Galinka в браузере <ArrowUpRight size={17} aria-hidden="true" />
            </a>
          </div>

          <a className="hero-scroll-cue" href="#features" aria-label="Листайте вниз к возможностям">
            <span className="cue-track" aria-hidden="true">
              <i />
            </span>
            <span>Листайте, чтобы увидеть</span>
          </a>
        </div>
      </section>

      {/* ACT 2: STICKY SCROLLYTELLING STAGE — 1 PINNED MORPHING DEVICE, 4 CHAPTERS */}
      <section className="story" id="features" ref={storyRef} aria-labelledby="features-title">
        <div className="story-header">
          <div className="story-kicker-row">
            <span className="section-kicker">02 / Возможности</span>
            <div className="story-tabs" role="tablist" aria-label="Разделы возможностей">
              {CHAPTERS.map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  role="tab"
                  aria-selected={activeChapter === ch.id}
                  className={activeChapter === ch.id ? 'active' : ''}
                  onClick={() => jumpToChapter(ch.id)}
                >
                  <span className="tab-num">{ch.num}</span>
                  <span>{ch.short}</span>
                </button>
              ))}
            </div>
          </div>
          <h2 id="features-title">Один экран — всё, чем вы пользуетесь каждый день.</h2>
        </div>

        <div className="story-grid">
          <div className="story-chapters">
            {CHAPTERS.map((ch, idx) => (
              <article
                key={ch.id}
                ref={(el) => {
                  chapterRefs.current[idx] = el;
                }}
                data-chapter-id={ch.id}
                className={`story-chapter ${activeChapter === ch.id ? 'active' : ''}`}
                onClick={() => setActiveChapter(ch.id)}
              >
                <div className="chapter-spine" aria-hidden="true">
                  <i />
                </div>
                <span className="chapter-num">{ch.num}</span>
                <h3>{ch.title}</h3>
                <p>{ch.body}</p>

                {/* Direct tactile theme selector right inside Chapter 02 */}
                {ch.id === 1 && (
                  <div className="chapter-theme-bar" aria-hidden="true">
                    {allThemes.map((t, i) => (
                      <span
                        key={t.id}
                        className={`chapter-theme-pill ${i === themeIdx ? 'active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveChapter(1);
                          setThemeIdx(i);
                        }}
                        onPointerEnter={() => {
                          setActiveChapter(1);
                          setThemeIdx(i);
                        }}
                        style={{ '--pill-accent': t.accent } as CSSProperties}
                      >
                        <i />
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}

                <ul className="chapter-tags">
                  {ch.tags.map((tag) => (
                    <li key={tag}>{tag}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          <div className="story-sticky-col">
            <MorphDevice
              chapter={activeChapter}
              themeIdx={themeIdx}
              onSelectTheme={setThemeIdx}
              themes={allThemes}
            />
          </div>
        </div>
      </section>

      {/* ACT 3: KINETIC EDITORIAL MARQUEE RIBBON */}
      <div className="kinetic-ribbon" ref={marqueeRef} aria-hidden="true">
        <div className="ribbon-track t-left">
          <div className="ribbon-run">
            {[...MARQUEE_TOP, ...MARQUEE_TOP, ...MARQUEE_TOP].map((word, i) => (
              <span key={i}>
                {word}
                <i className="ribbon-dot" />
              </span>
            ))}
          </div>
        </div>
        <div className="ribbon-track t-right">
          <div className="ribbon-run">
            {[...MARQUEE_BOTTOM, ...MARQUEE_BOTTOM, ...MARQUEE_BOTTOM].map((word, i) => (
              <span key={i}>
                {word}
                <i className="ribbon-dot" />
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ACT 4: CINEMA PORTAL DESKTOP SHOWCASE */}
      <section className="showcase" aria-labelledby="showcase-title">
        <div className="section-head centered">
          <span className="section-kicker">03 / Windows · macOS · Linux</span>
          <h2 id="showcase-title">На компьютере — как дома</h2>
          <p>
            Те же чаты, что на телефоне. Новое сообщение приходит уведомлением, даже если окно
            свёрнуто.
          </p>
        </div>

        <DesktopPortal />

        <div className="showcase-actions">
          <a
            className="primary magnetic"
            href="#download"
            onPointerMove={onMagneticMove}
            onPointerLeave={onMagneticLeave}
          >
            <ArrowDown size={18} aria-hidden="true" />К загрузкам
          </a>
          <a className="showcase-web" href="/app">
            Открыть веб-версию <ArrowUpRight size={16} aria-hidden="true" />
          </a>
        </div>
      </section>

      {/* ACT 5: PRECISION DOWNLOAD CONSOLE */}
      <section className="download-section" id="download" aria-labelledby="download-title">
        <div className="download">
          <div className="download-head">
            <div>
              <span className="section-kicker">04 / Установка</span>
              <div className="download-title-group">
                <h2 id="download-title">Скачать</h2>
                {release && <span className="version">v{release.version}</span>}
              </div>
            </div>
            <a className="download-changelog" href="/changelog">
              История изменений <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </div>

          <div
            className="platform-grid"
            ref={platformGridRef}
            role="group"
            aria-label="Операционная система"
          >
            <div className="platform-indicator" aria-hidden="true" />
            {platforms.map((value) => {
              const Icon = icons[value];
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={value === platform}
                  className={value === platform ? 'selected' : ''}
                  onClick={() => {
                    setPlatform(value);
                    setInstall(false);
                  }}
                >
                  <Icon size={21} aria-hidden="true" />
                  <span>{value}</span>
                  {value === detected && detected !== 'Web' && (
                    <i className="detected-dot" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="release-platform-body" key={platform}>
            <div className="platform-title">
              <span className="platform-icon-box" aria-hidden="true">
                <PlatformIcon size={24} />
              </span>
              <div>
                <h3>Galinka для {platform === 'Web' ? 'браузера' : platform}</h3>
                <p>
                  {descriptions[platform]}
                  {platform === detected && platform !== 'Web' && (
                    <span className="your-device"> Это ваше устройство.</span>
                  )}
                </p>
              </div>
            </div>

            <div className="release-files" aria-live="polite">
              {platform === 'iOS' ? (
                <>
                  <a className="primary" href="/app">
                    Открыть на iPhone <ArrowUpRight size={17} aria-hidden="true" />
                  </a>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setInstall(!install)}
                    aria-expanded={install}
                  >
                    Как установить{' '}
                    <Plus
                      size={17}
                      aria-hidden="true"
                      className={`ios-plus ${install ? 'open' : ''}`}
                    />
                  </button>
                </>
              ) : loading ? (
                <p className="release-loading">
                  <RefreshCw size={17} className="spin" aria-hidden="true" />
                  Загрузка списка…
                </p>
              ) : files.length ? (
                files.map((file) => (
                  <a className="primary" key={file.name} href={file.url}>
                    <Download size={18} aria-hidden="true" />
                    <span>{fileLabel(file)}</span>
                    <small>{Math.max(1, Math.round(file.size / 1048576))} МБ</small>
                  </a>
                ))
              ) : (
                <div className="release-unavailable">
                  <p>
                    {failed
                      ? 'Не удалось загрузить список сборок.'
                      : 'Сборки для этой платформы пока нет.'}
                  </p>
                  {failed && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setRequest((value) => value + 1)}
                    >
                      Повторить <RefreshCw size={15} aria-hidden="true" />
                    </button>
                  )}
                  <a className="secondary" href="/app">
                    Открыть веб-версию <ArrowUpRight size={16} aria-hidden="true" />
                  </a>
                </div>
              )}
            </div>

            {platform === 'Arch Linux' && (
              <div className="install-command-wrap">
                <code className="install-command">sudo pacman -U ./Galinka-*.pkg.tar.zst</code>
                <button
                  type="button"
                  className="copy-command"
                  onClick={copyArchCommand}
                  aria-label="Скопировать команду"
                >
                  {copiedCmd ? (
                    <>
                      <Check size={14} aria-hidden="true" />
                      <span>Скопировано</span>
                    </>
                  ) : (
                    <>
                      <Copy size={14} aria-hidden="true" />
                      <span>Копировать</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {install && (
              <div className="phone-instructions">
                <strong>Установить на iPhone или iPad</strong>
                <ol>
                  <li>
                    Откройте <a href="/app">Galinka</a> в Safari.
                  </li>
                  <li>Нажмите «Поделиться» → «На экран Домой».</li>
                  <li>Нажмите «Добавить» и откройте Galinka с экрана «Домой».</li>
                </ol>
              </div>
            )}

            {installPrompt && platform !== 'iOS' && (
              <button
                type="button"
                className="secondary"
                onClick={async () => {
                  await installPrompt.prompt();
                  await installPrompt.userChoice;
                  setInstallPrompt(null);
                }}
              >
                Установить веб-приложение <Plus size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ACT 6: MONUMENTAL EDITORIAL CLOSING STATEMENT + FOOTER */}
      <section className="outro" aria-label="Открыть Galinka">
        <span className="section-kicker">05 / Свой круг</span>
        <a
          className="outro-link magnetic"
          href="/app"
          onPointerMove={onMagneticMove}
          onPointerLeave={onMagneticLeave}
        >
          <span className="outro-words">Войти в Galinka</span>
          <span className="outro-orb" aria-hidden="true">
            <ArrowUpRight size={30} />
          </span>
        </a>
        <p className="outro-sub">Без рекламы, подписок и лишних людей. Только свои.</p>
      </section>

      <footer className="landing-footer">
        <a className="brand" href="/">
          <BrandMark />
          <span>Galinka</span>
        </a>
        <div className="footer-links">
          <a href="#features">Возможности</a>
          <a href="#download">Скачать</a>
          <a href="/changelog">История изменений</a>
          <a href={release?.url || 'https://github.com/cl0rex1/Galinka/releases'}>
            Все версии <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
      </footer>

      {/* Minimalist floating circular scroll compass dial (desktop only) */}
      <button
        type="button"
        className={`scroll-compass ${scrolled ? 'visible' : ''}`}
        onClick={() => window.scrollTo({ top: 0, behavior: motionAllowed() ? 'smooth' : 'auto' })}
        aria-label="Наверх"
        title="Наверх"
      >
        <svg viewBox="0 0 44 44" aria-hidden="true">
          <circle className="compass-track" cx="22" cy="22" r="19" pathLength="100" />
          <circle
            ref={compassRingRef}
            className="compass-ring"
            cx="22"
            cy="22"
            r="19"
            pathLength="100"
          />
        </svg>
        <span className="compass-num">{actIndex}</span>
        <span className="compass-up" aria-hidden="true">
          <ArrowUp size={15} />
        </span>
      </button>
    </main>
  );
}
