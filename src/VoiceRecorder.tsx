import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Mic, Pause, Play, Square, X, LoaderCircle } from 'lucide-react';
import { audioConstraints } from './media';

type Recording = {
  generation: number;
  recorder?: MediaRecorder;
  stream?: MediaStream;
  timer?: ReturnType<typeof setInterval>;
  stopTimer?: ReturnType<typeof setTimeout>;
  discard: boolean;
  /** Recorded by holding the button: released, it is sent at once. */
  sendNow?: boolean;
  /** Milliseconds recorded before the current run, and when that run began (null: paused). */
  recorded: number;
  since: number | null;
  audio?: AudioContext;
};
const maxSeconds = 300;
const maxBytes = 20 * 1024 * 1024;
/** Held this long, the button records until released. */
const holdMs = 400;
const shownLevels = 32;
const elapsedMs = (session: Recording) =>
  session.recorded + (session.since === null ? 0 : Date.now() - session.since);

export function VoiceRecorder({
  onRecorded,
  onError,
  onActive,
  disabled = false,
}: {
  onRecorded: (file: File, sendNow?: boolean) => void;
  onError: (error: string) => void;
  /** Called a few times a second while recording (for the "recording…" status). */
  onActive?: () => void;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<'idle' | 'permission' | 'recording' | 'finishing'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [paused, setPaused] = useState(false);
  const [holding, setHolding] = useState(false);
  /** Loudness of the last moments, 0..1, newest last. */
  const [levels, setLevels] = useState<number[]>([]);
  const current = useRef<Recording | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const callbacks = useRef({ onRecorded, onError, onActive });
  callbacks.current = { onRecorded, onError, onActive };

  function finish(discard: boolean, sendNow = false) {
    const session = current.current;
    if (!session) return;
    session.discard ||= discard;
    session.sendNow = sendNow;
    clearInterval(session.timer);
    void session.audio?.close().catch(() => {});
    if (alive.current) setHolding(false);
    if (session.recorder && session.recorder.state !== 'inactive') {
      if (alive.current) setPhase('finishing');
      session.recorder.stop();
      // Let the encoder flush its final chunk before releasing a successful
      // recording. Always release the microphone if a browser misses onstop.
      session.stopTimer = setTimeout(() => {
        session.stream?.getTracks().forEach((track) => track.stop());
        if (current.current !== session) return;
        current.current = null;
        if (alive.current) {
          setPhase('idle');
          if (!session.discard)
            callbacks.current.onError('Не удалось завершить запись. Попробуйте ещё раз.');
        }
      }, 5000);
    } else if (!session.recorder) {
      current.current = null;
      if (alive.current) setPhase('idle');
    }
    if (session.discard) session.stream?.getTracks().forEach((track) => track.stop());
  }
  useEffect(() => {
    alive.current = true;
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && current.current) {
        finish(true);
        callbacks.current.onError('Запись отменена при уходе из приложения.');
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      alive.current = false;
      finish(true);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, []);

  function togglePause() {
    const session = current.current;
    const recorder = session?.recorder;
    if (!session || !recorder || typeof recorder.pause !== 'function') return;
    if (recorder.state === 'recording') {
      recorder.pause();
      session.recorded = elapsedMs(session);
      session.since = null;
      setPaused(true);
    } else if (recorder.state === 'paused') {
      recorder.resume();
      session.since = Date.now();
      setPaused(false);
    }
  }

  /** Shows how loud the microphone is while recording; silent where Web Audio is missing. */
  function listen(session: Recording, stream: MediaStream) {
    try {
      const audio = new AudioContext();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 512;
      audio.createMediaStreamSource(stream).connect(analyser);
      session.audio = audio;
      const samples = new Uint8Array(analyser.fftSize);
      return () => {
        analyser.getByteTimeDomainData(samples);
        let peak = 0;
        for (const value of samples) peak = Math.max(peak, Math.abs(value - 128));
        return Math.min(1, (peak / 128) * 1.6);
      };
    } catch {
      return () => 0;
    }
  }

  async function start(held = false) {
    if (disabled || current.current) return;
    if (
      !window.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      onError(
        'Запись недоступна в этом браузере. Откройте Galinka по HTTPS или прикрепите аудиофайл.',
      );
      return;
    }
    const session: Recording = {
      generation: ++generation.current,
      discard: false,
      recorded: 0,
      since: null,
    };
    current.current = session;
    setPhase('permission');
    setSeconds(0);
    setPaused(false);
    setLevels([]);
    setHolding(held);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints(),
      });
      session.stream = stream;
      if (!alive.current || current.current !== session || session.discard) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      // A codec can be advertised yet unavailable to the actual device encoder.
      // Try recording, not only isTypeSupported, before choosing the format.
      const candidates: (string | undefined)[] = [
        'audio/mp4;codecs=mp4a.40.2',
        'audio/mp4',
        'audio/webm;codecs=opus',
        'audio/ogg;codecs=opus',
      ].filter((type) => MediaRecorder.isTypeSupported(type));
      candidates.push(undefined);
      let recorder: MediaRecorder | undefined;
      for (const mime of candidates) {
        try {
          const candidate = new MediaRecorder(stream, {
            ...(mime ? { mimeType: mime } : {}),
            audioBitsPerSecond: 64000,
          });
          candidate.start(1000);
          recorder = candidate;
          break;
        } catch {
          /* Fall back to the next real encoder without closing the stream. */
        }
      }
      if (!recorder) throw new DOMException('No working audio encoder', 'NotSupportedError');
      session.recorder = recorder;
      session.since = Date.now();
      const level = listen(session, stream);
      const chunks: Blob[] = [];
      let bytes = 0;
      recorder.ondataavailable = (event) => {
        if (event.data.size) {
          bytes += event.data.size;
          chunks.push(event.data);
        }
        if (bytes > maxBytes && !session.discard && current.current === session) {
          finish(true);
          if (alive.current) callbacks.current.onError('Запись слишком большая. Максимум — 20 МБ.');
        }
      };
      recorder.onerror = () => {
        if (current.current !== session) return;
        finish(true);
        if (alive.current)
          callbacks.current.onError(
            'Не удалось записать голос. Проверьте микрофон и попробуйте снова.',
          );
      };
      recorder.onstop = () => {
        clearInterval(session.timer);
        clearTimeout(session.stopTimer);
        stream.getTracks().forEach((track) => track.stop());
        if (current.current !== session) return;
        current.current = null;
        if (!alive.current) return;
        setPhase('idle');
        setPaused(false);
        if (session.discard) return;
        const type = (recorder.mimeType || chunks[0]?.type || '').split(';')[0];
        const blob = new Blob(chunks, { type });
        if (!blob.size || blob.size > maxBytes) {
          callbacks.current.onError('Запись не получилась. Попробуйте ещё раз.');
          return;
        }
        if (session.sendNow && elapsedMs(session) < 700) {
          callbacks.current.onError('Слишком короткое голосовое. Удерживайте кнопку, пока говорите.');
          return;
        }
        const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        callbacks.current.onRecorded(
          new File(
            [blob],
            `Голосовое-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`,
            { type },
          ),
          session.sendNow,
        );
      };
      setPhase('recording');
      session.timer = setInterval(() => {
        const elapsed = Math.floor(elapsedMs(session) / 1000);
        setSeconds(elapsed);
        if (session.since === null) return;
        setLevels((previous) => [...previous.slice(1 - shownLevels), level()]);
        callbacks.current.onActive?.();
        if (elapsed >= maxSeconds) finish(false);
      }, 100);
    } catch (error) {
      session.stream?.getTracks().forEach((track) => track.stop());
      if (!alive.current || current.current !== session) return;
      current.current = null;
      setPhase('idle');
      setHolding(false);
      const name = (error as Error).name;
      callbacks.current.onError(
        name === 'NotAllowedError'
          ? 'Разрешите доступ к микрофону в настройках браузера или приложения.'
          : name === 'NotSupportedError'
            ? 'Устройство не поддерживает запись голосовых. Прикрепите готовый аудиофайл или попробуйте другой браузер.'
            : name === 'NotFoundError'
              ? 'Микрофон не найден. Подключите его и попробуйте снова.'
              : 'Не удалось включить микрофон. Возможно, он занят другим приложением.',
      );
    }
  }

  /**
   * As in Telegram: a tap starts recording with Pause, Cancel and Done; holding the button
   * records until it is released, then sends.
   */
  function press(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || disabled || current.current) return;
    const pressed = Date.now();
    void start(true);
    const release = () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', cancel);
      if (Date.now() - pressed >= holdMs) finish(false, true);
      else if (alive.current) setHolding(false); // A tap: keep recording with the controls.
    };
    const cancel = () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', cancel);
      finish(true);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', cancel);
  }

  const time = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <div className="voice-recorder">
      {phase === 'idle' ? (
        <button
          type="button"
          className="icon-button voice-button"
          aria-label="Записать голосовое сообщение"
          title="Голосовое сообщение: нажмите или удерживайте"
          disabled={disabled}
          onPointerDown={press}
          // Keyboard and assistive technology: a click without a pointer press.
          onClick={(event) => {
            if (event.detail === 0) void start();
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <Mic size={21} />
        </button>
      ) : (
        <div
          className={`voice-recording ${holding ? 'holding' : ''}`}
          role="group"
          aria-label="Запись голосового сообщения"
        >
          <button
            type="button"
            className="icon-button"
            aria-label="Отменить запись"
            onClick={() => finish(true)}
          >
            <X size={21} />
          </button>
          {phase === 'recording' ? (
            <>
              <span className={`recording-dot ${paused ? 'paused' : ''}`} />
              <time className="recording-time">{time}</time>
              <span className="recording-wave" aria-hidden="true">
                {levels.map((value, index) => (
                  <i key={index} style={{ height: `${Math.max(8, value * 100)}%` }} />
                ))}
              </span>
              <span className="recording-label" role={paused ? 'status' : undefined}>
                {holding ? 'Отпустите, чтобы отправить' : paused ? 'Пауза' : ''}
              </span>
              {!holding && typeof MediaRecorder.prototype.pause === 'function' && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={paused ? 'Продолжить запись' : 'Пауза'}
                  title={paused ? 'Продолжить запись' : 'Пауза'}
                  onClick={togglePause}
                >
                  {paused ? <Play size={19} /> : <Pause size={19} />}
                </button>
              )}
            </>
          ) : (
            <>
              <LoaderCircle className="spin" size={18} />
              <span className="recording-label" role="status">
                {phase === 'permission' ? 'Доступ к микрофону…' : 'Готовим запись…'}
              </span>
            </>
          )}
          {!holding && (
            <button
              type="button"
              className="primary voice-finish"
              disabled={phase !== 'recording'}
              aria-label="Завершить запись"
              title="Готово: прослушать перед отправкой"
              onClick={() => finish(false)}
            >
              <Square size={16} />
              <span>Готово</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
