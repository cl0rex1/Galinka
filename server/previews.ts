import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import dns from 'node:dns/promises';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Agent, fetch as undiciFetch } from 'undici';

const execFileAsync = promisify(execFile);

export type LinkPreviewData = {
  url: string;
  site: string;
  title: string;
  description?: string;
  image?: string;
  provider?: 'youtube' | 'spotify' | 'tiktok' | 'web';
  embed_url?: string;
  /** Shorts and TikTok: a tall player. */
  vertical?: boolean;
  /** A small square picture, shown beside the text rather than under it. */
  thumbnail?: boolean;
};

export type GifItem = {
  id: string;
  title: string;
  previewUrl?: string;
  keywords: string[];
};

export class PreviewError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAX_TIKTOK_BYTES = 50 * 1024 * 1024;
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIp(address: string): boolean {
  const normalized = address.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIPv4(normalized)) return isPrivateIpv4(normalized);
  if (!net.isIPv6(normalized)) return true;
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice(7);
    if (net.isIPv4(mapped)) return isPrivateIpv4(mapped);
  }
  const firstHex = parseInt(normalized.split(':')[0] || '0', 16);
  // fc00::/7 (ULA), fe80::/10 (link-local), ff00::/8 (multicast)
  if ((firstHex & 0xfe00) === 0xfc00) return true;
  if ((firstHex & 0xffc0) === 0xfe80) return true;
  if ((firstHex & 0xff00) === 0xff00) return true;
  return false;
}

/**
 * Re-checks the address at connect time, so a host that resolved to a public IP during
 * validation cannot rebind to an internal one for the actual request.
 */
const publicOnly = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses: LookupAddress[]) => {
        if (error) return callback(error, '', 0);
        if (!addresses.length || addresses.some((a) => isPrivateIp(a.address)))
          return callback(new PreviewError('Адрес ведёт во внутреннюю сеть.'), '', 0);
        if ((options as { all?: boolean }).all) return (callback as any)(null, addresses);
        callback(null, addresses[0].address, addresses[0].family);
      });
    },
  },
});

/** Ensures a user-supplied URL resolves only to public internet addresses (SSRF protection). */
export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PreviewError('Некорректная ссылка.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new PreviewError('Поддерживаются только http/https ссылки.');
  }
  if (url.username || url.password || rawUrl.length > 2048) {
    throw new PreviewError('Недопустимая ссылка.');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.arpa')
  ) {
    throw new PreviewError('Локальные и внутренние адреса запрещены.');
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new PreviewError('Приватные IP-адреса запрещены.');
    return url;
  }
  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    if (!records.length || records.some((r) => isPrivateIp(r.address))) {
      throw new PreviewError('Адрес ведёт во внутреннюю сеть.');
    }
  } catch (err) {
    if (err instanceof PreviewError) throw err;
    throw new PreviewError('Не удалось определить адрес ссылки.');
  }
  return url;
}

/** Fetches a server-configured upstream endpoint (never accepts unvalidated user URLs). */
async function fetchUpstream(
  endpointUrl: string,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<Response> {
  const parsed = new URL(endpointUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new PreviewError('Некорректная конфигурация внешнего сервиса.', 500);
  }
  return fetch(parsed.href, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'User-Agent': 'GalinkaServer/1.0',
      ...(init.headers || {}),
    },
  });
}

export function extractFirstUrl(text: string): string | null {
  const clean = text.replace(/\[(?:sticker|gif):[^\]]+\]/g, ' ');
  const match = clean.match(/https?:\/\/[^\s<>"'`]+/i);
  if (!match) return null;
  const candidate = match[0].replace(/[.,!?;:)'"]+$/, '');
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function isTikTokUrl(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host === 'tiktok.com' || host.endsWith('.tiktok.com');
  } catch {
    return false;
  }
}

export function youtubeVideoId(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    if (host === 'youtu.be') {
      const id = u.pathname.replace(/^\/+/, '').split('/')[0];
      return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      const v = u.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{6,20}$/.test(v)) return v;
      const match = u.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{6,20})/);
      if (match) return match[1];
    }
  } catch {
    return null;
  }
  return null;
}

