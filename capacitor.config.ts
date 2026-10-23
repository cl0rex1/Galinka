import type { CapacitorConfig } from '@capacitor/cli';

// Match APP_ORIGIN so the existing HttpOnly, SameSite=strict sessions also work in Android.
const config: CapacitorConfig = {
  appId: 'me.quiby.galinka',
  appName: 'Galinka',
  webDir: 'dist-android',
  server: { hostname: 'mess.quiby.me', androidScheme: 'https' },
  android: { backgroundColor: '#111817' },
  plugins: { PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] } },
};
export default config;
