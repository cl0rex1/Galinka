import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Download,
  Monitor,
  Smartphone,
  Check,
  Users,
  Leaf,
  Sparkles,
  ChevronRight,
} from 'lucide-react';
import { API_BASE } from './api';
type Release = {
  version: string;
  url: string;
  assets: { name: string; url: string; size: number }[];
};
export default function Landing() {
  const [release, setRelease] = useState<Release | null>(null),
    [loading, setLoading] = useState(true),
    [platform, setPlatform] = useState('Windows'),
    [install, setInstall] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent;
    if (/Mac/.test(ua)) setPlatform('macOS');
    else if (/Linux/.test(ua) && !/Android/.test(ua)) setPlatform('Linux');
    fetch(`${API_BASE}/downloads`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setRelease)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  const files =
    release?.assets.filter((a) =>
      platform === 'Windows'
        ? a.name.endsWith('.exe')
        : platform === 'Linux'
          ? a.name.endsWith('.AppImage') || a.name.endsWith('.deb')
          : a.name.endsWith('.dmg'),
    ) || [];
  return (
    <main className="landing">
      <header className="landing-nav">
        <a href="/" className="brand">
          <img src="/icon.svg" alt="" />
          galinka<span className="brand-dot">.</span>
        </a>
        <nav>
          <a href="#download">Скачать</a>
          <a href="/app">
            Открыть в браузере
            <ArrowUpRight size={15} />
          </a>
        </nav>
      </header>
      <section className="landing-hero">
        <div className="landing-copy">
          <span className="landing-eyebrow">
            <span className="status-dot" /> Для вашей компании
          </span>
          <h1>
            Место,
            <br />
            где свои.
          </h1>
          <p>
            Разговоры до ночи, спонтанные планы
            <br />и простое «как ты?» — теперь в Galinka.
          </p>
          <div className="landing-cta">
            <a className="primary" href="#download">
              <Download size={18} />
              Скачать Galinka
            </a>
            <a className="text-button" href="/app">
              Начать общаться
              <ArrowRight size={17} />
            </a>
          </div>
          <span className="landing-platform-note">Windows · macOS · Linux · iOS · Android</span>
        </div>
        <div className="landing-conversation" aria-label="Пример разговора в Galinka">
          <div className="landing-chat-title">
            <span className="avatar group-avatar">
              <Users size={23} />
            </span>
            <div>
              <strong>На выходные</strong>
              <p>Ваш маленький круг</p>
            </div>
            <Leaf size={24} />
          </div>
          <div className="landing-chat-day">Один из тех разговоров</div>
          <div className="landing-sample">
            <span className="avatar small tone-1">А</span>
            <div>
              <small>Аня</small>
              <p>
                А давайте на выходных
                <br />
                куда-нибудь из города? 🌿
              </p>
            </div>
          </div>
          <div className="landing-sample sample-own">
            <div>
              <p>Я за. Берём кофе и в путь?</p>
              <small>
                Вы среди своих <Check size={12} />
              </small>
            </div>
          </div>
          <div className="landing-sample">
            <span className="avatar small tone-5">
              <Sparkles size={16} />
            </span>
            <div>
              <small>Неля · модуль</small>
              <p>
                Как насчёт прогулки
                <br />
                без маршрута?
              </p>
            </div>
          </div>
          <a href="/app" className="landing-demo-link">
            Ваш разговор начнётся здесь
            <ArrowRight size={18} />
          </a>
        </div>
      </section>
      <section className="landing-download" id="download">
        <div className="download-heading">
          <span className="page-symbol">
            <Download size={25} />
          </span>
          <div>
            <h2>Свои — всегда под рукой.</h2>
            <p>Установите приложение на компьютер или телефон.</p>
          </div>
          {release && <span className="version">v{release.version}</span>}
        </div>
        <div className="download-grid">
          <div className="desktop-download">
            <div className="download-tabs" aria-label="Операционная система">
              {['Windows', 'macOS', 'Linux'].map((p) => (
                <button
                  key={p}
                  className={p === platform ? 'selected' : ''}
                  onClick={() => setPlatform(p)}
                >
                  {p}
                </button>
              ))}
            </div>
            <div className="download-details">
              <Monitor size={29} />
              <h3>Galinka для {platform}</h3>
              <p>
                Отдельное окно для ваших разговоров.
                <br />
                Проверка обновлений прямо в настройках.
              </p>
              {loading ? (
                <p className="muted">Проверяем доступные сборки…</p>
              ) : files.length ? (
                files.map((a) => (
                  <a key={a.name} className="primary" href={a.url}>
                    <Download size={17} />
                    Скачать{' '}
                    {platform === 'macOS'
                      ? a.name.includes('arm64')
                        ? 'для Apple Silicon'
                        : 'для Intel'
                      : a.name.endsWith('.deb')
                        ? 'DEB'
                        : 'приложение'}
                  </a>
                ))
              ) : (
                <div className="downloads-pending">
                  <p>Сборка для {platform} готовится.</p>
                  <a className="secondary" href="/app">
                    Открыть веб-версию
                    <ArrowUpRight size={15} />
                  </a>
                </div>
              )}
              {platform === 'macOS' && (
                <small className="muted">
                  Первый выпуск пока без подписи Apple Developer. Автоустановка на macOS появится с
                  подписанными релизами.
                </small>
              )}
              {platform === 'Linux' && (
                <small className="muted">
                  Для обновления внутри приложения используйте AppImage.
                </small>
              )}
            </div>
          </div>
          <div className="phone-download">
            <Smartphone size={30} />
            <h3>На iPhone и Android</h3>
            <p>
              Установите Galinka из браузера.
              <br />
              Приложение появится на главном экране.
            </p>
            <button className="secondary" onClick={() => setInstall((v) => !v)}>
              {install ? 'Скрыть инструкцию' : 'Как установить'}
              <ChevronRight size={16} />
            </button>
            {install && (
              <div className="phone-instructions">
                <p>
                  <strong>iPhone:</strong> откройте веб-версию в Safari → «Поделиться» → «На экран
                  Домой».
                </p>
                <p>
                  <strong>Android:</strong> откройте веб-версию в Chrome → меню ⋮ → «Установить
                  приложение».
                </p>
              </div>
            )}
            <a className="text-button" href="/app">
              Перейти к установке
              <ArrowRight size={16} />
            </a>
            <span className="phone-note">
              <LockIcon />
              Ваши разговоры хранятся на сервере Quiby
            </span>
          </div>
        </div>
      </section>
      <section className="landing-invite">
        <Leaf size={29} />
        <div>
          <h2>Хорошо, когда есть свои.</h2>
          <p>Для регистрации нужен код приглашения. Попросите его у того, кто вас позвал.</p>
        </div>
        <a className="primary" href="/app">
          Присоединиться
          <ArrowRight size={17} />
        </a>
      </section>
      <footer className="landing-footer">
        <span className="brand">galinka.</span>
        <p>Сделано для своих.</p>
        <a href={release?.url || 'https://github.com/cl0rex1/Galinka/releases'}>
          Релизы на GitHub
          <ArrowUpRight size={14} />
        </a>
      </footer>
    </main>
  );
}
function LockIcon() {
  return <Check size={13} />;
}
