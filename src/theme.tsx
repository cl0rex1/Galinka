import { useSyncExternalStore } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';

type Theme = 'light' | 'dark' | 'system';
const media = matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();
let fallback: Theme = 'system';
function read(): Theme {
  try {
    const value = localStorage.getItem('galinka-theme');
    if (value === 'light' || value === 'dark' || value === 'system') return value;
    return 'system';
  } catch {
    /* Storage may be unavailable in private mode. */
  }
  return fallback;
}
function apply() {
  const theme = read();
  const dark = theme === 'dark' || (theme === 'system' && media.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#111817' : '#f5f7f6');
  listeners.forEach((listener) => listener());
}
media.addEventListener('change', apply);
window.addEventListener('storage', apply);
apply();
function setTheme(value: Theme) {
  fallback = value;
  try {
    localStorage.setItem('galinka-theme', value);
  } catch {
    /* Apply for this visit. */
  }
  apply();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function ThemePicker() {
  const theme = useSyncExternalStore(subscribe, read);
  return (
    <div className="theme-picker" role="group" aria-label="Тема оформления">
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
          onClick={() => setTheme(value)}
        >
          <span className={`theme-preview preview-${value}`}>
            <i />
            <i />
            <b />
          </span>
          <span>
            <Icon size={16} />
            {label}
            {theme === value && <span className="theme-check">✓</span>}
          </span>
        </button>
      ))}
    </div>
  );
}
export function ThemeToggle() {
  useSyncExternalStore(subscribe, () => `${read()}:${media.matches}`);
  const dark = document.documentElement.dataset.theme === 'dark';
  return (
    <button
      className="icon-button theme-toggle"
      aria-label={dark ? 'Включить светлую тему' : 'Включить тёмную тему'}
      title="Сменить тему"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      {dark ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  );
}
