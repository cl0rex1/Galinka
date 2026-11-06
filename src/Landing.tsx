import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  CheckCheck,
  Download,
  Globe,
  Laptop,
  Mic,
  Monitor,
  Package,
  Plus,
  RefreshCw,
  Search,
  Smartphone,
  TabletSmartphone,
  Terminal,
} from 'lucide-react';
import { API_BASE } from './api';
import { ThemePreview } from './Appearance';
import { BrandQR } from './Share';
import { presets, ThemeToggle } from './theme';
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

/**
 * A phone playing a short conversation, built from the app's own bubbles rather than a
 * screenshot: messages arrive one by one, a reaction pops, a round video plays.
 */
function PhoneDemo() {
  return (
    <div className="phone" aria-hidden="true">
      <div className="phone-screen">
        <div className="phone-head">
          <span className="phone-avatar">СЛ</span>
          <span>
            <strong>Свои люди</strong>
            <small>4 участника</small>
          </span>
        </div>
        <div className="phone-chat">
          <span className="demo-day">Сегодня</span>
          <div className="demo-msg in" style={{ '--at': '0.3s' } as never}>
            <b className="tone-text-1">Аня</b>
            Кто сегодня на настолки? 🎲
            <time>19:02</time>
          </div>
          <div className="demo-msg out" style={{ '--at': '1.1s' } as never}>
            Я! Беру «Каркассон»
            <time>
              19:03 <CheckCheck size={13} />
            </time>
            <span className="demo-reaction" style={{ '--at': '2.4s' } as never}>
              ❤ 2
            </span>
          </div>
          <div className="demo-msg in" style={{ '--at': '1.8s' } as never}>
            <b className="tone-text-4">Макс</b>
            Буду к восьми, захвачу пиццу
            <time>19:04</time>
          </div>
          <div className="demo-note" style={{ '--at': '3s' } as never}>
            <span className="demo-note-face">🍕</span>
            <svg viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="48" pathLength="100" />
            </svg>
            <time>0:07</time>
          </div>
          <div className="demo-msg out voice" style={{ '--at': '3.8s' } as never}>
            <Mic size={16} />
            <span className="demo-wave">
              {[5, 9, 14, 8, 12, 16, 10, 6, 11, 15, 9, 5, 8, 12, 7].map((h, i) => (
                <i key={i} style={{ height: h }} />
              ))}
            </span>
            <time>0:12</time>
          </div>
        </div>
        <div className="phone-composer">
          <span>Сообщение</span>
          <i>
            <Mic size={15} />
          </i>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  const [release, setRelease] = useState<Release | null>(null);
  const [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false);
  const detected = detectPlatform();
  const [platform, setPlatform] = useState<Platform>(detected);
  const [install, setInstall] = useState(false);
  const [request, setRequest] = useState(0);
  const [installPrompt, setInstallPrompt] = useState<{
    prompt: () => Promise<void>;
    userChoice: Promise<unknown>;
  } | null>(null);
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
  const files = releaseFiles(release, platform);
  const PlatformIcon = icons[platform];
  return (
    <main className="landing">
      <header className="landing-nav">
        <a href="/" className="brand">
          <img src="/icon.svg" alt="" />
          Galinka
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
      </header>

      <section className="hero">
        <div className="hero-copy">
          <h1>Мессенджер для своего круга</h1>
          <p>
            Чаты и группы до 100 человек, голосовые и кружки, фото и видео. Сервер ваш, вход — по
            приглашению.
          </p>
          <div className="hero-cta">
            <a className="primary hero-download" href="#download">
              <Download size={19} />
              <span>
                Скачать Galinka
                <small>
                  {detected === 'Web' ? 'для любой системы' : `для ${detected}`}
                  {release && ` · v${release.version}`}
                </small>
              </span>
            </a>
            <a className="hero-web" href="/app">
              Открыть Galinka в браузере <ArrowUpRight size={17} />
            </a>
          </div>
          <ul className="hero-facts">
            <li>
              <Check size={16} /> Без рекламы и номера телефона
            </li>
            <li>
              <Check size={16} /> Android, iPhone, Windows, macOS, Linux
            </li>
          </ul>
        </div>
        <PhoneDemo />
      </section>

      <section className="features" id="features" aria-labelledby="features-title">
        <h2 id="features-title">Привычно, как в Telegram. Только своё.</h2>
        <div className="feature-grid">
          <article className="feature wide">
            <div className="feature-visual themes-visual">
              {presets.slice(0, 5).map((theme) => (
                <ThemePreview key={theme.id} theme={theme} />
              ))}
            </div>
            <h3>Темы под настроение</h3>
            <p>
              Шесть готовых и редактор с живым предпросмотром: акцент, фон чата, цвет своих
              сообщений. Темой можно поделиться ссылкой.
            </p>
          </article>
          <article className="feature">
            <div className="feature-visual qr-visual">
              <BrandQR value="https://mess.quiby.me" accent="#b3302a" />
            </div>
            <h3>Вход по QR</h3>
            <p>
              Покажите код на компьютере и наведите телефон — без пароля. Тем же сканером
              добавляются друзья и группы.
            </p>
          </article>
          <article className="feature">
            <div className="feature-visual search-visual" aria-hidden="true">
              <span className="search-pill">
                <Search size={15} /> пицц
              </span>
              <span className="search-hit">
                <b>Свои люди</b>
                <span>
                  Макс: захвачу <mark>пицц</mark>у
                </span>
              </span>
              <span className="search-hit">
                <b>Аня</b>
                <span>
                  Та <mark>пицц</mark>ерия на углу?
                </span>
              </span>
            </div>
            <h3>Поиск по всем чатам</h3>
            <p>
              Чаты, люди и сообщения в одном списке. Нажатие открывает переписку на нужном месте.
            </p>
          </article>
          <article className="feature wide">
            <div className="feature-visual media-visual" aria-hidden="true">
              <span className="media-note">🎬</span>
              <span className="media-voice">
                <Mic size={16} />
                <span className="demo-wave">
                  {[6, 12, 16, 9, 14, 7, 11, 15, 8, 5, 10, 13].map((h, i) => (
                    <i key={i} style={{ height: h }} />
                  ))}
                </span>
                0:24
              </span>
              <span className="media-photo" />
            </div>
            <h3>Кружки, голосовые, фото и видео</h3>
            <p>
              Кружки до минуты, голосовые до пяти минут с перемоткой и скоростью. Фото открываются с
              зумом, видео играют прямо в чате.
            </p>
          </article>
        </div>
      </section>

      <section className="download" id="download" aria-labelledby="download-title">
        <div className="download-head">
          <h2 id="download-title">Скачать</h2>
          {release && <span className="version">v{release.version}</span>}
        </div>
        <div className="platform-grid" role="group" aria-label="Операционная система">
          {platforms.map((value) => {
            const Icon = icons[value];
            return (
              <button
                key={value}
                aria-pressed={value === platform}
                className={value === platform ? 'selected' : ''}
                onClick={() => {
                  setPlatform(value);
                  setInstall(false);
                }}
              >
                <Icon size={22} aria-hidden="true" />
                {value}
              </button>
            );
          })}
        </div>
        <div className="release-platform-body" key={platform}>
          <div className="platform-title">
            <PlatformIcon size={26} aria-hidden="true" />
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
                  Открыть на iPhone <ArrowUpRight size={17} />
                </a>
                <button
                  className="secondary"
                  onClick={() => setInstall(!install)}
                  aria-expanded={install}
                >
                  Как установить <Plus size={17} />
                </button>
              </>
            ) : loading ? (
              <p className="release-loading">
                <RefreshCw size={17} className="spin" />
                Загрузка списка…
              </p>
            ) : files.length ? (
              files.map((file) => (
                <a className="primary" key={file.name} href={file.url}>
                  <Download size={18} />
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
                  <button className="secondary" onClick={() => setRequest((value) => value + 1)}>
                    Повторить <RefreshCw size={15} />
                  </button>
                )}
                <a className="secondary" href="/app">
                  Открыть веб-версию <ArrowUpRight size={16} />
                </a>
              </div>
            )}
          </div>
          {platform === 'Arch Linux' && (
            <code className="install-command">sudo pacman -U ./Galinka-*.pkg.tar.zst</code>
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
              className="secondary"
              onClick={async () => {
                await installPrompt.prompt();
                await installPrompt.userChoice;
                setInstallPrompt(null);
              }}
            >
              Установить веб-приложение <Plus size={16} />
            </button>
          )}
        </div>
      </section>

      <section className="showcase" aria-labelledby="showcase-title">
        <h2 id="showcase-title">На компьютере — как дома</h2>
        <p>
          Те же чаты, что на телефоне. Новое сообщение приходит уведомлением, даже если окно
          свёрнуто.
        </p>
        <div className="window">
          <div className="window-bar" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <img
            src="/preview.png"
            alt="Групповой чат в Galinka на компьютере"
            loading="lazy"
            width="1440"
            height="960"
          />
        </div>
        <a className="primary" href="#download">
          <ArrowDown size={18} />К загрузкам
        </a>
      </section>

      <footer className="landing-footer">
        <a className="brand" href="/">
          <img src="/icon.svg" alt="" />
          Galinka
        </a>
        <a href="/changelog">История изменений</a>
        <a href={release?.url || 'https://github.com/cl0rex1/Galinka/releases'}>
          Все версии <ArrowUpRight size={14} />
        </a>
      </footer>
    </main>
  );
}
