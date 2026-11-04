import { useSyncExternalStore } from 'react';
import { Sparkles } from 'lucide-react';
const listeners = new Set<() => void>();
function read() {
  try {
    return localStorage.getItem('galinka-reduce-motion') === 'true';
  } catch {
    return document.documentElement.dataset.motion === 'reduced';
  }
}
function apply() {
  document.documentElement.dataset.motion = read() ? 'reduced' : 'system';
  listeners.forEach((listener) => listener());
}
window.addEventListener('storage', apply);
apply();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function MotionSettings() {
  const reduced = useSyncExternalStore(subscribe, read);
  return (
    <section className="settings-section">
      <div className="settings-row">
        <span className="settings-icon">
          <Sparkles size={22} />
        </span>
        <div>
          <h3>Меньше движения</h3>
          <p>
            Спокойные переходы без лишней анимации. Системные настройки доступности учитываются
            всегда.
          </p>
        </div>
        <button
          className={`switch ${reduced ? 'on' : ''}`}
          role="switch"
          aria-label="Уменьшить анимацию"
          aria-checked={reduced}
          onClick={() => {
            document.documentElement.dataset.motion = reduced ? 'system' : 'reduced';
            try {
              localStorage.setItem('galinka-reduce-motion', String(!reduced));
            } catch {}
            apply();
          }}
        >
          <span />
        </button>
      </div>
    </section>
  );
}
