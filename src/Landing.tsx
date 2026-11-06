import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Download,
  Monitor,
  Smartphone,
  RefreshCw,
  Check,
  MessageCircle,
  Mic,
  Users,
  Globe,
  Plus,
} from 'lucide-react';
import { API_BASE } from './api';
import { ThemeToggle } from './theme';
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
  Android: 'Android 7 и новее.',
  iOS: 'Веб-приложение для iPhone и iPad: Safari → «На экран Домой».',
  Windows: 'Windows 10 и новее, x64.',
  macOS: 'Apple Silicon или Intel.',
  Linux: 'AppImage или DEB для Debian и Ubuntu, x64.',
  'Arch Linux': 'Пакет для pacman с системным Electron.',
  Web: 'Любой современный браузер.',
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
export default function Landing() {
  const [release, setRelease] = useState<Release | null>(null);
  const [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false);
  const [platform, setPlatform] = useState<Platform>(() => detectPlatform());
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
  const files = releaseFiles(release, platform),
    mobile = platform === 'Android' || platform === 'iOS';
  return (
    <main className="landing release-site">
      <header className="landing-nav">
        <a href="/" className="brand">
          <img src="/icon.svg" alt="" />
          Galinka
        </a>
        <nav aria-label="Навигация сайта">
          <ThemeToggle />
          <a href="/changelog">Изменения</a>
          <a href="#download">Скачать</a>
          <a className="secondary" href="/app">
            Войти <ArrowUpRight size={15} />
          </a>
        </nav>
      </header>
      <section className="release-hero" id="download">
        <div className="release-intro">
          <h1>Мессенджер для своего круга</h1>
          <p>
            Личные чаты и группы до 100 человек, голосовые, фото и файлы. Сервер ваш, регистрация —
            по приглашению.
          </p>
          <a className="release-web-link" href="/app">
            Открыть Galinka в браузере <ArrowUpRight size={19} />
          </a>
        </div>
        <div className="release-picker">
          <div className="release-picker-heading">
            <h2>Скачать</h2>
            {release && <span className="version">v{release.version}</span>}
          </div>
          <div className="release-device" role="status">
            <Check size={15} />{' '}
            {platform === detectPlatform() && platform !== 'Web'
              ? `Для вашего устройства: ${platform}`
              : `Выбрано: ${platform}`}
          </div>
          <div
            className="download-tabs release-tabs"
            role="group"
            aria-label="Операционная система"
          >
            {platforms.map((value) => (
              <button
                key={value}
                aria-pressed={value === platform}
                className={value === platform ? 'selected' : ''}
                onClick={() => {
                  setPlatform(value);
                  setInstall(false);
                }}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="release-platform-body" key={platform}>
            <span className="release-os-icon">
              {mobile ? (
                <Smartphone size={28} />
              ) : platform === 'Web' ? (
                <Globe size={28} />
              ) : (
                <Monitor size={28} />
              )}
            </span>
            <h3>Galinka для {platform === 'Web' ? 'браузера' : platform}</h3>
            <p>{descriptions[platform]}</p>
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
              ) : platform === 'Web' ? (
                <a className="primary" href="/app">
                  Открыть <ArrowRight size={17} />
                </a>
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
                    <button
                      className="text-button"
                      onClick={() => setRequest((value) => value + 1)}
                    >
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
                className="text-button"
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
        </div>
      </section>
      <section className="release-story">
        <div className="release-story-heading">
          <h2>Что внутри</h2>
        </div>
        <div className="release-preview">
          <img
            src="/preview.png"
            alt="Групповой чат в Galinka"
            loading="lazy"
            width="1440"
            height="960"
          />
        </div>
        <div className="release-features">
          <div>
            <MessageCircle size={22} />
            <h3>Переписка</h3>
            <p>Ответы, реакции, правки, поиск, закреплённые чаты и архив.</p>
          </div>
          <div>
            <Mic size={22} />
            <h3>Голосовые и фото</h3>
            <p>Голосовые до 5 минут с перемоткой. Фото сжимаются перед отправкой.</p>
          </div>
          <div>
            <Users size={22} />
            <h3>Группы</h3>
            <p>Ссылки-приглашения, передача владения, бот Неля для жребия и выбора.</p>
          </div>
        </div>
      </section>
      <footer className="landing-footer">
        <a className="brand" href="/">
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
