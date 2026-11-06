import { useRef, useState } from 'react';
import {
  ChevronRight,
  Download,
  History,
  LogOut,
  Pencil,
  QrCode,
  ScanLine,
  Shield,
} from 'lucide-react';
import { MediaSettings } from './MediaSettings';
import { MotionSettings } from './motion';
import { NotificationSettings, type useNotifications } from './notifications';
import { ProfileHero } from './ProfileHero';
import { useTabIndicator } from './ui';
import { Security } from './Security';
import { Appearance, LookSettings } from './Appearance';
import { currentAccent, profileLink, ShareSheet, themeLink } from './Share';
import { Updates } from './updates';
import type { Person } from './types';

const tabs = [
  ['general', 'Основные'],
  ['look', 'Оформление'],
  ['media', 'Голос и видео'],
  ['security', 'Безопасность'],
  ['app', 'Приложение'],
] as const;
type Tab = (typeof tabs)[number][0];
const stored = (): Tab => {
  try {
    const value = localStorage.getItem('galinka-settings-tab');
    return tabs.some(([id]) => id === value) ? (value as Tab) : 'general';
  } catch {
    return 'general';
  }
};

export function Settings({
  me,
  demo,
  notifications,
  hasDraft,
  onEditName,
  onInstall,
  onLogout,
  onScan,
}: {
  me: Person;
  demo: boolean;
  notifications: ReturnType<typeof useNotifications>;
  hasDraft: boolean;
  onEditName: () => void;
  onInstall: () => void;
  onLogout: () => void;
  onScan: () => void;
}) {
  const [tab, setTab] = useState<Tab>(stored);
  const [share, setShare] = useState<Omit<Parameters<typeof ShareSheet>[0], 'onClose'> | null>(
    null,
  );
  const list = useTabIndicator(tab);
  // The panel slides in from the side of the tab chosen.
  const move = useRef({ tab, dir: '' });
  if (move.current.tab !== tab)
    move.current = {
      tab,
      dir:
        tabs.findIndex(([id]) => id === tab) > tabs.findIndex(([id]) => id === move.current.tab)
          ? 'next'
          : 'prev',
    };
  const choose = (next: Tab) => {
    setTab(next);
    try {
      localStorage.setItem('galinka-settings-tab', next);
    } catch {
      /* private mode: the tab is not remembered */
    }
  };
  return (
    <div className="content-page settings-page">
      <h1>Настройки</h1>
      <ProfileHero person={me} title={me.name} subtitle={`@${me.username}`}>
        <div className="hero-tiles">
          <button onClick={onEditName} aria-label="Изменить имя">
            <Pencil size={20} />
            Имя
          </button>
          <button
            onClick={() =>
              setShare({
                heading: 'Мой профиль',
                title: me.name,
                subtitle: `@${me.username}`,
                link: profileLink(me.username),
                accent: currentAccent(),
              })
            }
          >
            <QrCode size={20} />
            QR-код
          </button>
          <button onClick={onScan}>
            <ScanLine size={20} />
            Сканер
          </button>
        </div>
      </ProfileHero>
      <div
        className="settings-tabs"
        role="tablist"
        aria-label="Разделы настроек"
        ref={list}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
          const index = tabs.findIndex(([id]) => id === tab);
          const next =
            tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length][0];
          choose(next);
          event.currentTarget.querySelector<HTMLElement>(`#settings-tab-${next}`)?.focus();
        }}
      >
        {tabs.map(([id, label]) => (
          <button
            key={id}
            id={`settings-tab-${id}`}
            role="tab"
            aria-selected={tab === id}
            aria-controls="settings-panel"
            tabIndex={tab === id ? 0 : -1}
            onClick={() => choose(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        id="settings-panel"
        role="tabpanel"
        aria-labelledby={`settings-tab-${tab}`}
        className="settings-panel"
        key={tab}
        data-dir={move.current.dir}
      >
        {tab === 'general' && <NotificationSettings state={notifications} demo={demo} />}
        {tab === 'look' && (
          <>
            <Appearance
              onShare={(theme) =>
                setShare({
                  heading: 'Поделиться темой',
                  title: theme.name,
                  subtitle: 'Тема оформления Galinka',
                  link: themeLink(theme),
                  accent: theme.accent,
                })
              }
            >
              <MotionSettings />
            </Appearance>
            <LookSettings />
          </>
        )}
        {tab === 'media' && <MediaSettings />}
        {tab === 'security' && (
          <>
            <Security demo={demo} />
            <p className="settings-note">
              Сквозного шифрования нет: переписку видят её участники и администратор сервера.
            </p>
          </>
        )}
        {tab === 'app' && (
          <>
            <section className="settings-section">
              <h2>Обновления</h2>
              <Updates hasDraft={hasDraft} />
            </section>
            <nav className="settings-section action-list rows" aria-label="Ещё">
              <button onClick={onInstall}>
                <Download size={19} />
                Установить Galinka
                <ChevronRight size={17} className="row-chevron" />
              </button>
              <a href="/changelog">
                <History size={19} />
                История изменений
                <ChevronRight size={17} className="row-chevron" />
              </a>
              {me.role === 'admin' && !demo && (
                <a href="/admin">
                  <Shield size={19} />
                  Администрирование
                  <ChevronRight size={17} className="row-chevron" />
                </a>
              )}
            </nav>
          </>
        )}
      </div>
      <button className="logout-button" onClick={onLogout}>
        <LogOut size={18} />
        {demo ? 'Выйти из демоверсии' : 'Выйти из аккаунта'}
      </button>
      <p className="settings-version">Galinka {__APP_VERSION__}</p>
      {share && <ShareSheet {...share} onClose={() => setShare(null)} />}
    </div>
  );
}