export function spotifyEmbedUrl(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    if (u.hostname.toLowerCase() !== 'open.spotify.com') return null;
    const match = u.pathname.match(/^\/(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/);
    if (!match) return null;
    return `https://open.spotify.com/embed/${match[1]}/${match[2]}`;
  } catch {
    return null;
  }
}

async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  timeoutMs = 3500,
  maxRedirects = 3,
): Promise<{ response: Response; finalUrl: string }> {
  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertSafePublicUrl(current);
    const response = (await undiciFetch(current, {
      ...(init as object),
      dispatcher: publicOnly,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'GalinkaPreviewBot/1.0',
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        ...((init.headers as Record<string, string>) || {}),
      },
    })) as unknown as Response;
    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get('location');
      if (!loc) return { response, finalUrl: current };
      current = new URL(loc, current).href;
      continue;
    }
    return { response, finalUrl: current };
  }
  throw new PreviewError('Слишком много перенаправлений.');
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function metaContent(html: string, names: string[]): string | undefined {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["'][^>]*>`,
        'i',
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["'][^>]*>`,
        'i',
      ),
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m?.[1]) return decodeHtml(m[1]);
    }
  }
  return undefined;
}

/** Fetches SSRF-safe link metadata with special handling for YouTube, Spotify and TikTok. */
export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreviewData | null> {
  const url = await assertSafePublicUrl(rawUrl);
  const ytId = youtubeVideoId(url.href);
  if (ytId) {
    const fallback: LinkPreviewData = {
      url: url.href,
      site: 'YouTube',
      title: 'YouTube',
      description: 'Видео на YouTube',
      image: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
      provider: 'youtube',
      embed_url: `https://www.youtube-nocookie.com/embed/${ytId}`,
      vertical: /\/shorts\//.test(url.pathname) || undefined,
    };
    try {
      const { response } = await safeFetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url.href)}&format=json`,
        {},
        3000,
      );
      if (response.ok) {
        const data = (await response.json()) as {
          title?: string;
          author_name?: string;
          thumbnail_url?: string;
        };
        return {
          ...fallback,
          title: data.title?.slice(0, 200) || fallback.title,
          description: data.author_name?.slice(0, 200) || fallback.description,
          image: data.thumbnail_url || fallback.image,
        };
      }
    } catch {
      /* Fallback metadata preserves clean YouTube card when network is unavailable. */
    }
    return fallback;
  }

  const spEmbed = spotifyEmbedUrl(url.href);
  if (spEmbed) {
    const fallback: LinkPreviewData = {
      url: url.href,
      site: 'Spotify',
      title: 'Spotify',
      description: 'Аудио в Spotify',
      provider: 'spotify',
      embed_url: spEmbed,
    };
    try {
      const { response } = await safeFetch(
        `https://open.spotify.com/oembed?url=${encodeURIComponent(url.href)}`,
        {},
        3000,
      );
      if (response.ok) {
        const data = (await response.json()) as {
          title?: string;
          thumbnail_url?: string;
          provider_name?: string;
        };
        return {
          ...fallback,
          title: data.title?.slice(0, 200) || fallback.title,
          image: data.thumbnail_url,
          description: data.provider_name || fallback.description,
        };
      }
    } catch {
      /* Fallback preserves Spotify card offline. */
    }
    return fallback;
  }

  if (isTikTokUrl(url.href)) {
    const fallback: LinkPreviewData = {
      url: url.href,
      site: 'TikTok',
      title: 'Видео из TikTok',
      description: url.hostname,
      provider: 'tiktok',
      vertical: true,
    };
    const player = (id?: string) =>
      id && /^\d{6,25}$/.test(id) ? `https://www.tiktok.com/player/v1/${id}` : undefined;
    fallback.embed_url = player(url.pathname.match(/\/video\/(\d+)/)?.[1]);
    try {
      const { response } = await safeFetch(
        `https://www.tiktok.com/oembed?url=${encodeURIComponent(url.href)}`,
        {},
        3000,
      );
      if (response.ok) {
        const data = (await response.json()) as {
          title?: string;
          author_name?: string;
          thumbnail_url?: string;
          embed_product_id?: string;
        };
        return {
          ...fallback,
          title: data.title?.slice(0, 200) || fallback.title,
          description: data.author_name ? `@${data.author_name}` : fallback.description,
          image: data.thumbnail_url,
          // Short links (vt.tiktok.com) carry no id; oEmbed names the video.
          embed_url: player(data.embed_product_id) ?? fallback.embed_url,
        };
      }
    } catch {
      /* Fallback preserves TikTok link card offline. */
    }
    return fallback;
  }

  try {
    const { response, finalUrl } = await safeFetch(url.href, {}, 3500);
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml'))
      return null;
    const htmlBytes = await readBoundedBuffer(response, 1024 * 1024, true);
    if (!htmlBytes) return null;
    const rawHtml = htmlBytes.toString('utf8');
    const titleTag = rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const title = metaContent(rawHtml, ['og:title', 'twitter:title']) || (titleTag ? decodeHtml(titleTag) : '');
    if (!title) return null;
    const description = metaContent(rawHtml, ['og:description', 'twitter:description', 'description']);
    const site =
      metaContent(rawHtml, ['og:site_name']) || new URL(finalUrl).hostname.replace(/^www\./, '');
    const rawImage = metaContent(rawHtml, ['og:image', 'og:image:url', 'twitter:image']);
    const card = metaContent(rawHtml, ['twitter:card']);
    const imageWidth = Number(metaContent(rawHtml, ['og:image:width']) || 0);
    const thumbnail =
      card === 'summary' || (imageWidth > 0 && imageWidth < 400) ? true : undefined;
    let image: string | undefined;
    if (rawImage) {
      try {
        const resolved = new URL(rawImage, finalUrl);
        if (['http:', 'https:'].includes(resolved.protocol)) image = resolved.href;
      } catch {
        /* Ignore invalid image URLs. */
      }
    }
    return {
      url: url.href,
      site: site.slice(0, 80),
      title: title.slice(0, 200),
      description: description?.slice(0, 320),
      image,
      thumbnail: image ? thumbnail : undefined,
      provider: 'web',
    };
  } catch {
    return null;
  }
}

