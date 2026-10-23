import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
function run(file, args, cwd = '.') {
  const result = spawnSync(process.execPath, [file, ...args], { stdio: 'inherit', cwd });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run('scripts/build-web.mjs', ['--desktop']);
mkdirSync('dist-desktop/public', { recursive: true });
cpSync('desktop', 'dist-desktop/desktop', { recursive: true });
cpSync('public/icon-512.png', 'dist-desktop/public/icon-512.png');
const updaterVersion = JSON.parse(
  readFileSync('node_modules/electron-updater/package.json', 'utf8'),
).version;
writeFileSync(
  'dist-desktop/package.json',
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      author: pkg.author,
      main: pkg.main,
      repository: pkg.repository,
      dependencies: { 'electron-updater': updaterVersion },
    },
    null,
    2,
  ),
);
// Only the updater belongs in the installer. Server, database and Firebase dependencies stay out.
const npmCli = process.env.npm_execpath;
if (!npmCli) throw Error('Run with npm run desktop:build');
run(
  npmCli,
  ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
  'dist-desktop',
);
const electronVersion = JSON.parse(
  readFileSync('node_modules/electron/package.json', 'utf8'),
).version;
if (process.argv.includes('--stage-only')) process.exit(0);
run('node_modules/electron-builder/cli.js', [
  '--projectDir',
  'dist-desktop',
  '--config',
  '../electron-builder.yml',
  `--config.electronVersion=${electronVersion}`,
  '--publish',
  'never',
  ...process.argv.slice(2),
]);
