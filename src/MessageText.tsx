import type { ReactNode } from 'react';

// Render text as text; only explicit HTTP(S) addresses become links.
export function MessageText({ text }: { text: string }) {
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
      parts.push(text.slice(position, start));
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
  parts.push(text.slice(position));
  return <p className="message-text">{parts}</p>;
}
