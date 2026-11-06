import { Fragment, memo, type ReactNode } from 'react';

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

// Render text as text; only explicit HTTP(S) addresses become links.
export const MessageText = memo(function MessageText({
  text,
  highlight,
}: {
  text: string;
  highlight?: string;
}) {
  const parts: ReactNode[] = [];
  let position = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const start = match.index;
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
        <Fragment key={`t${position}`}>{marked(text.slice(position, start), highlight)}</Fragment>,
      );
      parts.push(
        <a key={start} href={url.href} target="_blank" rel="noopener noreferrer">
          {address}
        </a>,
      );
      position = start + address.length;
    } catch {
      // Invalid addresses stay part of the next text segment.
    }
  }
  parts.push(<Fragment key="end">{marked(text.slice(position), highlight)}</Fragment>);
  return <p className="message-text">{parts}</p>;
});
