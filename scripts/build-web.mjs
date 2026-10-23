import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const native = process.argv.includes('--native');
const desktop = process.argv.includes('--desktop');
const result = spawnSync(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    'build',
    '--outDir',
    native ? 'dist-android' : desktop ? 'dist-desktop/web' : 'dist',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...(native || desktop ? { VITE_API_BASE: 'https://api.quiby.me/messenger' } : {}),
      VITE_NATIVE_PUSH: native && existsSync('android/app/google-services.json') ? 'true' : 'false',
    },
  },
);
process.exit(result.status ?? 1);
