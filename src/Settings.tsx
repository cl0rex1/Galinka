import { useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Bell,
  Camera,
  ChevronRight,
  Download,
  History,
  Lock,
  LogOut,
  Mic,
  Palette,
  Pencil,
  QrCode,
  Shield,
  ShieldCheck,
  Smartphone,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { MediaSettings } from './MediaSettings';
import { MotionSettings } from './motion';
import { NotificationSettings, type useNotifications } from './notifications';
import { ProfileHero } from './ProfileHero';
import { haptic, IconButton, useBackHandler, usePresence } from './ui';
import { usePanelSwipeBack } from './gestures';
import { Security } from './Security';
import { Appearance, LookSettings } from './Appearance';
import { api, upload } from './api';
import { PhotoPicker, photoForm } from './AvatarEditor';
import { NotificationPreferences, PreviewSettings, PrivacySettings } from './Privacy';
import { currentAccent, profileLink, ShareSheet, themeLink } from './Share';
import { Updates } from './updates';
import { draftOf, ProfileEditor, type ProfileDraft } from './ProfileEditor';
import type { Person } from './types';

/**
 * Settings, as in Telegram: one list of sections with coloured icons, each section opening as a
 * screen of its own over the list. The icon colours are the avatar tones, so the list speaks the
 * same language as the chats. Back, Esc, the Android back button and a swipe from the left edge
 * all return to the list.
 */
type Page = 'profile' | 'notifications' | 'privacy' | 'security' | 'look' | 'media' | 'app';
const pages: Record<Page, { title: string; icon: LucideIcon; tone: number }> = {
  profile: { title: 'Профиль', icon: UserRound, tone: 2 },
  notifications: { title: 'Уведомления и звуки', icon: Bell, tone: 0 },
  privacy: { title: 'Конфиденциальность', icon: Lock, tone: 2 },
  security: { title: 'Безопасность и устройства', icon: ShieldCheck, tone: 1 },
  look: { title: 'Оформление', icon: Palette, tone: 4 },
  media: { title: 'Голос и видео', icon: Mic, tone: 3 },
  app: { title: 'Приложение', icon: Smartphone, tone: 5 },
};
const groups: Page[][] = [
  ['notifications', 'privacy', 'security'],
  ['look', 'media'],
  ['app'],
];

export function Settings({
  me,
  demo,
  notifications,
  hasDraft,
  onInstall,
  onLogout,
  onMe,
}: {
  me: Person;
  demo: boolean;
  notifications: ReturnType<typeof useNotifications>;
  hasDraft: boolean;
  onInstall?: () => void;
  onLogout: () => void;
  onMe: (person: Person) => void;
}) {
  const [page, setPage] = useState<Page | null>(null);
  const [shown, setShown] = useState<Page | null>(null);
  const [share, setShare] = useState<Omit<Parameters<typeof ShareSheet>[0], 'onClose'> | null>(
    null,
  );
  const open = (next: Page) => {
    setShown(next);
    setPage(next);
  };
  const back = () => setPage(null);
  // What was typed into the profile stays here when its screen closes without saving.
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const shareMe = () =>
    setShare({
      heading: 'Мой профиль',
      title: me.name,
      subtitle: `@${me.username}`,
      link: profileLink(me.username),
      accent: currentAccent(),
      face: { photo: me.avatar, tone: me.color },
    });
  const presence = usePresence(page !== null, 260);
  useBackHandler(page !== null, back);
  const swipe = usePanelSwipeBack(back);

  const content: Record<Page, ReactNode> = {
    profile: (
      <ProfileEditor
        me={me}
        draft={draft ?? draftOf(me)}
        onDraft={setDraft}
        onSaved={back}
        onMe={onMe}
      />
    ),
    notifications: (
      <>
        <NotificationSettings state={notifications} demo={demo} />
        <PreviewSettings />
        <NotificationPreferences />
      </>
    ),
    privacy: <PrivacySettings />,
    security: (
      <>
        <Security demo={demo} />
        <p className="settings-note">
          Сквозного шифрования нет: переписку видят её участники и администратор сервера.
        </p>
      </>
    ),
    look: (
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
    ),
    media: <MediaSettings />,
    app: (
      <>
        <section className="settings-section">
          <h2>Обновления</h2>
          <Updates hasDraft={hasDraft} />
        </section>
        <nav className="settings-section action-list rows" aria-label="Ещё">
          {onInstall && (
            <button onClick={onInstall}>
              <Download size={19} />
              Установить Galinka
              <ChevronRight size={17} className="row-chevron" />
            </button>
          )}
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
    ),
  };

  return (
    <div className="settings-stack">
      <div className="content-page settings-page" inert={page !== null}>
        <h1>Настройки</h1>
        {/* The header: the person's own colour behind their photo, as a cover. */}
        <div className={`settings-profile cover-${me.color % 6}`}>
        <ProfileHero person={me} title={me.name} subtitle={`@${me.username}`} about={me.bio}>
          <div className="hero-tiles">
            <button onClick={() => open('profile')} aria-label="Изменить профиль">
              <Pencil size={20} />
              Изменить
            </button>
            <PhotoPicker
              hasPhoto={Boolean(me.avatar)}
              onUpload={async (blob) =>
                onMe(await upload<Person>('/me/avatar', photoForm(blob), () => {}))
              }
              onRemove={async () => onMe(await api<Person>('/me/avatar', 'DELETE'))}
              trigger={(choose) => (
                <button
                  onClick={choose}
                  aria-label={me.avatar ? 'Фото профиля' : 'Добавить фото профиля'}
                >
                  <Camera size={20} />
                  Фото
                </button>
              )}
            />
            <button onClick={shareMe}>
              <QrCode size={20} />
              QR-код
            </button>
          </div>
        </ProfileHero>
        </div>
        {groups.map((group) => (
          <nav key={group[0]} className="settings-section settings-menu" aria-label="Настройки">
            {group.map((id) => {
              const { title, icon: Icon, tone } = pages[id];
              return (
                <button key={id} aria-label={title} onClick={() => open(id)}>
                  <span className={`settings-icon tone-${tone}`} aria-hidden="true">
                    <Icon size={17} />
                  </span>
                  <span className="settings-menu-label">{title}</span>
                  {id === 'app' && <small>{__APP_VERSION__}</small>}
                  <ChevronRight size={17} className="row-chevron" />
                </button>
              );
            })}
          </nav>
        ))}
        <button
          className="logout-button"
          onClick={() => {
            haptic('press');
            onLogout();
          }}
        >
          <LogOut size={18} />
          {demo ? 'Выйти из демоверсии' : 'Выйти из аккаунта'}
        </button>
      </div>
      {presence.mounted && shown && (
        <section
          className={`content-page settings-subpage ${presence.closing ? 'closing' : ''}`}
          aria-labelledby="settings-page-title"
          inert={presence.closing}
          {...swipe}
        >
          <header className="settings-subpage-head">
            <IconButton label="Назад к настройкам" onClick={back}>
              <ArrowLeft size={22} />
            </IconButton>
            <h2 id="settings-page-title">{pages[shown].title}</h2>
          </header>
          <div className="settings-panel">{content[shown]}</div>
        </section>
      )}
      {share && <ShareSheet {...share} onClose={() => setShare(null)} />}
    </div>
  );
}
