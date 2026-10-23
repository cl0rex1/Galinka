import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  createWriteStream,
  readdirSync,
  statSync,
} from 'node:fs';
import { createPackage } from '@electron/asar';
import { create } from 'tar';
import { createZstdCompress } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const built = spawnSync(process.execPath, ['scripts/build-desktop.mjs', '--stage-only'], {
  stdio: 'inherit',
});
if (built.status !== 0) process.exit(built.status ?? 1);
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const directory = path.resolve('.tools/arch-package');
for (const folder of [
  'usr/lib/galinka',
  'usr/bin',
  'usr/share/applications',
  'usr/share/icons/hicolor/512x512/apps',
])
  mkdirSync(path.join(directory, folder), { recursive: true });
await createPackage('dist-desktop', path.join(directory, 'usr/lib/galinka/app.asar'));
writeFileSync(
  path.join(directory, 'usr/bin/galinka'),
  '#!/bin/sh\nexec /usr/bin/electron44 /usr/lib/galinka/app.asar "$@"\n',
);
writeFileSync(
  path.join(directory, 'usr/share/applications/galinka.desktop'),
  '[Desktop Entry]\nName=Galinka\nComment=Messenger\nExec=galinka %U\nTerminal=false\nType=Application\nIcon=galinka\nCategories=Network;InstantMessaging;\nStartupWMClass=galinka\n',
);
cpSync(
  'public/icon-512.png',
  path.join(directory, 'usr/share/icons/hicolor/512x512/apps/galinka.png'),
);
function size(folder) {
  return readdirSync(folder).reduce((n, name) => {
    const file = path.join(folder, name);
    return n + (statSync(file).isDirectory() ? size(file) : statSync(file).size);
  }, 0);
}
const epoch = Number(process.env.SOURCE_DATE_EPOCH) || Math.floor(Date.now() / 1000);
writeFileSync(
  path.join(directory, '.PKGINFO'),
  `pkgname = galinka\npkgbase = galinka\npkgver = ${version}-1\npkgdesc = Galinka messenger\nurl = https://github.com/cl0rex1/Galinka\nbuilddate = ${epoch}\npackager = Galinka\nsize = ${size(path.join(directory, 'usr'))}\narch = x86_64\nlicense = custom\ndepend = electron44>=44.9.1\n`,
);
mkdirSync('release', { recursive: true });
const output = `release/Galinka-${version}-arch-x64.pkg.tar.zst`;
await pipeline(
  create(
    {
      cwd: directory,
      portable: true,
      mtime: new Date(epoch * 1000),
      onWriteEntry(entry) {
        entry.stat.mode =
          entry.type === 'Directory' || entry.path === 'usr/bin/galinka' ? 0o755 : 0o644;
      },
    },
    ['.PKGINFO', 'usr'],
  ),
  createZstdCompress(),
  createWriteStream(output),
);
console.log(`Arch package: ${output} (uses the system electron44)`);
