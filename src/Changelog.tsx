import { Fragment, type ReactNode } from 'react';
import source from '../CHANGELOG.md?raw';
import { ThemeToggle } from './theme';

type Release = { version: string; date: string; groups: { title: string; items: string[] }[] };
// CHANGELOG.md is the single source for GitHub release notes and this page.
export function parseChangelog(text: string): Release[] {
  const releases: Release[] = [];
  for (const line of text.split('\n')) {
    const release = line.match(/^## (\S+) — (\S+)/);
    if (release) releases.push({ version: release[1], date: release[2], groups: [] });
    const current = releases.at(-1);
    if (!current) continue;
    if (line.startsWith('### ')) current.groups.push({ title: line.slice(4).trim(), items: [] });
    else if (line.startsWith('- ')) current.groups.at(-1)?.items.push(line.slice(2).trim());
  }
  return releases;
}
const inline = (text: string): ReactNode[] =>
  text
    .split(/(`[^`]+`)/)
    .map((part, index) =>
      part.startsWith('`') ? (
        <code key={index}>{part.slice(1, -1)}</code>
      ) : (
        <Fragment key={index}>{part}</Fragment>
      ),
    );
const dateFormatter = new Intl.DateTimeFormat('ru', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export default function Changelog() {
  const releases = parseChangelog(source);
  return (
    <div className="changelog-page">
      <header className="changelog-nav">
        <a className="brand" href="/">
          <img src="/icon.svg" alt="" />
          Galinka
        </a>
        <a className="text-button" href="/app">
          Открыть
        </a>
        <ThemeToggle />
      </header>
      <main>
        <h1>История изменений</h1>
        {releases.map((release) => (
          <article key={release.version} id={`v${release.version}`}>
            <h2>
              {release.version}
              <time dateTime={release.date}>{dateFormatter.format(new Date(release.date))}</time>
            </h2>
            {release.groups.map((group) => (
              <section key={group.title}>
                <h3>{group.title}</h3>
                <ul>
                  {group.items.map((item) => (
                    <li key={item}>{inline(item)}</li>
                  ))}
                </ul>
              </section>
            ))}
          </article>
        ))}
        <p className="muted">
          Установщики — на{' '}
          <a href="https://github.com/cl0rex1/Galinka/releases">странице релизов GitHub</a>.
        </p>
      </main>
    </div>
  );
}
