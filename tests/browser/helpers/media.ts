import type { Page } from '@playwright/test';

// Keep real MediaRecorder encoding while never opening the machine's microphone.
export async function syntheticMicrophone(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as {
      testStreams: MediaStream[];
      testAudioTracks: MediaStreamTrack[];
    };
    state.testStreams = [];
    state.testAudioTracks = [];
    Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', {
      configurable: true,
      value: async () => {
        const context = new AudioContext();
        const destination = context.createMediaStreamDestination();
        const oscillator = context.createOscillator();
        oscillator.connect(destination);
        oscillator.start();
        await context.resume();
        state.testStreams.push(destination.stream);
        for (const track of destination.stream.getTracks()) {
          // Retain wrappers: WebKit may otherwise recreate them and drop own-property stubs.
          state.testAudioTracks.push(track);
          const stop = track.stop.bind(track);
          track.stop = () => {
            stop();
            void context.close().catch(() => {});
          };
        }
        return destination.stream;
      },
    });
  });
}
