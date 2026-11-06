import { useEffect, useRef, useState } from 'react';
import { Play, Pause, LoaderCircle, RotateCcw, Download } from 'lucide-react';

const maxBytes = 20 * 1024 * 1024;
const playbackEvent = 'galinka:voice-play';
const durationLabel = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
function savedSpeed() {
  try {
    const value = Number(localStorage.getItem('galinka-voice-speed'));
    return [1, 1.5, 2].includes(value) ? value : 1;
  } catch {
    return 1;
  }
}

export function AudioPlayer({
  src,
  name = 'Голосовое сообщение',
  size,
  mime,
  compact = false,
  onDownload,
}: {
  src: string;
  name?: string;
  size?: number;
  mime?: string;
  compact?: boolean;
  onDownload?: () => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const resource = useRef<{
    src: string;
    intent: number;
    url?: string;
    owned?: boolean;
    controller?: AbortController;
  }>({ src, intent: 0 });
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'playing' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [speed, setSpeed] = useState(savedSpeed);
  const [error, setError] = useState('');
  const [needsTap, setNeedsTap] = useState(false);
  const source = resource.current;

  useEffect(() => {
    const current = { src, intent: 0 } as typeof resource.current;
    resource.current = current;
    setPhase('idle');
    setDuration(0);
    setPosition(0);
    setError('');
    setProgress(0);
    setNeedsTap(false);
    const element = audio.current!;
    if (src.startsWith('blob:')) {
      current.url = src;
      element.src = src;
      element.load();
    }
    const pauseOther = (event: Event) => {
      if ((event as CustomEvent).detail !== element) {
        current.intent++;
        current.controller?.abort();
        element.pause();
      }
    };
    window.addEventListener(playbackEvent, pauseOther);
    return () => {
      current.controller?.abort();
      current.intent++;
      element.pause();
      element.removeAttribute('src');
      element.load();
      if (current.owned && current.url) URL.revokeObjectURL(current.url);
      window.removeEventListener(playbackEvent, pauseOther);
    };
  }, [src]);

  function updateDuration() {
    const element = audio.current!;
    if (Number.isFinite(element.duration) && element.duration > 0) setDuration(element.duration);
    if (element.readyState >= 1)
      setPhase((previous) => (previous === 'playing' ? previous : 'ready'));
  }

  async function load(current: typeof source) {
    const controller = new AbortController();
    current.controller?.abort();
    current.controller = controller;
    const timeout = setTimeout(() => controller.abort('timeout'), 90_000);
    setPhase('loading');
    setError('');
    setNeedsTap(false);
    setProgress(0);
    try {
      // Fetch credentials explicitly: native WebView media loading does not always
      // follow the same cookie/interception path as authenticated API requests.
      const response = await fetch(src, {
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok)
        throw Error(
          response.status === 401
            ? 'Войдите снова, чтобы прослушать голосовое.'
            : response.status === 404 || response.status === 403
              ? 'Голосовое недоступно. Возможно, оно удалено или у вас больше нет доступа к чату.'
              : 'Не удалось загрузить голосовое. Попробуйте ещё раз.',
        );
      const contentType = (response.headers.get('content-type') || mime || '').split(';')[0];
      if (!/^audio\/(mp4|webm|ogg|mpeg|wav|x-wav|flac|aac)$/.test(contentType))
        throw Error('Сервер вернул неподдерживаемый аудиофайл. Его можно скачать отдельно.');
      const length = Number(response.headers.get('content-length')) || size || 0;
      if (length > maxBytes) throw Error('Голосовое превышает допустимые 20 МБ.');
      const reader = response.body?.getReader();
      let blob: Blob;
      if (reader) {
        const chunks: ArrayBuffer[] = [];
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > maxBytes) {
            await reader.cancel();
            throw Error('Голосовое превышает допустимые 20 МБ.');
          }
          chunks.push(
            value.buffer.slice(
              value.byteOffset,
              value.byteOffset + value.byteLength,
            ) as ArrayBuffer,
          );
          if (resource.current === current && length)
            setProgress(Math.min(99, Math.round((received / length) * 100)));
        }
        blob = new Blob(chunks, { type: contentType });
      } else blob = new Blob([await response.arrayBuffer()], { type: contentType });
      if (!blob.size || blob.size > maxBytes)
        throw Error('Аудиофайл пуст или повреждён. Попробуйте загрузить его ещё раз.');
      if (controller.signal.aborted || resource.current !== current) return false;
      if (current.owned && current.url) URL.revokeObjectURL(current.url);
      current.url = URL.createObjectURL(blob);
      current.owned = true;
      audio.current!.src = current.url;
      audio.current!.load();
      setProgress(100);
      return true;
    } catch (failure) {
      if (resource.current !== current || current.controller !== controller) return false;
      if (controller.signal.aborted && controller.signal.reason !== 'timeout') {
        setPhase('idle');
        return false;
      }
      setError(
        controller.signal.reason === 'timeout'
          ? 'Загрузка занимает слишком много времени. Проверьте интернет и повторите попытку.'
          : failure instanceof TypeError
            ? 'Нет соединения. Проверьте интернет и повторите попытку.'
            : (failure as Error).message,
      );
      setPhase('error');
      return false;
    } finally {
      clearTimeout(timeout);
      if (current.controller === controller) current.controller = undefined;
    }
  }

  async function toggle() {
    const current = resource.current;
    const element = audio.current!;
    if (phase === 'loading' && current.controller) {
      current.intent++;
      current.controller.abort();
      return;
    }
    if (!element.paused) {
      current.intent++;
      element.pause();
      return;
    }
    const intent = ++current.intent;
    // Select exclusively before fetching. A slow earlier download must never
    // interrupt a voice that the listener selected more recently.
    window.dispatchEvent(new CustomEvent(playbackEvent, { detail: element }));
    if ((!current.url || phase === 'error') && !(await load(current))) return;
    if (resource.current !== current || current.intent !== intent) return;
    try {
      const playbackSpeed = savedSpeed();
      setSpeed(playbackSpeed);
      element.playbackRate = playbackSpeed;
      await element.play();
    } catch (failure) {
      if (resource.current !== current || current.intent !== intent) return;
      if ((failure as Error).name === 'NotAllowedError') {
        // Safari can require another tap after an asynchronous first download.
        setPhase('ready');
        setNeedsTap(true);
      } else {
        setError('Не удалось воспроизвести запись. Попробуйте ещё раз или скачайте файл.');
        setPhase('error');
      }
    }
  }
  const label =
    phase === 'loading'
      ? 'Отменить загрузку голосового'
      : phase === 'playing'
        ? 'Приостановить голосовое'
        : phase === 'error'
          ? 'Повторить загрузку голосового'
          : 'Воспроизвести голосовое';
  return (
    <div
      className={`voice-player ${compact ? 'voice-player-compact' : ''}`}
      data-state={phase}
      aria-label={name}
    >
      <audio
        ref={audio}
        preload="metadata"
        aria-label={`Аудиосообщение ${name}`}
        onLoadedMetadata={updateDuration}
        onDurationChange={updateDuration}
        onPlay={() => {
          if (audio.current?.paused) return;
          setPhase('playing');
          setError('');
          setNeedsTap(false);
        }}
        onPause={() => setPhase((previous) => (previous === 'playing' ? 'ready' : previous))}
        onTimeUpdate={() => setPosition(audio.current?.currentTime || 0)}
        onEnded={() => {
          setPhase('ready');
          setPosition(0);
          if (audio.current) audio.current.currentTime = 0;
        }}
        onError={() => {
          if (audio.current?.getAttribute('src')) {
            setError('Не удалось прочитать аудио. Повторите загрузку или скачайте файл.');
            setPhase('error');
          }
        }}
      />
      <div className="voice-player-main">
        <button
          type="button"
          className="voice-play"
          aria-label={label}
          onClick={() => void toggle()}
        >
          {phase === 'loading' ? (
            <LoaderCircle size={22} className="spin" />
          ) : phase === 'playing' ? (
            <Pause size={22} />
          ) : phase === 'error' ? (
            <RotateCcw size={21} />
          ) : (
            <Play size={22} />
          )}
        </button>
        <div className="voice-player-track">
          <input
            className="voice-timeline"
            type="range"
            min="0"
            max={duration || 1}
            step="0.1"
            value={Math.min(position, duration || 0)}
            aria-label="Позиция голосового сообщения"
            aria-valuetext={`${durationLabel(position)} из ${durationLabel(duration)}`}
            disabled={!duration || phase === 'loading' || phase === 'error'}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (audio.current) audio.current.currentTime = value;
              setPosition(value);
            }}
          />
          <div className="voice-player-meta">
            <time className="voice-time">
              {duration
                ? `${durationLabel(position)} / ${durationLabel(duration)}`
                : position
                  ? durationLabel(position)
                  : '—:—'}
            </time>
            <span className="voice-status" role={phase === 'loading' ? 'status' : undefined}>
              {phase === 'loading'
                ? `Загрузка${progress ? ` ${progress}%` : '…'}`
                : phase === 'idle'
                  ? 'Голосовое'
                  : phase === 'error'
                    ? 'Не загружено'
                    : needsTap
                      ? 'Нажмите ▶'
                      : 'Голосовое'}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="voice-speed"
          aria-label={`Скорость воспроизведения ${speed}×`}
          onClick={() => {
            const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
            setSpeed(next);
            if (audio.current) audio.current.playbackRate = next;
            try {
              localStorage.setItem('galinka-voice-speed', String(next));
            } catch {}
          }}
        >
          {speed}×
        </button>
        {/* Normally download lives in the message menu; offered here when playback fails. */}
        {onDownload && phase === 'error' && (
          <button
            type="button"
            className="voice-download"
            aria-label="Скачать голосовое"
            title={name}
            onClick={onDownload}
          >
            <Download size={18} />
          </button>
        )}
      </div>
      {error && (
        <p className="voice-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
