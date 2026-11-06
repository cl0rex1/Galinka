import { useEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Square, Video, X } from 'lucide-react';
import { audioConstraints, mediaPrefs, videoConstraints } from './media';

const maxSeconds = 60;
const maxBytes = 20 * 1024 * 1024;
type Session = {
  stream: MediaStream;
  recorder?: MediaRecorder;
  chunks: Blob[];
  discard: boolean;
  stopMirror?: () => void;
  timer?: ReturnType<typeof setInterval>;
};

function mirrorCamera(video: HTMLVideoElement, source: MediaStream) {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext('2d');
  if (!context || !canvas.width || !canvas.height || !canvas.captureStream)
    throw new DOMException('Camera mirroring unavailable', 'NotSupportedError');
  context.translate(canvas.width, 0);
  context.scale(-1, 1);
  const capture = canvas.captureStream(30);
  const videoTrack = capture.getVideoTracks()[0];
  const stream = new MediaStream([videoTrack, ...source.getAudioTracks()]);
  let frame = 0;
  const draw = () => {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    frame = requestAnimationFrame(draw);
  };
  try {
    draw();
  } catch (error) {
    videoTrack.stop();
    throw error;
  }
  return {
    stream,
    stop: () => {
      cancelAnimationFrame(frame);
      videoTrack.stop();
    },
  };
}

/** Round video message: camera button in the composer and a full-screen round preview. */
export function VideoNoteRecorder({
  onRecorded,
  onError,
  disabled = false,
}: {
  onRecorded: (file: File) => void;
  onError: (error: string) => void;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [mirror, setMirror] = useState(false);
  const preview = useRef<HTMLVideoElement>(null);
  const session = useRef<Session | null>(null);
  const attempt = useRef(0);
  const callbacks = useRef({ onRecorded, onError });
  callbacks.current = { onRecorded, onError };

  function release() {
    const current = session.current;
    if (current) {
      clearInterval(current.timer);
      current.stopMirror?.();
      current.stream.getTracks().forEach((track) => track.stop());
    }
    session.current = null;
    setPhase('idle');
  }
  function stop(discard: boolean) {
    const current = session.current;
    if (!current?.recorder) {
      // Still asking for the camera: forget that request.
      attempt.current++;
      release();
      return;
    }
    current.discard ||= discard;
    if (current.recorder?.state === 'recording') current.recorder.stop();
    else release();
  }
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) stopRef.current(true);
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      stopRef.current(true);
    };
  }, []);
  useEffect(() => {
    if (phase === 'idle') return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') stopRef.current(true);
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [phase]);

  async function start() {
    if (disabled || phase !== 'idle') return;
    if (
      !window.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      onError('Запись кружков недоступна в этом браузере. Откройте Galinka по HTTPS.');
      return;
    }
    const id = ++attempt.current;
    const mirrored = mediaPrefs().mirror;
    flushSync(() => {
      setMirror(mirrored);
      setPhase('starting');
      setSeconds(0);
    });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints(),
        audio: audioConstraints(),
      });
      if (id !== attempt.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const current: Session = { stream, chunks: [], discard: false };
      session.current = current;
      const camera = preview.current!;
      camera.srcObject = stream;
      let recording = stream;
      if (mirrored) {
        await camera.play();
        if (id !== attempt.current) return;
        const reflected = mirrorCamera(camera, stream);
        current.stopMirror = reflected.stop;
        recording = reflected.stream;
      }
      // MP4 plays everywhere, Safari included; WebM is the fallback for Firefox.
      const types: (string | undefined)[] = [
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ].filter((type) => MediaRecorder.isTypeSupported(type));
      types.push(undefined);
      let recorder: MediaRecorder | undefined;
      for (const mimeType of types) {
        try {
          const candidate = new MediaRecorder(recording, {
            ...(mimeType ? { mimeType } : {}),
            videoBitsPerSecond: 1_000_000,
            audioBitsPerSecond: 64000,
          });
          candidate.start(1000);
          recorder = candidate;
          break;
        } catch {
          /* Try the next encoder. */
        }
      }
      if (!recorder) throw new DOMException('No video encoder', 'NotSupportedError');
      current.recorder = recorder;
      let bytes = 0;
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        bytes += event.data.size;
        current.chunks.push(event.data);
        if (bytes > maxBytes) {
          stopRef.current(true);
          callbacks.current.onError('Кружок слишком большой. Максимум — 20 МБ.');
        }
      };
      recorder.onstop = () => {
        const type = (recorder.mimeType || current.chunks[0]?.type || 'video/webm').split(';')[0];
        const blob = new Blob(current.chunks, { type });
        const discard = current.discard;
        if (session.current === current) release();
        if (discard) return;
        if (!blob.size) {
          callbacks.current.onError('Кружок не записался. Попробуйте ещё раз.');
          return;
        }
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        callbacks.current.onRecorded(
          new File([blob], `Кружок-${stamp}.${type.includes('mp4') ? 'mp4' : 'webm'}`, { type }),
        );
      };
      const started = Date.now();
      setPhase('recording');
      current.timer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        setSeconds(elapsed);
        if (elapsed >= maxSeconds) stopRef.current(false);
      }, 250);
    } catch (error) {
      if (id !== attempt.current) return;
      release();
      const name = (error as Error).name;
      onError(
        name === 'NotAllowedError'
          ? 'Разрешите доступ к камере и микрофону в настройках браузера или приложения.'
          : name === 'NotFoundError'
            ? 'Камера не найдена. Подключите её или выберите другую в настройках.'
            : name === 'NotSupportedError'
              ? mirrored
                ? 'Не удалось записать зеркальное видео. Отключите зеркалирование в настройках «Голос и видео».'
                : 'Устройство не умеет записывать видео в этом браузере.'
              : 'Не удалось включить камеру. Возможно, она занята другим приложением.',
      );
    }
  }

  return (
    <>
      <button
        type="button"
        className="icon-button video-note-button"
        aria-label="Записать кружок"
        title="Кружок"
        disabled={disabled || phase !== 'idle'}
        onClick={() => void start()}
      >
        <Video size={21} />
      </button>
      {phase !== 'idle' &&
        createPortal(
          <div className="video-note-recorder" role="dialog" aria-label="Запись кружка">
            <div className="video-note-stage">
              <video
                ref={preview}
                className={mirror ? 'camera-mirrored' : undefined}
                autoPlay
                muted
                playsInline
              />
              <svg className="video-note-ring" viewBox="0 0 100 100" aria-hidden="true">
                <circle
                  cx="50"
                  cy="50"
                  r="48.5"
                  pathLength="100"
                  strokeDashoffset={100 - (seconds / maxSeconds) * 100}
                />
              </svg>
            </div>
            <div className="video-note-controls">
              <button
                type="button"
                className="icon-button"
                aria-label="Отменить кружок"
                onClick={() => stop(true)}
              >
                <X size={22} />
              </button>
              <span className="recording-dot" />
              <time className="recording-time">
                {phase === 'recording'
                  ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
                  : 'Камера…'}
              </time>
              <button
                type="button"
                className="primary voice-finish"
                disabled={phase !== 'recording'}
                aria-label="Завершить кружок"
                onClick={() => stop(false)}
              >
                <Square size={16} />
                <span>Готово</span>
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
