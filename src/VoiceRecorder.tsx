import { useEffect, useRef, useState } from 'react';
import { Mic, Square, X, LoaderCircle } from 'lucide-react';
import { audioConstraints } from './media';

type Recording = {
  generation: number;
  recorder?: MediaRecorder;
  stream?: MediaStream;
  timer?: ReturnType<typeof setInterval>;
  stopTimer?: ReturnType<typeof setTimeout>;
  discard: boolean;
};
const maxSeconds = 300;
const maxBytes = 20 * 1024 * 1024;

export function VoiceRecorder({
  onRecorded,
  onError,
  disabled = false,
}: {
  onRecorded: (file: File) => void;
  onError: (error: string) => void;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<'idle' | 'permission' | 'recording' | 'finishing'>('idle');
  const [seconds, setSeconds] = useState(0);
  const current = useRef<Recording | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const callbacks = useRef({ onRecorded, onError });
  callbacks.current = { onRecorded, onError };

  function finish(discard: boolean) {
    const session = current.current;
    if (!session) return;
    session.discard ||= discard;
    clearInterval(session.timer);
    if (session.recorder?.state === 'recording') {
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

  async function start() {
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
    const session: Recording = { generation: ++generation.current, discard: false };
    current.current = session;
    setPhase('permission');
    setSeconds(0);
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
      const chunks: Blob[] = [];
      let bytes = 0;
      const started = Date.now();
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
        if (session.discard) return;
        const type = (recorder.mimeType || chunks[0]?.type || '').split(';')[0];
        const blob = new Blob(chunks, { type });
        if (!blob.size || blob.size > maxBytes) {
          callbacks.current.onError('Запись не получилась. Попробуйте ещё раз.');
          return;
        }
        const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        callbacks.current.onRecorded(
          new File(
            [blob],
            `Голосовое-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`,
            { type },
          ),
        );
      };
      setPhase('recording');
      session.timer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        setSeconds(elapsed);
        if (elapsed >= maxSeconds) finish(false);
      }, 250);
    } catch (error) {
      session.stream?.getTracks().forEach((track) => track.stop());
      if (!alive.current || current.current !== session) return;
      current.current = null;
      setPhase('idle');
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
  return (
    <div className="voice-recorder">
      {phase === 'idle' ? (
        <button
          type="button"
          className="icon-button voice-button"
          aria-label="Записать голосовое сообщение"
          title="Голосовое сообщение"
          disabled={disabled}
          onClick={() => void start()}
        >
          <Mic size={21} />
        </button>
      ) : (
        <div className="voice-recording" role="group" aria-label="Запись голосового сообщения">
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
              <span className="recording-dot" />
              <time className="recording-time">
                {String(Math.floor(seconds / 60)).padStart(2, '0')}:
                {String(seconds % 60).padStart(2, '0')}
              </time>
              <span className="recording-label">Запись · до 5 мин.</span>
            </>
          ) : (
            <>
              <LoaderCircle className="spin" size={18} />
              <span className="recording-label" role="status">
                {phase === 'permission' ? 'Доступ к микрофону…' : 'Готовим запись…'}
              </span>
            </>
          )}
          <button
            type="button"
            className="primary voice-finish"
            disabled={phase !== 'recording'}
            aria-label="Завершить запись"
            onClick={() => finish(false)}
          >
            <Square size={16} />
            <span>Готово</span>
          </button>
        </div>
      )}
    </div>
  );
}
