import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseDownloads } from '../server/downloads.js';

test('downloads fall back to the published manifest when GitHub rate-limits the API', async (t) => {
  const base = 'https://github.com/cl0rex1/Galinka/releases';
  const version = '0.16.2';
  const directory = `${base}/download/v${version}`;
  const name = `Galinka-${version}-android-release.apk`;
  const manifest = ['latest.yml', 'Galinka-0.16.1-win-x64.exe', name]
    .map((file) => `${'1'.repeat(64)}  ${file}`)
    .join('\n');
  t.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
    if (url.startsWith('https://api.github.com/')) return new Response(null, { status: 403 });
    if (url === `${base}/latest/download/SHA256SUMS`) {
      assert.equal(options?.redirect, 'manual');
      return Response.redirect(`${directory}/SHA256SUMS`);
    }
    if (url === `${directory}/SHA256SUMS`) return new Response(manifest);
    assert.equal(url, `${directory}/${name}`);
    assert.equal(options?.method, 'HEAD');
    return new Response(null, { headers: { 'Content-Length': '5232147' } });
  });
  assert.deepEqual(await releaseDownloads(), {
    version,
    url: `${base}/tag/v${version}`,
    assets: [{ name, url: `${directory}/${name}`, size: 5232147 }],
  });
});
