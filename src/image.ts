export type MediaMeta = { width: number; height: number; thumb?: string };
/** A 24 px JPEG of a picture or frame, drawn blurred in the feed while the real one loads. */
function thumbnail(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement('canvas');
  const scale = 24 / Math.max(width, height);
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/jpeg', 0.6);
  return url.startsWith('data:image/jpeg') && url.length <= 4000 ? url : undefined;
}
/**
 * Size and blurred preview of a photo or video, so the feed reserves its space before it loads.
 * Null for other files or when the browser cannot read it.
 */
export async function measureMedia(file: File): Promise<MediaMeta | null> {
  try {
    if (file.type.startsWith('image/')) {
      const bitmap = await createImageBitmap(file);
      const meta = {
        width: bitmap.width,
        height: bitmap.height,
        thumb: thumbnail(bitmap, bitmap.width, bitmap.height),
      };
      bitmap.close();
      return meta;
    }
    if (!file.type.startsWith('video/')) return null;
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('timeout')), 8000);
        video.onloadeddata = () => {
          clearTimeout(timer);
          resolve();
        };
        video.onerror = () => {
          clearTimeout(timer);
          reject(Error('unreadable'));
        };
        video.src = url;
      });
      const { videoWidth: width, videoHeight: height } = video;
      if (!width || !height) return null;
      return { width, height, thumb: thumbnail(video, width, height) };
    } finally {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

// Phone photos are often 4–12 MB; the chat only needs a screen-sized copy.
// Animated GIFs and other formats are sent unchanged.
const LIMIT = 2560;
export async function compressImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, LIMIT / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1.5 * 1024 * 1024) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#fff'; // JPEG has no transparency.
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85),
  );
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
    type: 'image/jpeg',
    lastModified: file.lastModified,
  });
}
