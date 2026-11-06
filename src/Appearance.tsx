import { useState, type CSSProperties, type ReactNode } from 'react';
import { Check, Pencil, Pipette, Plus, Share2, Trash2 } from 'lucide-react';
import {
  chooseTheme,
  deleteTheme,
  findTheme,
  inkOn,
  ownThemes,
  presets,
  saveTheme,
  selectedTheme,
  ThemePicker,
  useThemeState,
  type CustomTheme,
} from './theme';
import { CloseButton, Confirm, Modal } from './ui';

/** The standard look, for previews only: applying it means removing every override. */
const kalina: CustomTheme = {
  id: '',
  name: 'Калина',
  base: 'light',
  accent: '#b3302a',
  wallpaper: '#e9e3d9',
  outgoing: '#fbe2da',
};
const swatches = {
  light: {
    accent: [
      '#b3302a',
      '#2468b0',
      '#2c7a4b',
      '#7446b4',
      '#c9581a',
      '#0f7f86',
      '#b8235a',
      '#4f5865',
    ],
    wallpaper: [
      '#e9e3d9',
      '#dce7ef',
      '#e1e9dc',
      '#e9e3f1',
      '#f1e6d6',
      '#e4e4e6',
      '#f3dfe3',
      '#d9ebe9',
    ],
    outgoing: [
      '#fbe2da',
      '#d3e6fb',
      '#d8eed3',
      '#e6dafa',
      '#fde7c8',
      '#e6e6ec',
      '#f8d9e4',
      '#d2efec',
    ],
  },
  dark: {
    accent: [
      '#ff8a7a',
      '#7aa7ff',
      '#6fcf8f',
      '#b794f6',
      '#f2a541',
      '#4fd1c5',
      '#f48fb1',
      '#a0aec0',
    ],
    wallpaper: [
      '#0c0d0e',
      '#0c1118',
      '#0d1410',
      '#120f18',
      '#111111',
      '#1a1410',
      '#0f1718',
      '#17151c',
    ],
    outgoing: [
      '#5b2621',
      '#1d3558',
      '#1e3d2a',
      '#3a2a57',
      '#3b2b14',
      '#2c2c30',
      '#4a1f33',
      '#163d3c',
    ],
  },
};

/** A small chat drawn in the theme's colours: wallpaper, an incoming and an own bubble. */
export function ThemePreview({ theme, large = false }: { theme: CustomTheme; large?: boolean }) {
  const dark = theme.base === 'dark';
  return (
    <div
      className={`theme-preview ${large ? 'large' : ''}`}
      aria-hidden="true"
      style={
        {
          '--p-wall': theme.wallpaper,
          '--p-in': dark ? '#202125' : '#ffffff',
          '--p-in-ink': dark ? '#f1f1f2' : '#19191a',
          '--p-out': theme.outgoing,
          '--p-out-ink': inkOn(theme.outgoing),
          '--p-accent': theme.accent,
          '--p-bar': dark ? '#18191b' : '#ffffff',
        } as CSSProperties
      }
    >
      <span className="tp-in">{large ? 'Привет! Как тебе тема?' : ''}</span>
      <span className="tp-out">{large ? 'Нравится, оставлю' : ''}</span>
      <span className="tp-bar">
        <i />
        <b />
      </span>
    </div>
  );
}

