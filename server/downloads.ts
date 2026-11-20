const releases = 'https://github.com/cl0rex1/Galinka/releases';
const installer = /\.(exe|dmg|AppImage|deb|apk|pkg\.tar\.zst)$/;

export async function releaseDownloads() {
  try {
    const response = await fetch('https://api.github.com/repos/cl0rex1/Galinka/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Galinka' },
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const release = (await response.json()) as {
        tag_name: string;
        html_url: string;
        assets: { name: string; browser_download_url: string; size: number }[];
      };
      return {
        version: release.tag_name.replace(/^v/, ''),
        url: release.html_url,
        assets: release.assets
          .filter((asset) => installer.test(asset.name))
          .map((asset) => ({
            name: asset.name,
            url: asset.browser_download_url,
            size: asset.size,
          })),
      };
    }
  } catch {
    // The public download links can still work when the GitHub API is unavailable.
  }

  const signal = AbortSignal.timeout(8000);
  const latest = await fetch(`${releases}/latest/download/SHA256SUMS`, {
    redirect: 'manual',
    signal,
  });
  const location = latest.headers.get('location') || '';
  const version =
    /^https:\/\/github\.com\/cl0rex1\/Galinka\/releases\/download\/v(\d+\.\d+\.\d+)\/SHA256SUMS$/.exec(
      location,
    )?.[1];
  if (!version) throw Error('Published release manifest is unavailable');

  const directory = `${releases}/download/v${version}`;
  const manifest = await fetch(`${directory}/SHA256SUMS`, { signal });
  if (!manifest.ok) throw Error('Published release manifest could not be read');
  const names = (await manifest.text()).split(/\r?\n/).flatMap((line) => {
    const name = /^[a-f0-9]{64}  ([A-Za-z0-9_.-]+)$/.exec(line)?.[1];
    return name?.startsWith(`Galinka-${version}-`) && installer.test(name) ? [name] : [];
  });
  if (!names.length) throw Error('Published release manifest has no installers');

  const assets = await Promise.all(
    names.map(async (name) => {
      const url = `${directory}/${name}`;
      const response = await fetch(url, { method: 'HEAD', signal });
      const size = Number(response.headers.get('content-length'));
      if (!response.ok || !Number.isSafeInteger(size) || size <= 0)
        throw Error(`Cannot determine installer size for ${name}`);
      return { name, url, size };
    }),
  );
  return { version, url: `${releases}/tag/v${version}`, assets };
}
