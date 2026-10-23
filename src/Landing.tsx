import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Download,
  Monitor,
  Smartphone,
  Check,
  Users,
  MessageCircle,
} from 'lucide-react';
import { API_BASE } from './api';
import { ThemeToggle } from './theme';
type Release = {
  version: string;
  url: string;
  assets: { name: string; url: string; size: number }[];
};
const platforms = ['Windows', 'Android', 'Arch Linux', 'Linux', 'macOS'] as const;
export default function Landing() {
  const [release, setRelease] = useState<Release | null>(null);
  const [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState<string>('Windows');
  const [install, setInstall] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent;
    if (/Android/.test(ua)) setPlatform('Android');
    else if (/Mac/.test(ua)) setPlatform('macOS');
    else if (/Linux/.test(ua)) setPlatform('Linux');
    fetch(`${API_BASE}/downloads`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setRelease)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  const extension =
    platform === 'Windows'
      ? '.exe'
      : platform === 'Android'
        ? '.apk'
        : platform === 'Arch Linux'
          ? '.pkg.tar.zst'
          : platform === 'Linux'
            ? '.AppImage'
            : '.dmg';
  const files = release?.assets.filter((asset) => asset.name.endsWith(extension)) || [];
  return (
    <main className="landing">
      <header className="landing-nav">
        <a href="/" className="brand">
          <img src="/icon.svg" alt="" />
          galinka<span className="brand-dot">.</span>
        </a>
        <nav>
          <ThemeToggle />
          <a href="#download">Скачать</a>
          <a className="secondary" href="/app">
            Войти <ArrowUpRight size={15} />
          </a>
        </nav>
      </header>
      <section className="landing-hero">
        <div className="landing-copy">
          <span className="landing-eyebrow">
            <span className="status-dot" /> Всегда на связи
          </span>
          <h1>
            Место,
            <br />
            где свои.
          </h1>
          <p>
            Личные чаты, общие планы и важные мелочи.
            <br />
            Всё в одном спокойном мессенджере.
          </p>
          <div className="landing-cta">
            <a className="primary" href="/app">
              Начать общаться <ArrowRight size={18} />
            </a>
            <a className="text-button" href="/?demo=1">
              Открыть демо <ArrowUpRight size={16} />
            </a>
          </div>
          <span className="landing-platform-note">Android · Windows · Linux</span>
        </div>
        <div className="landing-conversation" aria-label="Пример разговора в Galinka">
          <div className="landing-chat-title">
            <span className="avatar group-avatar">
              <Users size={23} />
            </span>
            <div>
              <strong>На выходные</strong>
              <p>5 участников</p>
            </div>
            <MessageCircle size={22} />
          </div>
          <div className="landing-chat-day">Сегодня</div>
          <div className="landing-sample">
            <span className="avatar small tone-1">А</span>
            <div>
              <small>Аня</small>
              <p>Завтра за город? 🌿</p>
            </div>
          </div>
          <div className="landing-sample sample-own">
            <div>
              <p>Да! В 9 у кофейни?</p>
              <small>
                12:04 <Check size={12} />
              </small>
            </div>
          </div>
          <div className="landing-sample">
            <span className="avatar small tone-2">М</span>
            <div>
              <small>Макс</small>
              <p>Беру кофе на всех ☕</p>
            </div>
          </div>
          <a href="/?demo=1" className="landing-demo-link">
            Сообщение… <ArrowRight size={18} />
          </a>
        </div>
      </section>
      <section className="landing-download" id="download">
        <div className="download-heading">
          <div>
            <span className="landing-eyebrow">На ваших устройствах</span>
            <h2>Разговоры — с собой.</h2>
          </div>
          {release && <span className="version">v{release.version}</span>}
        </div>
        <div className="download-tabs" role="group" aria-label="Операционная система">
          {platforms.map((value) => (
            <button
              key={value}
              aria-pressed={value === platform}
              className={value === platform ? 'selected' : ''}
              onClick={() => setPlatform(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="download-grid">
          <div className="download-details">
            {platform === 'Android' ? <Smartphone size={30} /> : <Monitor size={30} />}
            <h3>Galinka для {platform}</h3>
            <p>
              {platform === 'Android'
                ? 'APK для Android 7 и новее.'
                : platform === 'Arch Linux'
                  ? 'Пакет для установки через pacman.'
                  : platform === 'Linux'
                    ? 'AppImage для Linux x64.'
                    : 'Отдельное приложение для ваших чатов.'}
            </p>
            {loading ? (
              <p className="muted">Проверяем сборки…</p>
            ) : files.length ? (
              files.map((asset) => (
                <a key={asset.name} className="primary" href={asset.url}>
                  <Download size={17} />
                  Скачать{' '}
                  {platform === 'macOS'
                    ? asset.name.includes('arm64')
                      ? 'для Apple Silicon'
                      : 'для Intel'
                    : 'приложение'}
                  <span className="download-size">{Math.round(asset.size / 1048576)} МБ</span>
                </a>
              ))
            ) : (
              <div className="downloads-pending">
                <p>Установщик появится после публикации релиза.</p>
                <a className="secondary" href="/app">
                  Открыть веб-версию <ArrowUpRight size={15} />
                </a>
              </div>
            )}
            {platform === 'Arch Linux' && (
              <code className="install-command">sudo pacman -U ./Galinka-*.pkg.tar.zst</code>
            )}
          </div>
          <div className="phone-download">
            <Smartphone size={28} />
            <h3>И прямо в браузере</h3>
            <p>На компьютере, iPhone и Android.</p>
            <button
              className="secondary"
              onClick={() => setInstall(!install)}
              aria-expanded={install}
            >
              Как установить <ArrowRight size={16} />
            </button>
            {install && (
              <div className="phone-instructions">
                <p>
                  <strong>iPhone:</strong> Safari → «Поделиться» → «На экран Домой».
                </p>
                <p>
                  <strong>Android:</strong> Chrome → меню → «Установить приложение».
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
      <footer className="landing-footer">
        <span className="brand">galinka.</span>
        <p>Вход по приглашению</p>
        <a href={release?.url || 'https://github.com/cl0rex1/Galinka/releases'}>
          Релизы <ArrowUpRight size={14} />
        </a>
      </footer>
    </main>
  );
}