/** Settings → Appearance: theme gallery, mode for the standard theme, editor, sharing. */
export function Appearance({
  onShare,
  children,
}: {
  onShare: (theme: CustomTheme) => void;
  children?: ReactNode;
}) {
  useThemeState();
  const current = findTheme(selectedTheme()) ?? kalina;
  const own = ownThemes();
  const mine = own.some((theme) => theme.id === current.id);
  const [editing, setEditing] = useState<CustomTheme | null>(null);
  const [removing, setRemoving] = useState(false);
  return (
    <section className="settings-section">
      <h2>Тема</h2>
      <div className="theme-gallery" role="radiogroup" aria-label="Тема">
        {[kalina, ...presets, ...own].map((theme) => (
          <button
            key={theme.id || 'kalina'}
            type="button"
            role="radio"
            aria-checked={current.id === theme.id}
            aria-label={`Тема ${theme.name}`}
            className="theme-card"
            onClick={() => chooseTheme(theme.id)}
          >
            <ThemePreview theme={theme} />
            <span>
              {current.id === theme.id && <Check size={13} />}
              {theme.name}
            </span>
          </button>
        ))}
        <button
          type="button"
          className="theme-card create"
          onClick={() => setEditing({ ...current, id: crypto.randomUUID(), name: 'Моя тема' })}
        >
          <span className="create-icon">
            <Plus size={22} />
          </span>
          <span>Создать</span>
        </button>
      </div>
      {!current.id && <ThemePicker />}
      <div className="action-list rows">
        {mine && (
          <button type="button" onClick={() => setEditing(current)}>
            <Pencil size={19} />
            Изменить тему
          </button>
        )}
        <button type="button" onClick={() => onShare(current)}>
          <Share2 size={19} />
          Поделиться темой
        </button>
        {mine && (
          <button type="button" className="danger-text" onClick={() => setRemoving(true)}>
            <Trash2 size={19} />
            Удалить тему
          </button>
        )}
      </div>
      {children}
      {removing && (
        <Confirm
          title="Удалить тему?"
          text={`«${current.name}» исчезнет с этого устройства. Включится стандартная тема.`}
          action="Удалить"
          onConfirm={async () => deleteTheme(current.id)}
          onClose={() => setRemoving(false)}
        />
      )}
      {editing && (
        <ThemeEditor
          theme={editing}
          isNew={!own.some((theme) => theme.id === editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function ColorRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (color: string) => void;
}) {
  return (
    <div className="color-row" role="group" aria-label={label}>
      <span>{label}</span>
      <div className="swatches">
        {options.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={color}
            aria-pressed={value === color}
            style={{ background: color }}
            onClick={() => onChange(color)}
          />
        ))}
        <label
          className="swatch-custom"
          title="Свой цвет"
          style={options.includes(value) ? undefined : { background: value }}
        >
          <input
            type="color"
            aria-label={`${label}: свой цвет`}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
          <Pipette size={15} />
        </label>
      </div>
    </div>
  );
}

/** Create or change a theme with a live preview; saving switches to it. */
function ThemeEditor({
  theme,
  isNew,
  onClose,
}: {
  theme: CustomTheme;
  isNew: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(theme);
  const [open, setOpen] = useState(true);
  const set = (change: Partial<CustomTheme>) =>
    setDraft((previous) => ({ ...previous, ...change }));
  const palette = swatches[draft.base];
  return (
    <Modal title={isNew ? 'Новая тема' : 'Изменить тему'} onClose={onClose} open={open}>
      <form
        className="theme-editor"
        onSubmit={(event) => {
          event.preventDefault();
          const saved = { ...draft, name: draft.name.trim() || 'Моя тема' };
          saveTheme(saved);
          chooseTheme(saved.id);
          setOpen(false);
        }}
      >
        <ThemePreview theme={draft} large />
        <label>
          Название
          <input
            value={draft.name}
            maxLength={32}
            onChange={(event) => set({ name: event.target.value })}
          />
        </label>
        <div className="segmented" role="group" aria-label="Основа темы">
          {(['light', 'dark'] as const).map((base) => (
            <button
              key={base}
              type="button"
              className={draft.base === base ? 'selected' : ''}
              onClick={() =>
                // A light wallpaper under dark text bubbles is unreadable: switch colours too.
                draft.base !== base &&
                set({
                  base,
                  accent:
                    swatches[base].accent[swatches[draft.base].accent.indexOf(draft.accent)] ??
                    swatches[base].accent[0],
                  wallpaper: swatches[base].wallpaper[0],
                  outgoing: swatches[base].outgoing[0],
                })
              }
            >
              {base === 'light' ? 'Светлая основа' : 'Тёмная основа'}
            </button>
          ))}
        </div>
        <ColorRow
          label="Акцент"
          value={draft.accent}
          options={palette.accent}
          onChange={(accent) => set({ accent })}
        />
        <ColorRow
          label="Фон чата"
          value={draft.wallpaper}
          options={palette.wallpaper}
          onChange={(wallpaper) => set({ wallpaper })}
        />
        <ColorRow
          label="Мои сообщения"
          value={draft.outgoing}
          options={palette.outgoing}
          onChange={(outgoing) => set({ outgoing })}
        />
        <div className="modal-actions">
          <CloseButton>Отмена</CloseButton>
          <button className="primary">{isNew ? 'Создать тему' : 'Сохранить'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Opened from a shared theme link: preview it and add it with one tap. */
export function ThemeImport({ theme, onClose }: { theme: CustomTheme; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <Modal title={`Тема «${theme.name}»`} onClose={onClose} open={open}>
      <ThemePreview theme={theme} large />
      <p className="muted">
        С вами поделились темой оформления. Её можно изменить или удалить в настройках.
      </p>
      <div className="modal-actions">
        <CloseButton>Не нужно</CloseButton>
        <button
          type="button"
          className="primary"
          onClick={() => {
            saveTheme(theme);
            chooseTheme(theme.id);
            setOpen(false);
          }}
        >
          Добавить и включить
        </button>
      </div>
    </Modal>
  );
}

/** Reading comfort, kept on this device: message text size, bubble rounding, what Enter does. */
type Look = { text: number; radius: number; enterSends: boolean };
const lookDefaults: Look = { text: 15, radius: 18, enterSends: true };
export function lookPrefs(): Look {
  try {
    return { ...lookDefaults, ...JSON.parse(localStorage.getItem('galinka-look') || '{}') };
  } catch {
    return lookDefaults;
  }
}
function applyLook(look = lookPrefs()) {
  const root = document.documentElement.style;
  root.setProperty('--message-size', `${look.text}px`);
  root.setProperty('--radius-bubble', `${look.radius}px`);
  root.setProperty('--radius-join', `${Math.min(6, look.radius)}px`);
}
applyLook();

export function LookSettings() {
  const [look, setLook] = useState(lookPrefs);
  const update = (change: Partial<Look>) => {
    const next = { ...look, ...change };
    setLook(next);
    applyLook(next);
    try {
      localStorage.setItem('galinka-look', JSON.stringify(next));
    } catch {
      /* Private mode: lasts for this visit. */
    }
  };
  return (
    <section className="settings-section">
      <h2>Сообщения</h2>
      <div className="look-sample" aria-hidden="true">
        <span>Так будут выглядеть сообщения</span>
        <span className="own">Удобно читать?</span>
      </div>
      <label className="range-row">
        <span>
          Размер текста <output>{look.text}</output>
        </span>
        <input
          type="range"
          min={13}
          max={20}
          value={look.text}
          onChange={(event) => update({ text: Number(event.target.value) })}
        />
      </label>
      <label className="range-row">
        <span>
          Скругление <output>{look.radius}</output>
        </span>
        <input
          type="range"
          min={6}
          max={24}
          value={look.radius}
          onChange={(event) => update({ radius: Number(event.target.value) })}
        />
      </label>
      <div className="settings-row">
        <div>
          <h3>Отправка по Enter</h3>
          <p>
            {look.enterSends
              ? 'Новая строка — Shift+Enter.'
              : 'Отправка — Ctrl+Enter, Enter переносит строку.'}
          </p>
        </div>
        <button
          className={`switch ${look.enterSends ? 'on' : ''}`}
          role="switch"
          aria-checked={look.enterSends}
          aria-label="Отправка по Enter"
          onClick={() => update({ enterSends: !look.enterSends })}
        >
          <span />
        </button>
      </div>
      {(look.text !== 15 || look.radius !== 18 || !look.enterSends) && (
        <button type="button" className="secondary" onClick={() => update(lookDefaults)}>
          Вернуть как было
        </button>
      )}
    </section>
  );
}
