import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import jsQR from 'jsqr';
import { Copy, ExternalLink, Flashlight, FlashlightOff, ImageUp, X } from 'lucide-react';
import { CloseButton, Modal, motionAllowed } from './ui';

type Point = { x: number; y: number };
type Found = { text: string; corners: Point[] } | null;
// Chromium and Android ship a native detector; Safari and Firefox fall back to jsQR.
type Detector = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string; cornerPoints: Point[] }[]>;
};
declare const BarcodeDetector: { new (options: { formats: string[] }): Detector } | undefined;

/** Read a QR code from an image or video frame with jsQR; corners in the source's pixels. */
function decode(
  source: CanvasImageSource,
  width: number,
  height: number,
  canvas: HTMLCanvasElement,
  crop = 1,
): Found {
  // `crop` < 1 reads only the middle of the frame at a higher resolution: small or distant codes
  // that vanish when the whole frame is shrunk become readable.
  const cropWidth = width * crop,
    cropHeight = height * crop;
  const left = (width - cropWidth) / 2,
    top = (height - cropHeight) / 2;
  const scale = Math.min(1, 800 / Math.max(cropWidth, cropHeight));
  canvas.width = Math.round(cropWidth * scale);
  canvas.height = Math.round(cropHeight * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(source, left, top, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
  if (!code) return null;
  const { topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner } = code.location;
  return {
    text: code.data,
    corners: [topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner].map((p) => ({
      x: p.x / scale + left,
      y: p.y / scale + top,
    })),
  };
}

/**
 * Full-screen QR scanner in the manner of Telegram: four corner brackets that glide onto the
 * code wherever and however tilted it is, the rest of the picture dimmed. A code read twice in
 * a row counts; the phone ticks and the result is handed over.
 */
export function QrScanner({
  onResult,
  onClose,
}: {
  onResult: (text: string) => void;
  onClose: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const brackets = useRef<SVGPathElement>(null);
  const shade = useRef<SVGPathElement>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  const [error, setError] = useState('');
  const [found, setFound] = useState(false);
  const [torch, setTorch] = useState<boolean | null>(null);
  const done = useRef(false);
  const finish = (text: string) => {
    if (done.current) return;
    done.current = true;
    setFound(true);
    navigator.vibrate?.(20);
    setTimeout(() => onResult(text), motionAllowed() ? 380 : 0);
  };

  useEffect(() => {
    let live = true;
    let frame = 0;
    let stream: MediaStream | undefined;
    const canvas = document.createElement('canvas');
    const detector =
      typeof BarcodeDetector !== 'undefined' ? new BarcodeDetector({ formats: ['qr_code'] }) : null;
    let shown: Point[] | null = null;
    let target: Point[] | null = null;
    let seenAt = 0;
    // A code counts once read twice within a second (frames alternate whole and middle views,
    // so a miss in between must not reset it).
    let last = { text: '', at: 0 };
    let busy = false;

    let frameCount = 0;
    async function detect(element: HTMLVideoElement): Promise<Found> {
      if (detector) {
        const [code] = await detector.detect(element).catch(() => []);
        return code?.cornerPoints.length === 4
          ? { text: code.rawValue, corners: code.cornerPoints }
          : null;
      }
      // Alternate the whole frame and its enlarged middle.
      frameCount++;
      return decode(
        element,
        element.videoWidth,
        element.videoHeight,
        canvas,
        frameCount % 2 ? 1 : 0.5,
      );
    }
    function draw() {
      const box = stage.current;
      const element = video.current;
      if (!box || !element) return;
      const width = box.clientWidth,
        height = box.clientHeight;
      // Idle frame: a centred square. With a code in view: its corners, kept briefly if lost.
      const side = Math.min(width, height) * 0.62;
      const idle = [
        { x: (width - side) / 2, y: (height - side) / 2 },
        { x: (width + side) / 2, y: (height - side) / 2 },
        { x: (width + side) / 2, y: (height + side) / 2 },
        { x: (width - side) / 2, y: (height + side) / 2 },
      ];
      const goal = target && performance.now() - seenAt < 450 ? target : idle;
      const ease = motionAllowed() ? 0.28 : 1;
      shown = shown
        ? shown.map((p, i) => ({
            x: p.x + (goal[i].x - p.x) * ease,
            y: p.y + (goal[i].y - p.y) * ease,
          }))
        : goal;
      const quad = shown;
      const path = quad
        .map((p, i) => {
          const before = quad[(i + 3) % 4],
            after = quad[(i + 1) % 4];
          const along = (q: Point) => `${p.x + (q.x - p.x) * 0.24} ${p.y + (q.y - p.y) * 0.24}`;
          return `M${along(before)}L${p.x} ${p.y}L${along(after)}`;
        })
        .join('');
      brackets.current?.setAttribute('d', path);
      shade.current?.setAttribute(
        'd',
        `M0 0H${width}V${height}H0Z M${quad.map((p) => `${p.x} ${p.y}`).join('L')}Z`,
      );
    }
    async function tick() {
      if (!live) return;
      const element = video.current;
      const box = stage.current;
      if (element && box && element.readyState >= 2 && !busy && !done.current) {
        busy = true;
        const result = await detect(element);
        busy = false;
        if (!live) return;
        if (result) {
          // Video pixels → screen: the video fills the stage like object-fit: cover.
          const scale = Math.max(
            box.clientWidth / element.videoWidth,
            box.clientHeight / element.videoHeight,
          );
          const dx = (box.clientWidth - element.videoWidth * scale) / 2;
          const dy = (box.clientHeight - element.videoHeight * scale) / 2;
          target = result.corners.map((p) => ({ x: p.x * scale + dx, y: p.y * scale + dy }));
          seenAt = performance.now();
          const now = performance.now();
          if (result.text === last.text && now - last.at < 1000) finish(result.text);
          last = { text: result.text, at: now };
        }
      }
      draw();
      frame = requestAnimationFrame(() => void tick());
    }

    navigator.mediaDevices
      ?.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      })
      .then(async (media) => {
        if (!live) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = media;
        track.current = media.getVideoTracks()[0];
        // Keep refocusing as the phone moves; many cameras start fixed at infinity.
        const focus = track.current.getCapabilities?.() as { focusMode?: string[] } | undefined;
        if (focus?.focusMode?.includes('continuous'))
          await track.current
            .applyConstraints({
              advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
            })
            .catch(() => {});
        const capabilities = track.current.getCapabilities?.() as { torch?: boolean } | undefined;
        if (capabilities?.torch) setTorch(false);
        video.current!.srcObject = media;
        await video.current!.play().catch(() => {});
        void tick();
      })
      .catch((cause: Error) =>
        setError(
          cause?.name === 'NotAllowedError'
            ? 'Разрешите доступ к камере, чтобы сканировать. Или выберите снимок QR-кода из галереи.'
            : 'Камера недоступна. Можно выбрать снимок QR-кода из галереи.',
        ),
      );
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', escape);
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
      document.removeEventListener('keydown', escape);
    };
  }, []);

  async function fromImage(file: File) {
    const bitmap = await createImageBitmap(file).catch(() => null);
    const result =
      bitmap && decode(bitmap, bitmap.width, bitmap.height, document.createElement('canvas'));
    bitmap?.close();
    if (result) finish(result.text);
    else setError('На снимке не нашлось QR-кода. Попробуйте снимок ближе и ровнее.');
  }

  return createPortal(
    <div className={`qr-scanner ${found ? 'found' : ''}`} role="dialog" aria-label="Сканер QR-кода">
      <div className="qr-stage" ref={stage}>
        <video ref={video} muted playsInline />
        <svg className="qr-overlay" aria-hidden="true">
          <path ref={shade} className="qr-shade" fillRule="evenodd" />
          <path ref={brackets} className="qr-brackets" />
        </svg>
      </div>
      <header className="qr-top">
        <button type="button" className="icon-button" aria-label="Закрыть сканер" onClick={onClose}>
          <X size={24} />
        </button>
        <strong>Сканер QR-кода</strong>
      </header>
      <footer className="qr-bottom">
        <p role="status">{error || (found ? 'Готово' : 'Наведите камеру на QR-код')}</p>
        <div>
          {torch !== null && (
            <button
              type="button"
              aria-pressed={torch}
              onClick={async () => {
                await track.current
                  ?.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] })
                  .catch(() => {});
                setTorch(!torch);
              }}
            >
              {torch ? <FlashlightOff size={22} /> : <Flashlight size={22} />}
              Фонарик
            </button>
          )}
          <label>
            <ImageUp size={22} />
            Из галереи
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void fromImage(file);
                event.target.value = '';
              }}
            />
          </label>
        </div>
      </footer>
    </div>,
    document.body,
  );
}

/** A scanned code that is not a Galinka link: show it, offer to open a web address or copy. */
export function ScannedText({ text, onClose }: { text: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const web = /^https?:\/\//i.test(text);
  return (
    <Modal title="QR-код" onClose={onClose}>
      <p className="scanned-text">{text}</p>
      {web && <p className="muted">Ссылка ведёт на другой сайт. Открывайте, если доверяете ему.</p>}
      <div className="modal-actions">
        <CloseButton>Закрыть</CloseButton>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            void navigator.clipboard.writeText(text).then(
              () => setCopied(true),
              () => {},
            )
          }
        >
          <Copy size={17} />
          {copied ? 'Скопировано' : 'Копировать'}
        </button>
        {web && (
          <a className="primary" href={text} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={17} />
            Открыть
          </a>
        )}
      </div>
    </Modal>
  );
}
