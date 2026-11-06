import { useEffect, useRef, useState } from 'react';
import {
  audioConstraints,
  mediaPrefs,
  saveMediaPrefs,
  videoConstraints,
  type MediaPrefs,
} from './media';

/** Settings tab: which microphone and camera to record with, noise filter, a live check. */
export function MediaSettings() {
  const [prefs, setPrefs] = useState<MediaPrefs>(mediaPrefs);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const preview = useRef<HTMLVideoElement>(null);
  const meter = useRef<HTMLDivElement>(null);
  const supported = Boolean(navigator.mediaDevices?.enumerateDevices);
  const named = devices.some((device) => device.label);

  const list = () =>
    navigator.mediaDevices
      ?.enumerateDevices()
      .then(setDevices)
      .catch(() => setDevices([]));
  useEffect(() => {
    void list();
    navigator.mediaDevices?.addEventListener?.('devicechange', list);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', list);
  }, []);
  const update = (change: Partial<MediaPrefs>) => {
    const next = { ...prefs, ...change };
    setPrefs(next);
    saveMediaPrefs(next);
  };

  // Live check: camera in a circle, microphone as a level bar. Restarts when a device changes.
  useEffect(() => {
    if (!testing) return;
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let frame = 0;
    let live = true;
    setError('');
    navigator.mediaDevices
      .getUserMedia({ audio: audioConstraints(), video: videoConstraints() })
      .then((media) => {
        if (!live) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        void list();
        if (preview.current) preview.current.srcObject = media;
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaStreamSource(media).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(samples);
          let peak = 0;
          for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128));
          // Straight to the DOM: no re-render sixty times a second.
          const level = Math.min(1, peak / 64);
          meter.current?.style.setProperty('--level', String(level));
          meter.current?.setAttribute('aria-valuenow', String(Math.round(level * 100)));
          frame = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch((cause: Error) => {
        if (!live) return;
        setTesting(false);
        setError(
          cause.name === 'NotAllowedError'
            ? 'Разрешите доступ к камере и микрофону в настройках браузера.'
            : 'Не удалось включить камеру или микрофон.',
        );
      });
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close();
    };
  }, [testing, prefs.mic, prefs.camera, prefs.noise]);

  if (!supported)
    return (
      <section className="settings-section">
        <h2>Голос и видео</h2>
        <p className="muted">Этот браузер не даёт доступ к микрофону и камере.</p>
      </section>
    );
  const picker = (kind: 'audioinput' | 'videoinput', label: string, value?: string) => {
    const options = devices.filter((device) => device.kind === kind && device.deviceId);
    return (
      <label>
        {label}
        <select
          value={value || ''}
          onChange={(event) =>
            update(
              kind === 'audioinput' ? { mic: event.target.value } : { camera: event.target.value },
            )
          }
        >
          <option value="">По умолчанию</option>
          {options.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `${kind === 'audioinput' ? 'Микрофон' : 'Камера'} ${index + 1}`}
            </option>
          ))}
        </select>
      </label>
    );
  };
  return (
    <>
      <section className="settings-section">
        <h2>Устройства</h2>
        {picker('audioinput', 'Микрофон', prefs.mic)}
        {picker('videoinput', 'Камера для кружков', prefs.camera)}
        {!named && (
          <p className="settings-hint">
            Названия устройств появятся после проверки: браузер покажет их, когда вы разрешите
            доступ.
          </p>
        )}
        <div className="settings-row">
          <div>
            <h3>Шумоподавление</h3>
            <p>Убирает фоновый шум и выравнивает громкость голоса.</p>
          </div>
          <button
            className={`switch ${prefs.noise ? 'on' : ''}`}
            role="switch"
            aria-checked={prefs.noise}
            aria-label="Шумоподавление"
            onClick={() => update({ noise: !prefs.noise })}
          >
            <span />
          </button>
        </div>
      </section>
      <section className="settings-section">
        <h2>Проверка</h2>
        {testing ? (
          <div className="media-check">
            <video ref={preview} autoPlay muted playsInline aria-label="Изображение с камеры" />
            <div
              ref={meter}
              className="mic-level"
              role="meter"
              aria-label="Громкость микрофона"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={0}
            >
              <span />
            </div>
            <p className="muted">Скажите что-нибудь — полоса покажет громкость.</p>
          </div>
        ) : (
          <p className="muted">Камера и микрофон включатся только на время проверки.</p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="secondary" onClick={() => setTesting((value) => !value)}>
          {testing ? 'Остановить проверку' : 'Проверить камеру и микрофон'}
        </button>
      </section>
    </>
  );
}
