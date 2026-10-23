import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_ID__: JSON.stringify(process.env.BUILD_SHA || version),
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:3001' },
    watch: {
      ignored: [
        '**/release/**',
        '**/dist-desktop/**',
        '**/dist-android/**',
        '**/android/**',
        '**/.tools/**',
        '**/.secrets/**',
        '**/docs/screenshots/**',
      ],
    },
  },
  build: { target: 'es2022' },
});
