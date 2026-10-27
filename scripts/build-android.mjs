import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';

const release = process.argv.includes('--release');
const env = { ...process.env };
if (existsSync('.secrets/android-signing.json'))
  Object.assign(env, JSON.parse(readFileSync('.secrets/android-signing.json', 'utf8')));
if (env.GALINKA_KEYSTORE) env.GALINKA_KEYSTORE = path.resolve(env.GALINKA_KEYSTORE);
if (release && !env.GALINKA_KEYSTORE)
  throw Error(
    'Release APK requires GALINKA_KEYSTORE and GALINKA_STORE_PASSWORD. See docs/ANDROID.md.',
  );
function run(command, args, cwd = '.') {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env,
    cwd,
    shell: process.platform === 'win32' && command.endsWith('.bat'),
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, ['scripts/build-web.mjs', '--native']);
run(process.execPath, ['node_modules/@capacitor/cli/bin/capacitor', 'sync', 'android']);
run(
  process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew',
  [release ? 'assembleRelease' : 'assembleDebug', '--no-daemon'],
  'android',
);
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
mkdirSync('release', { recursive: true });
const kind = release ? 'release' : 'debug';
const output = `release/Galinka-${version}-android-${kind}.apk`;
copyFileSync(path.join('android/app/build/outputs/apk', kind, `app-${kind}.apk`), output);
console.log(
  `APK: ${output}${existsSync('android/app/google-services.json') ? '' : ' (Firebase not configured)'}`,
);
