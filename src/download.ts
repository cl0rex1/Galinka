import { API_BASE } from './api';
import { getDemoFileUrl } from './demo';
import { isNative } from './notifications';
import type { Attachment } from './types';

function save(url: string, name: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
}

/** Save an attachment: a download in browsers, the share sheet in the native apps. */
export async function downloadAttachment(file: Attachment, demo: boolean) {
  if (demo) {
    const mediaUrl = getDemoFileUrl(file.id);
    if (mediaUrl) return save(mediaUrl, file.name);
    const url = URL.createObjectURL(
      new Blob([`Демонстрационный файл: ${file.name}\nВ реальном чате здесь будет ваш файл.`], {
        type: 'text/plain',
      }),
    );
    save(url, file.name);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const response = await fetch(`${API_BASE}/files/${file.id}`, { credentials: 'include' });
  if (!response.ok) throw Error('Не удалось скачать файл.');
  const blob = await response.blob();
  if (!isNative) {
    const url = URL.createObjectURL(blob);
    save(url, file.name);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(Error('Не удалось прочитать файл.'));
    reader.readAsDataURL(blob);
  });
  const safeName = file.name.replace(/[^\p{L}\p{N}._ -]/gu, '_');
  const { uri } = await Filesystem.writeFile({
    path: `attachments/${crypto.randomUUID()}-${safeName}`,
    data,
    directory: Directory.Cache,
    recursive: true,
  });
  await Share.share({ title: file.name, url: uri });
}
