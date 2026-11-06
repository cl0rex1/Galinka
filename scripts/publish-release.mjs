import { openAsBlob } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY || 'cl0rex1/Galinka';
const tag = process.env.RELEASE_TAG;
if (!token || !/^v\d+\.\d+\.\d+$/.test(tag || ''))
  throw Error('Release credentials and a version tag are required.');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
if (tag !== `v${version}`) throw Error('Release tag must match package.json.');
// Release notes come from the matching CHANGELOG.md section, the same text the site shows.
const section = (await readFile('CHANGELOG.md', 'utf8'))
  .split(/^## /m)
  .find((part) => part.startsWith(`${version} `));
if (!section) throw Error(`CHANGELOG.md has no section for ${version}.`);
const releaseNotes = section.slice(section.indexOf('\n') + 1).trim();
const directory = 'release';
const files = (await readdir(directory))
  .filter((name) => /\.(exe|dmg|zip|AppImage|deb|apk|pkg\.tar\.zst|yml|blockmap)$/.test(name))
  .sort();
for (const required of [
  '-android-release.apk',
  '-win-x64.exe',
  '-mac-arm64.dmg',
  '-mac-x64.dmg',
  '.AppImage',
  '.deb',
  '.pkg.tar.zst',
  'latest.yml',
  'latest-linux.yml',
]) {
  if (!files.some((name) => name.endsWith(required)))
    throw Error(`Missing release artifact: ${required}`);
}
const digests = new Map();
for (const name of files) {
  if (!name.startsWith('latest') && !name.startsWith(`Galinka-${version}-`))
    throw Error(`Unexpected version in artifact: ${name}`);
  const hash = createHash('sha256');
  for await (const chunk of (await openAsBlob(`${directory}/${name}`)).stream()) hash.update(chunk);
  digests.set(name, hash.digest('hex'));
}
const { writeFile } = await import('node:fs/promises');
await writeFile(
  `${directory}/SHA256SUMS`,
  files.map((name) => `${digests.get(name)}  ${name}\n`).join(''),
);
files.push('SHA256SUMS');
async function api(path, method = 'GET', data) {
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'Galinka-release',
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (!response.ok) throw Error(`GitHub ${method} ${path}: ${response.status}`);
  return response.status === 204 ? null : response.json();
}
// The tag lookup does not return draft releases. Resolve their numeric ID from the list.
const releases = await api('releases?per_page=100');
let release = releases.find((item) => item.tag_name === tag);
if (!release)
  release = await api('releases', 'POST', {
    tag_name: tag,
    name: `Galinka ${tag}`,
    body: releaseNotes,
    draft: true,
  });
if (!release.draft) throw Error('This release is already published; assets are immutable.');
const upload = release.upload_url.replace(/\{.*$/, '');
if (new URL(upload).origin !== 'https://uploads.github.com')
  throw Error('Unexpected upload origin.');
for (const name of files) {
  const existing = release.assets.find((asset) => asset.name === name);
  const file = `${directory}/${name}`;
  if (existing) {
    const digest =
      digests.get(name) ||
      createHash('sha256')
        .update(await readFile(file))
        .digest('hex');
    if (existing.digest !== `sha256:${digest}`) throw Error(`Existing artifact differs: ${name}`);
    continue;
  }
  const response = await fetch(`${upload}?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(300000),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String((await stat(file)).size),
      'User-Agent': 'Galinka-release',
    },
    body: await openAsBlob(file),
  });
  if (!response.ok) throw Error(`Artifact upload failed (${response.status}): ${name}`);
  console.log(`Uploaded ${name}`);
}
await api(`releases/${release.id}`, 'PATCH', { draft: false, make_latest: 'true' });
console.log(`Published https://github.com/${repository}/releases/tag/${tag}`);
