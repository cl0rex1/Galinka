import { useEffect, useState } from 'react';
import { Pause, Play, X } from 'lucide-react';
import { setNowPlaying, useNowPlaying } from './nowPlaying';

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/** A bar above the chat while a voice message or round video plays: pause, time, close. */
export function MiniPlayer() {
  const now = useNowPlaying();
  const [, setTick] = useState(0);
  useEffect(() => {
    const element = now?.element;
    if (!element) return;
    const update = () => setTick((value) => value + 1);
    const events = ['play', 'pause', 'timeupdate', 'durationchange'];
    events.forEach((name) => element.addEventListener(name, update));
    return () => events.forEach((name) => element.removeEventListener(name, update));
  }, [now?.element]);
  if (!now || !now.element.isConnected) return null;
  const { element, label } = now;
  const duration = Number.isFinite(element.duration) ? element.duration : 0;
  return (
    <div className="mini-player" role="region" aria-label="Сейчас играет">
      <button
        type="button"
        className="icon-button"
        aria-label={element.paused ? 'Продолжить' : 'Пауза'}
        onClick={() => (element.paused ? void element.play().catch(() => {}) : element.pause())}
      >
        {element.paused ? <Play size={18} /> : <Pause size={18} />}
      </button>
      <button
        type="button"
        className="mini-player-title"
        onClick={() =>
          element
            .closest('[data-sequence-item]')
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }
      >
        <strong>{label}</strong>
        <span>
          {clock(element.currentTime)}
          {duration ? ` / ${clock(duration)}` : ''}
        </span>
      </button>
      <progress value={duration ? element.currentTime : 0} max={duration || 1} aria-hidden="true" />
      <button
        type="button"
        className="icon-button"
        aria-label="Закрыть плеер"
        onClick={() => {
          element.pause();
          setNowPlaying(null);
        }}
      >
        <X size={18} />
      </button>
    </div>
  );
}
