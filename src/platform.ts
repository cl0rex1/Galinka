export type Platform = 'Android' | 'iOS' | 'Windows' | 'macOS' | 'Linux' | 'Arch Linux' | 'Web';
export type ReleaseAsset = { name: string; url: string; size: number };
export type Release = { version: string; url: string; assets: ReleaseAsset[] };
export const platforms: Platform[] = ['Android', 'iOS', 'Windows', 'macOS', 'Linux', 'Arch Linux'];
export function detectPlatform(
  agent = navigator.userAgent,
  touches = navigator.maxTouchPoints,
): Platform {
  if (/Android/i.test(agent)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(agent) || (/Macintosh/i.test(agent) && touches > 1)) return 'iOS';
  if (/Windows/i.test(agent)) return 'Windows';
  if (/Mac/i.test(agent)) return 'macOS';
  if (/Linux/i.test(agent)) return 'Linux';
  return 'Web';
}
export function releaseFiles(release: Release | null, platform: Platform) {
  const suffix = {
    Android: /-android-release\.apk$/,
    Windows: /-win-.*\.exe$/,
    macOS: /-mac-.*\.dmg$/,
    Linux: /\.(AppImage|deb)$/,
    'Arch Linux': /\.pkg\.tar\.zst$/,
    iOS: /$^/,
    Web: /$^/,
  }[platform];
  return (release?.assets || []).filter((file) => suffix.test(file.name));
}
export function newerVersion(remote: string, installed: string) {
  const parse = (version: string) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version)?.slice(1).map(Number);
  const a = parse(remote),
    b = parse(installed);
  if (!a || !b) return false;
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index];
  }
  return false;
}

// What this device can usefully do. Buttons that make no sense here are not shown.
const query = (media: string) => typeof matchMedia === 'function' && matchMedia(media).matches;
/** Finger-driven phone or tablet: scans QR codes rather than showing them. */
export const touchDevice = () => query('(pointer: coarse)') && !query('(pointer: fine)');
/** Already running as an installed app: no point offering to install it. */
export const installedApp = () =>
  Boolean((window as { galinkaDesktop?: unknown }).galinkaDesktop) ||
  query('(display-mode: standalone)') ||
  /Galinka|wv\)/.test(navigator.userAgent) ||
  (
    window as { Capacitor?: { isNativePlatform?: () => boolean } }
  ).Capacitor?.isNativePlatform?.() === true;
