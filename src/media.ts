/** Voice and video preferences, kept on this device: chosen microphone, camera, noise filter. */
export type MediaPrefs = { mic?: string; camera?: string; noise: boolean };
const key = 'galinka-media';

export function mediaPrefs(): MediaPrefs {
  try {
    return { noise: true, ...JSON.parse(localStorage.getItem(key) || '{}') };
  } catch {
    return { noise: true };
  }
}
export function saveMediaPrefs(prefs: MediaPrefs) {
  try {
    localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    /* Private mode: the choice lasts until reload. */
  }
}
// `ideal` falls back to the default device when the saved one is unplugged.
export function audioConstraints(): MediaTrackConstraints {
  const { mic, noise } = mediaPrefs();
  return {
    ...(mic ? { deviceId: { ideal: mic } } : {}),
    echoCancellation: true,
    noiseSuppression: noise,
    autoGainControl: noise,
  };
}
export function videoConstraints(facingMode?: 'user' | 'environment'): MediaTrackConstraints {
  const { camera } = mediaPrefs();
  return {
    ...(camera && !facingMode
      ? { deviceId: { ideal: camera } }
      : { facingMode: facingMode || 'user' }),
    width: { ideal: 480 },
    height: { ideal: 480 },
    aspectRatio: { ideal: 1 },
  };
}
