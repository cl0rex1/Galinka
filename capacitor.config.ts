import type { CapacitorConfig } from '@capacitor/cli';

// MainActivity sends /messenger to HTTPS while serving the UI from bundled assets.
// Keeping APP_ORIGIN preserves HttpOnly, SameSite=strict sessions without extra CORS origins.
const config: CapacitorConfig = {
  appId: 'me.quiby.galinka',
  appName: 'Galinka',
  webDir: 'dist-android',
  server: { hostname: 'mess.quiby.me', androidScheme: 'https' },
  android: { backgroundColor: '#111817' },
  plugins: { PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] } },
};
export default config;
