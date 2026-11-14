import { createContext, Fragment, memo, useContext, useState, type ReactNode } from 'react';
import { GifArtwork, StickerArtwork } from './EmojiPicker';
import { animatedCode, codeEmoji, isStickerCode, Sticker } from './Sticker';

/** Wrap every case-insensitive occurrence of `query` in <mark>, for search results. */
export function marked(text: string, query?: string): ReactNode {
  const needle = query?.trim().toLowerCase();
  if (!needle) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let at = 0;
  for (let i = lower.indexOf(needle); i >= 0; i = lower.indexOf(needle, i + needle.length)) {
    parts.push(text.slice(at, i), <mark key={i}>{text.slice(i, i + needle.length)}</mark>);
    at = i + needle.length;
  }
  parts.push(text.slice(at));
  return parts;
}

/**
 * Message text without formatting marks, for one-line previews. Spoilers stay hidden.
 * Keep in sync with plainText in server/push.ts.
 */
export const plainText = (text: string) =>
  text
    .replace(
      /\[sticker:([0-9a-f]{2,6}(?:_[0-9a-f]{2,6})*)\]/g,
      (_, code: string) => `${codeEmoji(code)} Стикер`,
    )
    .replace(/\[sticker:[^:\]]+:([^\]]+)\]/g, 'Стикер: $1')
    .replace(/\[sticker:[^\]]+\]/g, 'Стикер')
    .replace(/\[gif:[^|\]]+\|[^|\]]+\|([^\]]+)\]/g, 'GIF: $1')
    .replace(/\[gif:[^:\]]+:([^\]]+)\]/g, 'GIF: $1')
    .replace(/\[gif:[^\]]+\]/g, 'GIF')
    .replace(/\|\|(.+?)\|\|/gs, '•••')
    .replace(/\*\*|__|~~|```|`/g, '')
    .replace(/^> /gm, '');

type Leaf = (text: string, key: string) => ReactNode;

/** The viewer's own login, so a mention of them can be set apart from the rest. */
export const SelfContext = createContext('');
/** Does the text name this login as @login? Same rule as the server's mention count. */
export const mentionsUser = (text: string, username: string) =>
  !!username && new RegExp(`(^|[^a-z0-9_@])@${username}($|[^a-z0-9_])`, 'i').test(text);

// Render addresses and @usernames without interpreting message text as HTML.
function linkify(
  text: string,
  key: string,
  highlight?: string,
  onMention?: (username: string) => void,
  self?: string,
): ReactNode[] {
  const parts: ReactNode[] = [];
  let position = 0;
  for (const match of text.matchAll(
    /https?:\/\/[^\s<>"']+|(?<![\p{L}\p{N}_.@])@(все|all)(?![\p{L}\p{N}_@])|(?<![\w.@])@([a-z0-9_]{3,24})(?![\w@])/giu,
  )) {
    const start = match.index;
    if (match[1]) {
      // @все: nobody's profile to open, but it reads as a mention.
      parts.push(
        <Fragment key={`${key}t${position}`}>
          {marked(text.slice(position, start), highlight)}
        </Fragment>,
        <span key={`${key}a${start}`} className="message-mention all">
          {marked(match[0], highlight)}
        </span>,
      );
      position = start + match[0].length;
      continue;
    }
    if (match[2]) {
      const username = match[2].toLowerCase();
      parts.push(
        <Fragment key={`${key}t${position}`}>
          {marked(text.slice(position, start), highlight)}
        </Fragment>,
        <a
          key={`${key}m${start}`}
          href={`/app?u=${encodeURIComponent(username)}`}
          className={`message-mention ${username === self ? 'me' : ''}`}
          onClick={
            onMention
              ? (event) => {
                  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  onMention(username);
                }
              : undefined
          }
        >
          {marked(match[0], highlight)}
        </a>,
      );
      position = start + match[0].length;
      continue;
    }
    let address = match[0].replace(/[.,!?;:»”]+$/, '');
    for (const [open, close] of [
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
    ]) {
      while (address.endsWith(close) && address.split(close).length > address.split(open).length)
        address = address.slice(0, -1);
    }
    try {
      const url = new URL(address);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      parts.push(
        <Fragment key={`${key}t${position}`}>
          {marked(text.slice(position, start), highlight)}
        </Fragment>,
        <a key={`${key}a${start}`} href={url.href} target="_blank" rel="noopener noreferrer">
          {address}
        </a>,
      );
      position = start + address.length;
    } catch {
      // Invalid addresses stay part of the next text segment.
    }
  }
  parts.push(<Fragment key={`${key}end`}>{marked(text.slice(position), highlight)}</Fragment>);
  return parts;
}

function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  if (shown) return <span className="spoiler shown">{children}</span>;
  return (
    <span
      className="spoiler"
      role="button"
      tabIndex={0}
      aria-label="Скрытый текст, нажмите, чтобы показать"
      onClick={(event) => {
        event.stopPropagation();
        setShown(true);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setShown(true);
        }
      }}
    >
      <span aria-hidden="true">{children}</span>
    </span>
  );
}