/** Downloads an external thumbnail safely so the browser client obeys strict self-only CSP. */
export async function fetchPreviewImage(rawUrl: string): Promise<{ buffer: Buffer; mime: string } | null> {
  try {
    const { response } = await safeFetch(rawUrl, { headers: { Accept: 'image/*' } }, 3500);
    if (!response.ok) return null;
    const bytes = await readBoundedBuffer(response, 5 * 1024 * 1024);
    if (!bytes?.length) return null;
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      return { buffer: bytes, mime: 'image/png' };
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
      return { buffer: bytes, mime: 'image/jpeg' };
    if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)))
      return { buffer: bytes, mime: 'image/gif' };
    if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
      return { buffer: bytes, mime: 'image/webp' };
    return null;
  } catch {
    return null;
  }
}

function detectVideoFormat(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length < 16 || buf.length > MAX_TIKTOK_BYTES) return null;
  if (buf.toString('ascii', 4, 8) === 'ftyp') return { ext: 'mp4', mime: 'video/mp4' };
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { ext: 'webm', mime: 'video/webm' };
  }
  return null;
}

/** Reads at most maxBytes; past that returns null, or the first maxBytes when `truncate`. */
async function readBoundedBuffer(
  response: Response,
  maxBytes: number,
  truncate = false,
): Promise<Buffer | null> {
  const lengthHeader = Number(response.headers.get('content-length') || '0');
  if (lengthHeader > maxBytes && !truncate) return null;
  if (!response.body) {
    const buf = Buffer.from(await response.arrayBuffer());
    return buf.length <= maxBytes ? buf : null;
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        if (!truncate) return null;
        chunks.push(Buffer.from(value).subarray(0, value.byteLength - (total - maxBytes)));
        return Buffer.concat(chunks, maxBytes);
      }
      chunks.push(Buffer.from(value));
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks, total);
}

