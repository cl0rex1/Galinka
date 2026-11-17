import { useEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { SwitchCamera, Square, Video, X } from 'lucide-react';
import { audioConstraints, mediaPrefs, videoConstraints } from './media';

const maxSeconds = 60;
const maxBytes = 20 * 1024 * 1024;
type Session = {
  stream: MediaStream;
  /** Every camera track opened during the recording, all stopped at the end. */
  tracks: MediaStreamTrack[];
  recorder?: MediaRecorder;
  chunks: Blob[];
  discard: boolean;
  stopMirror?: () => void;
  /** Whether frames are drawn flipped (the front camera with mirroring on). */
  flip?: { current: boolean };
  timer?: ReturnType<typeof setInterval>;
};

/**
 * Draws the camera into a square canvas and records the canvas. The recording then survives a
 * camera switch (only the <video> source changes) and can be mirrored frame by frame.
 */
function canvasCamera(video: HTMLVideoElement, source: MediaStream, flip: { current: boolean }) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.min(640, Math.max(video.videoWidth, video.videoHeight) || 480);
  const context = canvas.getContext('2d');
  if (!context || !canvas.width || !canvas.captureStream)
    throw new DOMException('Camera canvas unavailable', 'NotSupportedError');
  const capture = canvas.captureStream(30);
  const videoTrack = capture.getVideoTracks()[0];
  const stream = new MediaStream([videoTrack, ...source.getAudioTracks()]);
  let frame = 0;
  const draw = () => {
    const { videoWidth: w, videoHeight: h } = video;
    if (w && h) {
      // Cover the square: the middle of a landscape or portrait frame.
      const side = Math.min(w, h);
      context.setTransform(flip.current ? -1 : 1, 0, 0, 1, flip.current ? canvas.width : 0, 0);
      context.drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
    }
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
  onActive,
  disabled = false,
}: {
  onRecorded: (file: File) => void;
  onError: (error: string) => void;
  /** Called a few times a second while recording (for the "recording…" status). */
  onActive?: () => void;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [mirror, setMirror] = useState(false);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [cameras, setCameras] = useState(0);
  const [switching, setSwitching] = useState(false);
  const preview = useRef<HTMLVideoElement>(null);
  const session = useRef<Session | null>(null);
  const attempt = useRef(0);
  const callbacks = useRef({ onRecorded, onError, onActive });
  callbacks.current = { onRecorded, onError, onActive };

  function release() {
    const current = session.current;
    if (current) {
      clearInterval(current.timer);
      current.stopMirror?.();
      current.stream.getTracks().forEach((track) => track.stop());
      current.tracks.forEach((track) => track.stop());
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
      setFacing('user');
      setCameras(0);
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
      const current: Session = { stream, tracks: [], chunks: [], discard: false };
      session.current = current;
      const camera = preview.current!;
      camera.srcObject = stream;
      let recording = stream;
      const canvasRecording = typeof HTMLCanvasElement.prototype.captureStream === 'function';
      if (mirrored || canvasRecording) {
        await camera.play();
        if (id !== attempt.current) return;
        current.flip = { current: mirrored };
        try {
          const drawn = canvasCamera(camera, stream, current.flip);
          current.stopMirror = drawn.stop;
          recording = drawn.stream;
        } catch (error) {
          // Without a canvas the camera is recorded as is; only mirroring needs it.
          if (mirrored) throw error;
          current.flip = undefined;
        }
      }
      // The switch button appears only with a second camera and the canvas pipeline.
      if (current.flip)
        void navigator.mediaDevices
          .enumerateDevices()
          .then((devices) => {
            if (session.current === current)
              setCameras(devices.filter((device) => device.kind === 'videoinput').length);
          })
          .catch(() => {});
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
        callbacks.current.onActive?.();
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

  /** Front and back camera while recording; the recording itself keeps going. */
  async function switchCamera() {
    const current = session.current;
    const camera = preview.current;
    if (!current?.flip || !camera || switching) return;
    const next = facing === 'user' ? 'environment' : 'user';
    setSwitching(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(next) });
      if (session.current !== current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const old = camera.srcObject as MediaStream | null;
      current.tracks.push(...stream.getTracks());
      camera.srcObject = stream;
      await camera.play().catch(() => {});
      current.flip.current = next === 'user' && mirror;
      // The first stream also carries the microphone: stop only its picture.
      old?.getVideoTracks().forEach((track) => track.stop());
      setFacing(next);
    } catch {
      callbacks.current.onError('Не удалось переключить камеру.');
    } finally {
      setSwitching(false);
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
                className={mirror && facing === 'user' ? 'camera-mirrored' : undefined}
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
              {cameras > 1 && phase === 'recording' && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Сменить камеру"
                  title="Сменить камеру"
                  disabled={switching}
                  onClick={() => void switchCamera()}
                >
                  <SwitchCamera size={20} />
                </button>
              )}
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
