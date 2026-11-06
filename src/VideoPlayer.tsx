import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  Maximize2,
  Minimize2,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { motionAllowed } from './ui';

const time = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
// Volume is remembered across videos, as in any player.
const savedVolume = () => {
  try {
    const value = Number(localStorage.getItem('galinka-video-volume'));
    return value > 0 && value <= 1 ? value : 1;
  } catch {
    return 1;
  }
};
const fill = (value: number) =>
  ({ '--fill': `${Math.max(0, Math.min(1, value)) * 100}%` }) as CSSProperties;

/**
 * Video in a bubble and full screen. In the bubble: one round play button and a thin progress
 * line over the picture. Tapping the picture opens it full screen — the same <video> element
 * moves into the top layer, so position and playback carry over (and survive a rotation).
 * Full screen: controls float over the picture and hide while it plays.
 */
export function VideoPlayer({
  src,
  name,
  onError,
  compact = false,
}: {
  src: string;
  name: string;
  onError?: () => void;
  compact?: boolean;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(savedVolume);
  const lastVolume = useRef(savedVolume());
  const [adjustableVolume, setAdjustableVolume] = useState(true);
  const [position, setPosition] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [idle, setIdle] = useState(false);
  const [flash, setFlash] = useState<{
    icon: 'play' | 'pause' | 'back' | 'forward';
    key: number;
  } | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastTap = useRef({ at: 0, x: 0 });

  // Smooth progress: follow the playhead every frame instead of the 4 Hz timeupdate.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const element = video.current;
      if (element) setPosition(element.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  // Full screen: controls fade out after a moment of playing without the pointer moving.
  function wake() {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), 2600);
  }
  useEffect(() => () => clearTimeout(idleTimer.current), []);
  // The remembered volume applies once; later changes go through setLevel.
  useEffect(() => {
    if (video.current) video.current.volume = lastVolume.current;
  }, []);
  // The browser's own full screen (F11-like) can be left with Esc: follow it for the icon.
  const [native, setNative] = useState(false);
  useEffect(() => {
    const follow = () => setNative(document.fullscreenElement === dialog.current);
    document.addEventListener('fullscreenchange', follow);
    return () => document.removeEventListener('fullscreenchange', follow);
  }, []);

  function togglePlayback() {
    const element = video.current!;
    // Only one video plays at a time.
    document.querySelectorAll<HTMLVideoElement>('.video-player video').forEach((other) => {
      if (other !== element) other.pause();
    });
    if (element.paused) void element.play().catch(() => setPlaying(false));
    else element.pause();
    if (fullscreen && !element.paused) setFlash({ icon: 'play', key: Date.now() });
  }
  function seekBy(seconds: number) {
    const element = video.current!;
    element.currentTime = Math.max(
      0,
      Math.min(duration || element.duration || 0, element.currentTime + seconds),
    );
    setPosition(element.currentTime);
    setFlash({ icon: seconds < 0 ? 'back' : 'forward', key: Date.now() });
  }
  function setLevel(level: number) {
    const element = video.current!;
    const value = Math.max(0, Math.min(1, level));
    try {
      element.volume = value;
    } catch {
      setAdjustableVolume(false);
      return;
    }
    // iOS ignores volume from script: the hardware buttons own it there.
    if (Math.abs(element.volume - value) > 0.01) {
      setAdjustableVolume(false);
      return;
    }
    if (value > 0) {
      lastVolume.current = value;
      try {
        localStorage.setItem('galinka-video-volume', String(value));
      } catch {
        /* Private mode: not remembered. */
      }
    }
    element.muted = value === 0;
  }
  function toggleMute() {
    const element = video.current!;
    if (element.muted || !element.volume) {
      if (!element.volume) element.volume = lastVolume.current;
      element.muted = false;
    } else element.muted = true;
  }
  function toggleFullscreen() {
    const player = dialog.current!;
    const container = slot.current!;
    if (fullscreen) {
      // Leave with a short fade, then hand the same element back to the bubble.
      setLeaving(true);
      setTimeout(
        () => {
          player.close();
          player.show();
          container.style.minHeight = '';
          setLeaving(false);
          setFullscreen(false);
        },
        motionAllowed() ? 170 : 0,
      );
      return;
    }
    // Keep the bubble's place while the player is away, so the conversation does not jump.
    container.style.minHeight = `${player.offsetHeight}px`;
    player.close();
    player.showModal();
    setFullscreen(true);
    wake();
  }

  const volumeLevel = muted ? 0 : volume;
  const VolumeIcon = volumeLevel === 0 ? VolumeX : volumeLevel < 0.5 ? Volume1 : Volume2;
  const progress = (
    <input
      type="range"
      aria-label="Позиция видео"
      aria-valuetext={`${time(position)} из ${time(duration)}`}
      className="video-progress"
      style={
        {
          ...fill(duration ? position / duration : 0),
          '--buffered': `${duration ? (buffered / duration) * 100 : 0}%`,
        } as CSSProperties
      }
      min={0}
      max={duration || 1}
      step={0.01}
      value={Math.min(position, duration)}
      disabled={!duration}
      onChange={(event) => {
        const value = event.currentTarget.valueAsNumber;
        video.current!.currentTime = value;
        setPosition(value);
      }}
    />
  );

  return (
    <div ref={slot} className={`video-player-slot${compact ? ' compact' : ''}`}>
      <dialog
        open
        ref={dialog}
        className={`video-player${compact ? ' compact' : ''}${playing ? ' playing' : ''}${
          fullscreen && idle && playing ? ' idle' : ''
        }${leaving ? ' leaving' : ''}`}
        role={fullscreen ? 'dialog' : 'group'}
        aria-label={`Видео ${name}`}
        onCancel={(event) => {
          event.preventDefault();
          if (fullscreen) toggleFullscreen();
        }}
        onPointerMove={fullscreen ? wake : undefined}
        onKeyDown={(event) => {
          if (!fullscreen || event.target instanceof HTMLSelectElement) return;
          wake();
          const actions: Record<string, () => void> = {
            ' ': togglePlayback,
            k: togglePlayback,
            ArrowLeft: () => seekBy(-5),
            ArrowRight: () => seekBy(5),
            ArrowUp: () => setLevel(volumeLevel + 0.1),
            ArrowDown: () => setLevel(volumeLevel - 0.1),
            m: toggleMute,
            f: toggleFullscreen,
          };
          // Sliders keep their own arrow keys.
          if (event.target instanceof HTMLInputElement && event.key.startsWith('Arrow')) return;
          const action = actions[event.key];
          if (!action) return;
          event.preventDefault();
          action();
        }}
      >
        <button
          type="button"
          className="video-stage"
          aria-label={fullscreen ? 'Переключить воспроизведение видео' : 'Открыть видео'}
          onClick={(event) => {
            if (!fullscreen) {
              toggleFullscreen();
              return;
            }
            // Touch: a double tap on the left or right third skips back or forward.
            const box = event.currentTarget.getBoundingClientRect();
            const third = (event.clientX - box.left) / box.width;
            const now = Date.now();
            const twice = now - lastTap.current.at < 300;
            lastTap.current = { at: now, x: third };
            if (twice && (third < 0.33 || third > 0.67)) {
              seekBy(third < 0.33 ? -10 : 10);
              return;
            }
            togglePlayback();
          }}
          onDoubleClick={(event) => {
            if (fullscreen && matchMedia('(pointer: fine)').matches) {
              event.preventDefault();
              const target = dialog.current!;
              if (document.fullscreenElement) void document.exitFullscreen();
              else void target.requestFullscreen?.().catch(() => {});
            }
          }}
        >
          <video
            ref={video}
            src={src}
            playsInline
            preload="metadata"
            aria-label={`Видео ${name}`}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onVolumeChange={(event) => {
              setMuted(event.currentTarget.muted);
              setVolume(event.currentTarget.volume);
            }}
            onRateChange={(event) => setSpeed(event.currentTarget.playbackRate)}
            onEnded={() => setPlaying(false)}
            onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
            onProgress={(event) => {
              const ranges = event.currentTarget.buffered;
              if (ranges.length) setBuffered(ranges.end(ranges.length - 1));
            }}
            onDurationChange={(event) => {
              const value = event.currentTarget.duration;
              setDuration(Number.isFinite(value) ? value : 0);
            }}
            onError={onError}
          />
          {flash && fullscreen && (
            <span key={flash.key} className="video-flash" aria-hidden="true">
              {flash.icon === 'play' ? (
                <Play size={30} fill="currentColor" />
              ) : flash.icon === 'pause' ? (
                <Pause size={30} fill="currentColor" />
              ) : flash.icon === 'back' ? (
                <RotateCcw size={28} />
              ) : (
                <RotateCw size={28} />
              )}
            </span>
          )}
        </button>

        {!fullscreen ? (
          // In the bubble: the play button and the progress line, nothing else.
          <div className="video-inline">
            <button
              type="button"
              className="video-big-play"
              onClick={togglePlayback}
              aria-label={playing ? 'Пауза' : 'Воспроизвести видео'}
            >
              {playing ? (
                <Pause size={22} fill="currentColor" />
              ) : (
                <Play size={22} fill="currentColor" />
              )}
            </button>
            <span className="video-time-pill">
              {duration
                ? time(playing || position ? Math.max(0, duration - position) : duration)
                : '–:––'}
            </span>
            {progress}
          </div>
        ) : (
          <>
            <div className="video-viewer-head">
              <span title={name}>{name}</span>
              <button
                type="button"
                className="icon-button"
                onClick={toggleFullscreen}
                aria-label="Выйти из полноэкранного режима"
              >
                <X size={22} />
              </button>
            </div>
            {!playing && (
              <button
                type="button"
                className="video-center-play"
                onClick={togglePlayback}
                aria-label="Воспроизвести видео"
              >
                <Play size={34} fill="currentColor" />
              </button>
            )}
            <div className="video-controls">
              <div className="video-seek">
                <span>{time(position)}</span>
                {progress}
                <span>{time(duration)}</span>
              </div>
              <div className="video-buttons">
                <button
                  type="button"
                  className="video-control"
                  onClick={togglePlayback}
                  aria-label={playing ? 'Пауза' : 'Воспроизвести'}
                >
                  {playing ? (
                    <Pause size={20} fill="currentColor" />
                  ) : (
                    <Play size={20} fill="currentColor" />
                  )}
                </button>
                <button
                  type="button"
                  className="video-control"
                  onClick={() => seekBy(-10)}
                  aria-label="Назад на 10 секунд"
                >
                  <RotateCcw size={19} />
                </button>
                <button
                  type="button"
                  className="video-control"
                  onClick={() => seekBy(10)}
                  aria-label="Вперёд на 10 секунд"
                >
                  <RotateCw size={19} />
                </button>
                {/* Volume grows out of its button on hover or focus; the wheel turns it too. */}
                <div
                  className="video-volume-group"
                  onWheel={(event) => {
                    if (!adjustableVolume) return;
                    event.preventDefault();
                    setLevel(volumeLevel - Math.sign(event.deltaY) * 0.05);
                  }}
                >
                  <button
                    type="button"
                    className="video-control"
                    onClick={toggleMute}
                    aria-label={volumeLevel === 0 ? 'Включить звук' : 'Выключить звук'}
                  >
                    <VolumeIcon size={20} />
                  </button>
                  {adjustableVolume && (
                    <input
                      type="range"
                      className="video-volume"
                      aria-label="Громкость видео"
                      style={fill(volumeLevel)}
                      min={0}
                      max={100}
                      value={Math.round(volumeLevel * 100)}
                      onChange={(event) => setLevel(event.currentTarget.valueAsNumber / 100)}
                    />
                  )}
                </div>
                <span className="video-spacer" />
                <label className="video-speed">
                  <select
                    aria-label="Скорость видео"
                    value={speed}
                    onChange={(event) => {
                      video.current!.playbackRate = Number(event.currentTarget.value);
                    }}
                  >
                    {speeds.map((value) => (
                      <option key={value} value={value}>
                        {value}×
                      </option>
                    ))}
                  </select>
                </label>
                {'pictureInPictureEnabled' in document && document.pictureInPictureEnabled && (
                  <button
                    type="button"
                    className="video-control"
                    aria-label="Картинка в картинке"
                    onClick={() => void video.current?.requestPictureInPicture().catch(() => {})}
                  >
                    <PictureInPicture2 size={19} />
                  </button>
                )}
                {document.fullscreenEnabled && (
                  <button
                    type="button"
                    className="video-control"
                    aria-label={native ? 'Свернуть из полного экрана' : 'Во весь экран'}
                    onClick={() => {
                      if (native) void document.exitFullscreen();
                      else void dialog.current?.requestFullscreen().catch(() => {});
                    }}
                  >
                    {native ? <Minimize2 size={19} /> : <Maximize2 size={19} />}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
