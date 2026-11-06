import { useSyncExternalStore } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';

type Mode = 'light' | 'dark' | 'system';
/** A colour theme: a light or dark base plus accent, chat wallpaper and own-bubble colours. */
export type CustomTheme = {
  id: string;
  name: string;
  base: 'light' | 'dark';
  accent: string;
  wallpaper: string;
  outgoing: string;
};
/** Built-in themes. «Калина» is the standard look and follows the light/dark/system mode. */
export const presets: CustomTheme[] = [
  {
    id: 'sea',
    name: 'Море',
    base: 'light',
    accent: '#2468b0',
    wallpaper: '#dce7ef',
    outgoing: '#d3e6fb',
  },
  {
    id: 'forest',
    name: 'Лес',
    base: 'light',
    accent: '#2c7a4b',
    wallpaper: '#e1e9dc',
    outgoing: '#d8eed3',
  },
  {
    id: 'lilac',
    name: 'Сирень',
    base: 'light',
    accent: '#7446b4',
    wallpaper: '#e9e3f1',
    outgoing: '#e6dafa',
  },
  {
    id: 'night',
    name: 'Ночь',
    base: 'dark',
    accent: '#7aa7ff',
    wallpaper: '#0c1118',
    outgoing: '#1d3558',
  },
  {
    id: 'coal',
    name: 'Уголь',
    base: 'dark',
    accent: '#f2a541',
    wallpaper: '#111111',
    outgoing: '#3b2b14',
  },
];

const media = matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();
let fallback: Mode = 'system';
let fallbackTheme = '';
function storage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Private mode: lasts for this visit. */
  }
}
function read(): Mode {
  const value = storage('galinka-theme');
  return value === 'light' || value === 'dark' || value === 'system' ? value : fallback;
}
let ownCache: { raw: string | null; list: CustomTheme[] } = { raw: null, list: [] };
/** Themes the user made or imported, newest first. */
export function ownThemes(): CustomTheme[] {
  const raw = storage('galinka-themes');
  if (raw !== ownCache.raw) {
    let list: CustomTheme[] = [];
    try {
      const parsed = JSON.parse(raw || '[]');
      if (Array.isArray(parsed)) list = parsed.filter(valid).slice(0, 30);
    } catch {
      /* Broken storage: start over. */
    }
    ownCache = { raw, list };
  }
  return ownCache.list;
}
const hex = /^#[0-9a-f]{6}$/i;
function valid(theme: unknown): theme is CustomTheme {
  const t = theme as CustomTheme;
  return Boolean(
    t &&
    typeof t.id === 'string' &&
    typeof t.name === 'string' &&
    (t.base === 'light' || t.base === 'dark') &&
    [t.accent, t.wallpaper, t.outgoing].every((color) => hex.test(color)),
  );
}
export function selectedTheme(): string {
  return storage('galinka-custom-theme') ?? fallbackTheme;
}
export const findTheme = (id: string) => [...presets, ...ownThemes()].find((t) => t.id === id);