// Addresses are matched too, only so that marks inside them (a__b) stay part of the link.
const inlineMarks =
  /`([^`\n]+)`|https?:\/\/[^\s<>"']+|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\|\|(.+?)\|\|/gs;

/** **bold**, __italic__, ~~strike~~, `code` and ||spoiler||, nested except inside code. */
function formatInline(text: string, key: string, leaf: Leaf): ReactNode[] {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(inlineMarks)) {
    const [whole, code, bold, italic, strike, spoiler] = match;
    if (whole.startsWith('http')) continue;
    const start = match.index;
    const k = `${key}f${start}`;
    parts.push(leaf(text.slice(at, start), `${key}t${start}`));
    if (code !== undefined) parts.push(<code key={k}>{code}</code>);
    else if (bold) parts.push(<strong key={k}>{formatInline(bold, k, leaf)}</strong>);
    else if (italic) parts.push(<em key={k}>{formatInline(italic, k, leaf)}</em>);
    else if (strike) parts.push(<s key={k}>{formatInline(strike, k, leaf)}</s>);
    else parts.push(<Spoiler key={k}>{formatInline(spoiler, k, leaf)}</Spoiler>);
    at = start + whole.length;
  }
  parts.push(leaf(text.slice(at), `${key}e`));
  return parts;
}

type Block = { kind: 'text' | 'quote' | 'code'; text: string };
/** Lines in ``` fences are code, lines starting with "> " a quote, the rest text. */
function blocks(text: string): Block[] {
  const lines = text.split('\n');
  const result: Block[] = [];
  const add = (kind: Block['kind'], line: string) => {
    const last = result.at(-1);
    if (last?.kind === kind && kind !== 'code') last.text += `\n${line}`;
    else result.push({ kind, text: line });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const end = lines.findIndex((other, j) => j > i && other.trimEnd() === '```');
      if (end > i) {
        result.push({ kind: 'code', text: lines.slice(i + 1, end).join('\n') });
        i = end;
        continue;
      }
    }
    if (line.startsWith('> ')) add('quote', line.slice(2));
    else add('text', line);
  }
  return result;
}

const segmenter = new Intl.Segmenter('ru', { granularity: 'grapheme' });
const graphemes = (text: string) => [...segmenter.segment(text)].length;
const onlyEmoji =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|[\u200d\ufe0f\u20e3\s])+$/u;

/**
 * Messages drawn without a bubble, as in Telegram: a sticker, a GIF, or one to three emoji
 * shown large.
 */
export function bareKind(text: string): 'sticker' | 'gif' | 'emoji' | null {
  const trimmed = text.trim();
  if (/^\[sticker:[^\]]+\]$/.test(trimmed)) return 'sticker';
  if (/^\[gif:[^\]]+\]$/.test(trimmed)) return 'gif';
  if (
    trimmed &&
    onlyEmoji.test(trimmed) &&
    /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(trimmed) &&
    graphemes(trimmed.replace(/\s/g, '')) <= 3
  )
    return 'emoji';
  return null;
}

export const MessageText = memo(function MessageText({
  text,
  highlight,
  onMention,
}: {
  text: string;
  highlight?: string;
  onMention?: (username: string) => void;
}) {
  const self = useContext(SelfContext);
  const trimmed = text.trim();
  const kind = bareKind(text);
  if (kind === 'emoji') {
    const code = animatedCode(trimmed);
    if (code) return <Sticker code={code} size={112} />;
    return <p className={`jumbo-emoji n${graphemes(trimmed)}`}>{trimmed}</p>;
  }
  const animated = /^\[sticker:([0-9a-f_]+)\]$/.exec(trimmed);
  if (animated && isStickerCode(animated[1])) return <Sticker code={animated[1]} size={168} />;
  const stickerMatch = /^\[sticker:([^:\]]+)(?::([^\]]+))?\]$/.exec(trimmed);
  if (stickerMatch) {
    return (
      <figure className="message-sticker">
        <StickerArtwork id={stickerMatch[1]} label={stickerMatch[2]} size={136} />
        {stickerMatch[2] && <figcaption className="sticker-label">{stickerMatch[2]}</figcaption>}
      </figure>
    );
  }
  const gifUrlMatch = /^\[gif:([^|:\]]+)\|([^|\]]+)\|([^\]]*)\]$/.exec(trimmed);
  if (gifUrlMatch) {
    let decodedUrl: string | undefined;
    try {
      decodedUrl = decodeURIComponent(gifUrlMatch[2]);
    } catch {
      decodedUrl = undefined;
    }
    return (
      <figure className="message-gif">
        <GifArtwork id={gifUrlMatch[1]} title={gifUrlMatch[3] || 'GIF'} previewUrl={decodedUrl} />
      </figure>
    );
  }
  const gifMatch = /^\[gif:([^:\]]+)(?::([^\]]+))?\]$/.exec(trimmed);
  if (gifMatch) {
    return (
      <figure className="message-gif">
        <GifArtwork id={gifMatch[1]} title={gifMatch[2]} />
      </figure>
    );
  }
  const leaf: Leaf = (part, key) => linkify(part, key, highlight, onMention, self);
  const parts = blocks(text);
  // Plain text stays one inline paragraph, so the time can sit at the end of its last line.
  if (parts.every((part) => part.kind === 'text'))
    return <p className="message-text">{formatInline(text, 'p', leaf)}</p>;
  return (
    <div className="message-text">
      {parts.map((part, index) =>
        part.kind === 'code' ? (
          <pre key={index}>
            <code>{part.text}</code>
          </pre>
        ) : part.kind === 'quote' ? (
          <blockquote key={index}>{formatInline(part.text, `q${index}`, leaf)}</blockquote>
        ) : (
          <span key={index} className="message-paragraph">
            {formatInline(part.text, `p${index}`, leaf)}
          </span>
        ),
      )}
    </div>
  );
});
