import { test } from '@playwright/test';
import { voiceTests } from './helpers/voice-suite';
test.use({ browserName: 'webkit' });
// Playwright's Windows WebKit never loads these AAC fixtures (readyState stays below 2).
// CI runs these on Linux; a physical iPhone remains the real check (see README).
test.skip(
  process.platform === 'win32',
  'Playwright WebKit on Windows does not load AAC voice files.',
);
voiceTests();