// Relative luminance decides whether text on a colour should be dark or white.
function luminance(color: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(color.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const inkOn = (color: string) => (luminance(color) > 0.36 ? '#19191a' : '#ffffff');

/** CSS custom properties that turn the standard palette into `theme`. */
export function themeVars(theme: CustomTheme): Record<string, string> {
  const dark = theme.base === 'dark';
  const outgoingInk = inkOn(theme.outgoing);
  return {
    '--color-accent': theme.accent,
    '--color-accent-hover': `color-mix(in srgb, ${theme.accent} 86%, ${dark ? '#fff' : '#000'})`,
    '--color-accent-ink': inkOn(theme.accent),
    '--color-accent-soft': `color-mix(in srgb, ${theme.accent} ${dark ? 22 : 13}%, var(--color-surface))`,
    '--color-selected': dark
      ? `color-mix(in srgb, ${theme.accent} 42%, var(--color-surface))`
      : theme.accent,
    '--color-selected-ink': dark ? '#ffffff' : inkOn(theme.accent),
    '--color-focus': theme.accent,
    '--color-receipt': dark ? theme.accent : `color-mix(in srgb, ${theme.accent} 80%, #000)`,
    '--color-quote': `color-mix(in srgb, ${theme.accent} 13%, transparent)`,
    '--color-selection-rule': `color-mix(in srgb, ${theme.accent} 45%, var(--color-surface))`,
    '--color-conversation': theme.wallpaper,
    '--color-outgoing': theme.outgoing,
    '--color-outgoing-ink': outgoingInk,
    '--color-outgoing-meta': `color-mix(in srgb, ${outgoingInk} 55%, ${theme.outgoing})`,
  };
}
const varNames = Object.keys(themeVars(presets[0]));

function apply() {
  const custom = findTheme(selectedTheme());
  const mode = read();
  const dark = custom
    ? custom.base === 'dark'
    : mode === 'dark' || (mode === 'system' && media.matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  varNames.forEach((name) => root.style.removeProperty(name));
  if (custom)
    Object.entries(themeVars(custom)).forEach(([name, value]) =>
      root.style.setProperty(name, value),
    );
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#18191b' : '#ffffff');
  listeners.forEach((listener) => listener());
}
media.addEventListener('change', apply);
window.addEventListener('storage', apply);
apply();

/** Standard theme in a given mode; picking a mode leaves a custom theme. */
function setMode(value: Mode) {
  fallback = value;
  fallbackTheme = '';
  store('galinka-theme', value);
  store('galinka-custom-theme', '');
  apply();
}
export function chooseTheme(theme: string) {
  fallbackTheme = theme;
  store('galinka-custom-theme', theme);
  apply();
}
export function saveTheme(theme: CustomTheme) {
  store(
    'galinka-themes',
    JSON.stringify([theme, ...ownThemes().filter((item) => item.id !== theme.id)]),
  );
  apply();
}
export function deleteTheme(id: string) {
  store('galinka-themes', JSON.stringify(ownThemes().filter((item) => item.id !== id)));
  if (selectedTheme() === id) store('galinka-custom-theme', '');
  apply();
}
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
/** Re-render on any theme change: mode, chosen theme, own themes. */
export const useThemeState = () =>
  useSyncExternalStore(
    subscribe,
    () => `${read()}|${selectedTheme()}|${storage('galinka-themes')}`,
  );

// A theme travels in a link as base64url JSON: short enough for a QR code, no server needed.
export function encodeTheme(theme: CustomTheme) {
  const json = JSON.stringify([
    theme.name,
    theme.base,
    theme.accent,
    theme.wallpaper,
    theme.outgoing,
  ]);
  const bytes = new TextEncoder().encode(json);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
export function decodeTheme(code: string): CustomTheme | null {
  try {
    const binary = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
    const [name, base, accent, wallpaper, outgoing] = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))),
    );
    const theme = {
      id: crypto.randomUUID(),
      name: String(name).slice(0, 32) || 'Тема',
      base,
      accent,
      wallpaper,
      outgoing,
    };
    return valid(theme) ? theme : null;
  } catch {
    return null;
  }
}

export function ThemePicker() {
  useThemeState();
  const theme = selectedTheme() && findTheme(selectedTheme()) ? null : read();
  return (
    <div className="theme-picker" role="group" aria-label="Режим стандартной темы">
      {(
        [
          ['light', 'Светлая', Sun],
          ['dark', 'Тёмная', Moon],
          ['system', 'Системная', Monitor],
        ] as const
      ).map(([value, label, Icon]) => (
        <button
          key={value}
          type="button"
          aria-pressed={theme === value}
          onClick={() => setMode(value)}
        >
          <Icon size={16} />
          {label}
        </button>
      ))}
    </div>
  );
}
export function ThemeToggle() {
  useSyncExternalStore(subscribe, () => `${read()}:${media.matches}:${selectedTheme()}`);
  const dark = document.documentElement.dataset.theme === 'dark';
  return (
    <button
      className="icon-button theme-toggle"
      aria-label={dark ? 'Включить светлую тему' : 'Включить тёмную тему'}
      title="Сменить тему"
      onClick={() => setMode(dark ? 'light' : 'dark')}
    >
      {dark ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  );
}
