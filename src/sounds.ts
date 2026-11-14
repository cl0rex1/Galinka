import type { Chat } from './types';

/** Per-device: whether a message that arrives while Galinka is open makes a sound or buzzes. */
export type InAppAlerts = { sound: boolean; vibrate: boolean };
const KEY = 'galinka-in-app-alerts';

export function readInAppAlerts(): InAppAlerts {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { sound: saved.sound !== false, vibrate: saved.vibrate !== false };
  } catch {
    return { sound: true, vibrate: true };
  }
}
export function saveInAppAlerts(value: InAppAlerts) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* Private mode: the choice lasts until reload. */
  }
}

/** The tones a chat can have; "silent" notifies without one. Synthesized, so nothing to download. */
export const CHAT_SOUNDS: { id: NonNullable<Chat['sound']>; label: string }[] = [
  { id: 'default', label: 'Обычный' },
  { id: 'soft', label: 'Мягкий' },
  { id: 'bright', label: 'Звонкий' },
  { id: 'silent', label: 'Без звука' },
];
const TONES: Record<string, [number, number][]> = {
  // [frequency Hz, start s]
  default: [
    [880, 0],
    [1318.5, 0.09],
  ],
  soft: [
    [523.25, 0],
    [659.25, 0.12],
  ],
  bright: [
    [1318.5, 0],
    [1760, 0.07],
    [2093, 0.14],
  ],
};

let context: AudioContext | undefined;
let lastPlayed = 0;

/** A short chime. Quick bursts of messages make one sound, not a rattle. */
export function playTone(sound: Chat['sound'] = 'default') {
  const notes = TONES[sound ?? 'default'];
  if (!notes || Date.now() - lastPlayed < 1200) return;
  lastPlayed = Date.now();
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    const now = context.currentTime;
    for (const [frequency, start] of notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.18, now + start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + 0.22);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + start);
      oscillator.stop(now + start + 0.25);
    }
  } catch {
    /* No audio output, or the browser has not been interacted with yet. */
  }
}

/** Sound and vibration for a message that arrived while the app is open. */
export function alertInApp(sound: Chat['sound']) {
  const prefs = readInAppAlerts();
  if (sound === 'silent') return;
  if (prefs.sound) playTone(sound);
  if (prefs.vibrate) navigator.vibrate?.([30, 40, 30]);
}

/** The Windows taskbar overlay: a red dot with the count, drawn here because Electron needs a PNG. */
export function badgeImage(count: number) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const context2d = canvas.getContext('2d');
    if (!context2d) return null;
    context2d.fillStyle = '#e5484d';
    context2d.beginPath();
    context2d.arc(16, 16, 16, 0, Math.PI * 2);
    context2d.fill();
    context2d.fillStyle = '#fff';
    context2d.textAlign = 'center';
    context2d.textBaseline = 'middle';
    const text = count > 99 ? '99+' : String(count);
    context2d.font = `bold ${text.length > 2 ? 13 : text.length > 1 ? 17 : 20}px system-ui, sans-serif`;
    context2d.fillText(text, 16, 17);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
