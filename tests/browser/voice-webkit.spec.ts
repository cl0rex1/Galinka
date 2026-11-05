import { test } from '@playwright/test';
import { voiceTests } from './helpers/voice-suite';
test.use({ browserName: 'webkit' });
voiceTests();