async function downloadVideoStream(
  mediaUrl: string,
  trustedUpstreamOrigin?: string,
  headers: Record<string, string> = {},
): Promise<{ buffer: Buffer; mime: string; ext: string } | null> {
  let response: Response;
  const parsed = new URL(mediaUrl);
  if (trustedUpstreamOrigin && parsed.origin === trustedUpstreamOrigin) {
    response = await fetchUpstream(parsed.href, { headers: { Accept: 'video/mp4,*/*', ...headers } }, 60_000);
  } else {
    ({ response } = await safeFetch(parsed.href, { headers: { Accept: 'video/mp4,*/*', ...headers } }, 60_000));
  }
  if (!response.ok) return null;
  const buf = await readBoundedBuffer(response, MAX_TIKTOK_BYTES);
  if (!buf) return null;
  const format = detectVideoFormat(buf);
  if (!format) return null;
  return { buffer: buf, ...format };
}

function findTikTokRehydrationVideo(html: string): { playUrl?: string; title?: string } | null {
  const universalMatch = html.match(
    /<script[^>]+id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (universalMatch?.[1]) {
    try {
      const data = JSON.parse(universalMatch[1]) as {
        __DEFAULT_SCOPE__?: {
          'webapp.video-detail'?: {
            itemInfo?: {
              itemStruct?: {
                desc?: string;
                video?: { playAddr?: string; downloadAddr?: string };
              };
            };
          };
        };
      };
      const item = data.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
      const playUrl = item?.video?.downloadAddr || item?.video?.playAddr;
      if (playUrl) return { playUrl, title: item?.desc };
    } catch {
      /* Ignore malformed script payload and continue to next extractor. */
    }
  }
  const sigiMatch = html.match(/<script[^>]+id=["']SIGI_STATE["'][^>]*>([\s\S]*?)<\/script>/i);
  if (sigiMatch?.[1]) {
    try {
      const sigi = JSON.parse(sigiMatch[1]) as {
        ItemModule?: Record<string, { desc?: string; video?: { playAddr?: string; downloadAddr?: string } }>;
      };
      const firstItem = sigi.ItemModule ? Object.values(sigi.ItemModule)[0] : undefined;
      const playUrl = firstItem?.video?.downloadAddr || firstItem?.video?.playAddr;
      if (playUrl) return { playUrl, title: firstItem?.desc };
    } catch {
      /* Ignore malformed script payload. */
    }
  }
  return null;
}

/** Downloads a TikTok video via API extractor, direct page extraction, or yt-dlp. */
export async function downloadTikTokVideo(
  rawUrl: string,
): Promise<{ buffer: Buffer; filename: string; mime: string; title: string }> {
  const safeUrl = await assertSafePublicUrl(rawUrl);
  if (!isTikTokUrl(safeUrl.href)) throw new PreviewError('Нужна ссылка на TikTok.', 400);

  // Why each way failed, for the server log: the user only sees one short message.
  const failures: string[] = [];

  // Stage 1: Configured upstream extractor or TikWM API.
  const customApi = process.env.TIKTOK_API_URL?.trim();
  const apiEndpoint = customApi || 'https://www.tikwm.com/api/';
  const trustedOrigin = customApi ? new URL(customApi).origin : undefined;
  type TikWm = {
    code?: number;
    msg?: string;
    data?: {
      hdplay?: string;
      play?: string;
      wmplay?: string;
      hd_size?: number;
      size?: number;
      title?: string;
      images?: string[];
    };
  };
  const askApi = async (): Promise<TikWm> => {
    const requestInit: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ url: safeUrl.href, hd: '1' }).toString(),
    };
    const response = customApi
      ? await fetchUpstream(apiEndpoint, requestInit, 10_000)
      : (await safeFetch(apiEndpoint, requestInit, 10_000)).response;
    if (!response.ok) throw new Error(`api HTTP ${response.status}`);
    return (await response.json()) as TikWm;
  };
  try {
    let payload = await askApi();
    // The free API allows one request a second: a busy moment is worth one more try.
    if (payload.code !== undefined && payload.code !== 0 && /limit|second/i.test(payload.msg ?? '')) {
      await new Promise((done) => setTimeout(done, 1200));
      payload = await askApi();
    }
    const data = payload.data;
    if (data?.images?.length && !data.play)
      throw new PreviewError('Это пост с фотографиями, а не видео.', 422);
    // HD only while it fits; then the regular file, then the watermarked one.
    const candidates = [
      data?.hdplay && (!data.hd_size || data.hd_size <= MAX_TIKTOK_BYTES) ? data.hdplay : null,
      data?.play,
      data?.wmplay,
    ].filter((url, i, all): url is string => Boolean(url) && all.indexOf(url) === i);
    if (!candidates.length) failures.push(`api: ${payload.msg || 'no video'}`);
    for (const candidate of candidates) {
      const video = await downloadVideoStream(new URL(candidate, apiEndpoint).href, trustedOrigin);
      if (video)
        return {
          buffer: video.buffer,
          filename: `tiktok-video.${video.ext}`,
          mime: video.mime,
          title: data?.title?.trim().slice(0, 120) || 'Видео из TikTok',
        };
      failures.push('api: video not downloadable or too large');
    }
  } catch (error) {
    if (error instanceof PreviewError) throw error;
    failures.push(`api: ${(error as Error).message}`);
  }

  // Stage 2: Direct TikTok HTML rehydration JSON extraction (skipped if test/host forces custom API only).
  if (!customApi) {
    try {
      const { response, finalUrl } = await safeFetch(
        safeUrl.href,
        {
          headers: {
            'User-Agent': BROWSER_USER_AGENT,
            'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8',
          },
        },
        8000,
        5,
      );
      if (response.ok) {
        const html = (await readBoundedBuffer(response, 2 * 1024 * 1024, true))?.toString('utf8');
        if (!html) throw new PreviewError('Пустая страница.');
        const extracted = findTikTokRehydrationVideo(html);
        if (extracted?.playUrl) {
          const cookieHeader = response.headers.get('set-cookie');
          const video = await downloadVideoStream(extracted.playUrl, undefined, {
            Referer: finalUrl,
            'User-Agent': BROWSER_USER_AGENT,
            ...(cookieHeader ? { Cookie: cookieHeader.split(',').map((c) => c.split(';')[0]).join('; ') } : {}),
          });
          if (video) {
            return {
              buffer: video.buffer,
              filename: `tiktok-video.${video.ext}`,
              mime: video.mime,
              title: extracted.title?.trim().slice(0, 120) || 'Видео из TikTok',
            };
          }
        }
      }
      failures.push(`page: HTTP ${response.status} or no video in it`);
    } catch (error) {
      failures.push(`page: ${(error as Error).message}`);
    }
  }

  // Stage 3: yt-dlp CLI fallback when installed on the server host.
  const workDir = await mkdtemp(path.join(tmpdir(), 'galinka-tiktok-'));
  try {
    const outPath = path.join(workDir, `${randomUUID()}.mp4`);
    await execFileAsync(
      'yt-dlp',
      [
        '--no-playlist',
        '--no-warnings',
        '--max-filesize',
        '50M',
        '-f',
        'mp4/best[ext=mp4]/best',
        '-o',
        outPath,
        safeUrl.href,
      ],
      { timeout: 90_000, maxBuffer: 1024 * 1024 },
    );
    const buf = await readFile(outPath);
    const format = detectVideoFormat(buf);
    if (format) {
      return {
        buffer: buf,
        filename: `tiktok-video.${format.ext}`,
        mime: format.mime,
        title: 'Видео из TikTok',
      };
    }
    failures.push('yt-dlp: not a video file');
  } catch (error) {
    failures.push(`yt-dlp: ${(error as Error).message.split('\n')[0]}`);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  console.warn('TikTok download failed', safeUrl.href, failures);
  throw new PreviewError(
    'Не удалось скачать видео из TikTok. Проверьте, что ссылка открывается и видео не удалено.',
    502,
  );
}

const BUILTIN_GIFS: GifItem[] = [
  { id: 'dance', title: 'Танцы', keywords: ['танец', 'веселье', 'музыка', 'party', 'dance'] },
  { id: 'applause', title: 'Браво!', keywords: ['браво', 'хлопаю', 'супер', 'applause', 'clap'] },
  { id: 'rocket', title: 'В космос', keywords: ['ракета', 'старт', 'вперед', 'космос', 'rocket'] },
  { id: 'coffee', title: 'Утренний кофе', keywords: ['кофе', 'утро', 'доброе', 'coffee', 'morning'] },
  { id: 'heart', title: 'Сердечко', keywords: ['любовь', 'сердце', 'heart', 'love'] },
  { id: 'confetti', title: 'Праздник', keywords: ['праздник', 'салют', 'ура', 'confetti', 'party'] },
  { id: 'cat-type', title: 'Котик печатает', keywords: ['кот', 'работаю', 'чат', 'cat', 'typing'] },
  { id: 'thumb', title: 'Топчик', keywords: ['класс', 'ок', 'лайк', 'cool', 'ok'] },
];

/** Searches Tenor / configured GIF API when available, falling back to the built-in animated set. */
export async function searchGifs(query: string, limit = 18): Promise<GifItem[]> {
  const q = query.trim().slice(0, 100);
  const boundedLimit = Math.max(1, Math.min(30, limit));

  const customGifApi = process.env.GIF_API_URL?.trim();
  if (customGifApi) {
    try {
      const target = new URL(customGifApi);
      if (q) target.searchParams.set('q', q);
      target.searchParams.set('limit', String(boundedLimit));
      const response = await fetchUpstream(target.href, { headers: { Accept: 'application/json' } }, 5000);
      if (response.ok) {
        const payload = (await response.json()) as {
          items?: Array<{ id?: string; title?: string; previewUrl?: string; url?: string }>;
        };
        if (Array.isArray(payload.items)) {
          return payload.items
            .filter((item): item is { id: string; title?: string; previewUrl?: string; url?: string } => Boolean(item?.id))
            .slice(0, boundedLimit)
            .map((item) => ({
              id: String(item.id).slice(0, 64),
              title: String(item.title || 'GIF').slice(0, 80),
              previewUrl: item.previewUrl || item.url,
              keywords: [],
            }));
        }
      }
    } catch {
      /* Fall back to Tenor or built-in animated GIFs. */
    }
  }

  const giphyKey = process.env.GIPHY_API_KEY?.trim();
  if (giphyKey) {
    try {
      const target = new URL(`https://api.giphy.com/v1/gifs/${q ? 'search' : 'trending'}`);
      target.searchParams.set('api_key', giphyKey);
      target.searchParams.set('limit', String(boundedLimit));
      target.searchParams.set('rating', 'pg-13');
      target.searchParams.set('lang', 'ru');
      if (q) target.searchParams.set('q', q);
      const response = await fetch(target.href, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const data = (await response.json()) as {
          data?: Array<{
            id: string;
            title?: string;
            images?: { fixed_width?: { url?: string }; downsized?: { url?: string } };
          }>;
        };
        if (Array.isArray(data.data) && data.data.length > 0)
          return data.data.map((g) => ({
            id: g.id,
            title: (g.title || 'GIF').slice(0, 80),
            previewUrl: g.images?.fixed_width?.url || g.images?.downsized?.url,
            keywords: [],
          }));
      }
    } catch {
      /* Fall back to Tenor or the built-in set. */
    }
  }

  const tenorKey = process.env.TENOR_API_KEY?.trim();
  if (tenorKey) {
    try {
      const endpoint = q ? 'search' : 'featured';
      const target = new URL(`https://tenor.googleapis.com/v2/${endpoint}`);
      target.searchParams.set('key', tenorKey);
      target.searchParams.set('limit', String(boundedLimit));
      target.searchParams.set('media_filter', 'tinygif,gif');
      target.searchParams.set('locale', 'ru_RU');
      if (q) target.searchParams.set('q', q);
      const response = await fetch(target.href, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const data = (await response.json()) as {
          results?: Array<{
            id: string;
            content_description?: string;
            media_formats?: { tinygif?: { url?: string }; gif?: { url?: string } };
          }>;
        };
        if (Array.isArray(data.results) && data.results.length > 0) {
          return data.results.map((r) => ({
            id: r.id,
            title: (r.content_description || 'GIF').slice(0, 80),
            previewUrl: r.media_formats?.tinygif?.url || r.media_formats?.gif?.url,
            keywords: [],
          }));
        }
      }
    } catch {
      /* Fall back to built-in animated scenes. */
    }
  }

  const normalized = q.toLowerCase();
  if (!normalized) return BUILTIN_GIFS.slice(0, boundedLimit);
  return BUILTIN_GIFS.filter(
    (g) =>
      g.title.toLowerCase().includes(normalized) ||
      g.keywords.some((kw) => kw.toLowerCase().includes(normalized)),
  ).slice(0, boundedLimit);
}
