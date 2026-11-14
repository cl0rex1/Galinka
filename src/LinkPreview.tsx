import { useState } from 'react';
import { Play } from 'lucide-react';
import { API_BASE } from './api';
import type { LinkPreview } from './types';

const picture = (url: string) =>
  url.startsWith('data:') ? url : `${API_BASE}/link-preview/image?url=${encodeURIComponent(url)}`;

/** Starts the player at once: the tap on the cover was the request to watch. */
function playing(url: string) {
  const player = new URL(url);
  player.searchParams.set('autoplay', '1');
  if (player.hostname.includes('youtube')) {
    player.searchParams.set('rel', '0');
    player.searchParams.set('playsinline', '1');
  }
  return player.href;
}

/**
 * A link card as in Telegram: an accent bar, the site, the title and a short description.
 * Videos play right in the chat from their cover; Spotify shows its player straight away.
 */
export function LinkPreviewCard({ preview }: { preview: LinkPreview }) {
  const [started, setStarted] = useState(false);
  const spotify = preview.provider === 'spotify' && preview.embed_url;
  const video = !spotify && preview.embed_url;
  const thumbnail = preview.thumbnail && !video && preview.image;
  const text = (
    <a className="link-preview-text" href={preview.url} target="_blank" rel="noopener noreferrer">
      <span className="link-preview-site">{preview.site}</span>
      {preview.title && preview.title !== preview.site && <strong>{preview.title}</strong>}
      {preview.description && preview.description !== preview.site && (
        <span className="link-preview-description">{preview.description}</span>
      )}
    </a>
  );
  return (
    <div
      className={`link-preview ${preview.provider ?? 'web'} ${preview.vertical ? 'vertical' : ''} ${thumbnail ? 'with-thumbnail' : ''}`}
    >
      {thumbnail ? (
        <div className="link-preview-row">
          {text}
          <img className="link-preview-thumb" src={picture(preview.image!)} alt="" loading="lazy" />
        </div>
      ) : (
        text
      )}
      {spotify ? (
        <iframe
          className="link-preview-player spotify"
          src={preview.embed_url}
          title={preview.title}
          // YouTube refuses to play without knowing the embedding site.
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-popups"
          allow="encrypted-media; clipboard-write"
          loading="lazy"
        />
      ) : video && started ? (
        <iframe
          className="link-preview-player"
          src={playing(preview.embed_url!)}
          title={preview.title}
          // YouTube refuses to play without knowing the embedding site.
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      ) : video ? (
        <button
          type="button"
          className="link-preview-media"
          aria-label={`Смотреть: ${preview.title}`}
          onClick={() => setStarted(true)}
        >
          {preview.image && <img src={picture(preview.image)} alt="" loading="lazy" />}
          <span className="link-preview-play" aria-hidden="true">
            <Play size={26} fill="currentColor" />
          </span>
        </button>
      ) : (
        preview.image &&
        !thumbnail && (
          <a
            className="link-preview-media"
            href={preview.url}
            target="_blank"
            rel="noopener noreferrer"
            tabIndex={-1}
          >
            <img src={picture(preview.image)} alt="" loading="lazy" />
          </a>
        )
      )}
    </div>
  );
}
