import { useState } from 'react';
import { CalendarDays, Clock3, File, Image, Link2, Mic, Video } from 'lucide-react';
import { Avatar } from './Avatar';
import { fileLabel } from './MediaAttachment';
import { marked } from './MessageText';
import { plural } from './ui';
import type { Chat, Person, SearchHit } from './types';

const timeFormatter = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' });
const weekdayFormatter = new Intl.DateTimeFormat('ru', { weekday: 'short' });
const dateFormatter = new Intl.DateTimeFormat('ru', {
  day: 'numeric',
  month: 'numeric',
  year: '2-digit',
});
/** Chat list time: hours today, weekday within a week, then a short date. */
export const listTime = (value: string) => {
  const date = new Date(value);
  const age = Date.now() - date.getTime();
  if (date.toDateString() === new Date().toDateString()) return timeFormatter.format(date);
  return age < 6 * 86400_000 ? weekdayFormatter.format(date) : dateFormatter.format(date);
};
/** The part of a long message around the match, so the match is visible in two lines. */
function snippet(body: string, query: string) {
  const at = query ? body.toLowerCase().indexOf(query.toLowerCase()) : -1;
  return at > 40 ? `…${body.slice(at - 30)}` : body;
}

export type SearchType = 'photo' | 'video' | 'voice' | 'file' | 'link';
/** Narrowing a search to an author, a kind of message, and days (YYYY-MM-DD, local). */
export type SearchFilters = { from?: string; type?: SearchType; after?: string; before?: string };
export const hasFilters = (filters: SearchFilters) =>
  Boolean(filters.from || filters.type || filters.after || filters.before);
const TYPES: { id: SearchType; label: string; icon: typeof Image }[] = [
  { id: 'photo', label: 'Фото', icon: Image },
  { id: 'video', label: 'Видео', icon: Video },
  { id: 'file', label: 'Файлы', icon: File },
  { id: 'voice', label: 'Голосовые', icon: Mic },
  { id: 'link', label: 'Ссылки', icon: Link2 },
];

/** The query string for GET /search; days become the user's local midnight. */
export function searchParams(query: string, filters: SearchFilters) {
  const params = new URLSearchParams();
  if (query.length >= 2) params.set('q', query);
  if (filters.from) params.set('from', filters.from);
  if (filters.type) params.set('type', filters.type);
  if (filters.after) params.set('after', new Date(`${filters.after}T00:00`).toISOString());
  // "По" a day includes that whole day.
  if (filters.before) {
    const end = new Date(`${filters.before}T00:00`);
    end.setDate(end.getDate() + 1);
    params.set('before', end.toISOString());
  }
  return params.toString();
}

// Recent searches stay on this device, per account, like the last opened chats in Telegram's search.
type Recent = { queries: string[]; chats: string[] };
const recentKey = (userId: string) => `galinka-recent-search:${userId}`;
export function readRecent(userId: string): Recent {
  try {
    const saved = JSON.parse(localStorage.getItem(recentKey(userId)) || '{}');
    return {
      queries: Array.isArray(saved.queries) ? saved.queries.slice(0, 8) : [],
      chats: Array.isArray(saved.chats) ? saved.chats.slice(0, 8) : [],
    };
  } catch {
    return { queries: [], chats: [] };
  }
}
/** Remember what was searched and which chat it led to; newest first, no repeats. */
export function rememberSearch(userId: string, query: string, chatId?: string) {
  const recent = readRecent(userId);
  const queries = query.trim().length >= 2
    ? [query.trim(), ...recent.queries.filter((item) => item !== query.trim())]
    : recent.queries;
  const chats = chatId ? [chatId, ...recent.chats.filter((id) => id !== chatId)] : recent.chats;
  try {
    localStorage.setItem(
      recentKey(userId),
      JSON.stringify({ queries: queries.slice(0, 8), chats: chats.slice(0, 8) }),
    );
  } catch {
    /* Private mode: nothing to remember. */
  }
}
export function forgetRecent(userId: string) {
  try {
    localStorage.removeItem(recentKey(userId));
  } catch {
    /* Nothing stored. */
  }
}

function Filters({
  filters,
  people,
  me,
  onChange,
}: {
  filters: SearchFilters;
  people: Person[];
  me: Person;
  onChange: (filters: SearchFilters) => void;
}) {
  const set = (change: SearchFilters) => onChange({ ...filters, ...change });
  return (
    <div className="search-filters" role="group" aria-label="Фильтры поиска">
      <div className="search-types">
        {TYPES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={filters.type === id}
            className={filters.type === id ? 'selected' : ''}
            onClick={() => set({ type: filters.type === id ? undefined : id })}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>
      <div className="search-refine">
        <select
          aria-label="Автор"
          value={filters.from ?? ''}
          onChange={(event) => set({ from: event.target.value || undefined })}
        >
          <option value="">Любой автор</option>
          <option value="me">Я ({me.name})</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
        <label className="search-date">
          <CalendarDays size={14} aria-hidden="true" />
          <span>с</span>
          <input
            type="date"
            aria-label="С даты"
            value={filters.after ?? ''}
            max={filters.before}
            onChange={(event) => set({ after: event.target.value || undefined })}
          />
        </label>
        <label className="search-date">
          <span>по</span>
          <input
            type="date"
            aria-label="По дату"
            value={filters.before ?? ''}
            min={filters.after}
            onChange={(event) => set({ before: event.target.value || undefined })}
          />
        </label>
        {hasFilters(filters) && (
          <button type="button" className="search-reset" onClick={() => onChange({})}>
            Сбросить
          </button>
        )}
      </div>
    </div>
  );
}

/** Sidebar search, as in Telegram: matching chats, people to write to, messages from all chats. */
export function SearchResults({
  query,
  chats,
  found,
  me,
  filters,
  onFilters,
  onQuery,
  onChat,
  onPerson,
  onMessage,
}: {
  query: string;
  chats: Chat[];
  found: { messages: SearchHit[]; people: Person[] } | null;
  me: Person;
  filters: SearchFilters;
  onFilters: (filters: SearchFilters) => void;
  onQuery: (query: string) => void;
  onChat: (id: string) => void;
  onPerson: (person: Person) => void;
  onMessage: (hit: SearchHit) => void;
}) {
  const [, setCleared] = useState(0);
  const filtered = hasFilters(filters);
  const lower = query.toLowerCase();
  // With a filter on, the search is about messages; chats and people by name would be noise.
  const matching =
    filtered || !query
      ? []
      : chats.filter(
          (chat) =>
            chat.title.toLowerCase().includes(lower) ||
            chat.peer?.username.toLowerCase().includes(lower),
        );
  const people = filtered
    ? []
    : (found?.people ?? []).filter(
        (person) => !chats.some((chat) => chat.kind === 'direct' && chat.peer?.id === person.id),
      );
  const messages = (found?.messages ?? []).filter((hit) =>
    chats.some((chat) => chat.id === hit.chat_id),
  );
  const searching = query.length >= 2 || filtered;
  const nothing = found && !matching.length && !people.length && !messages.length;
  const authors = chats
    .filter((chat) => chat.kind === 'direct' && chat.peer)
    .map((chat) => chat.peer!)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const recent = !query && !filtered ? readRecent(me.id) : null;
  const recentChats = (recent?.chats ?? [])
    .map((id) => chats.find((chat) => chat.id === id))
    .filter((chat): chat is Chat => Boolean(chat));
  return (
    <div className="chat-list search-results" aria-label="Результаты поиска">
      <Filters filters={filters} people={authors} me={me} onChange={onFilters} />
      {recent && (recentChats.length > 0 || recent.queries.length > 0) && (
        <div className="search-recent">
          <div className="results-heading recent-heading">
            <h3>Недавние</h3>
            <button
              type="button"
              onClick={() => {
                forgetRecent(me.id);
                setCleared((n) => n + 1);
              }}
            >
              Очистить
            </button>
          </div>
          {recentChats.length > 0 && (
            <div className="recent-chats">
              {recentChats.map((chat) => (
                <button key={chat.id} type="button" onClick={() => onChat(chat.id)}>
                  <Avatar chat={chat} person={chat.peer} />
                  <span>{chat.title}</span>
                </button>
              ))}
            </div>
          )}
          {recent.queries.map((item) => (
            <button
              key={item}
              type="button"
              className="search-row recent-query"
              onClick={() => onQuery(item)}
            >
              <Clock3 size={17} />
              <span>{item}</span>
            </button>
          ))}
        </div>
      )}
      {recent && !recentChats.length && !recent.queries.length && (
        <p className="list-empty">Найдите чат, человека или сообщение, или выберите фильтр</p>
      )}
      {matching.length > 0 && <h3 className="results-heading">Чаты</h3>}
      {matching.map((chat) => (
        <button key={chat.id} className="search-row" onClick={() => onChat(chat.id)}>
          <Avatar chat={chat} person={chat.peer} size="small" />
          <span>
            <strong>{marked(chat.title, query)}</strong>
            <small>
              {chat.kind === 'direct'
                ? `@${chat.peer?.username}`
                : chat.kind === 'group'
                  ? `${chat.member_count} ${plural(chat.member_count, 'участник', 'участника', 'участников')}`
                  : 'Заметки'}
            </small>
          </span>
        </button>
      ))}
      {people.length > 0 && <h3 className="results-heading">Люди</h3>}
      {people.map((person) => (
        <button key={person.id} className="search-row" onClick={() => onPerson(person)}>
          <Avatar person={person} size="small" />
          <span>
            <strong>{marked(person.name, query)}</strong>
            <small>@{marked(person.username, query)}</small>
          </span>
        </button>
      ))}
      {messages.length > 0 && <h3 className="results-heading">Сообщения</h3>}
      {messages.map((hit) => {
        const chat = chats.find((item) => item.id === hit.chat_id)!;
        const text = hit.body || (hit.file ? fileLabel(hit.file.name, hit.file.as_file) : '');
        return (
          <button key={hit.id} className="search-row message-hit" onClick={() => onMessage(hit)}>
            <Avatar chat={chat} person={chat.peer} size="small" />
            <span>
              <span className="hit-title">
                <strong>{chat.title}</strong>
                <time>{listTime(hit.created_at)}</time>
              </span>
              <small>
                {hit.sender_id === me.id
                  ? 'Вы: '
                  : chat.kind === 'group'
                    ? `${hit.sender_name}: `
                    : ''}
                {marked(snippet(text, query), query)}
              </small>
            </span>
          </button>
        );
      })}
      {!found && searching && (
        <p className="list-empty" role="status">
          Ищем…
        </p>
      )}
      {nothing && <p className="list-empty">Ничего не найдено</p>}
      {query.length === 1 && !filtered && !matching.length && (
        <p className="list-empty">Введите ещё букву, чтобы искать по сообщениям</p>
      )}
      {filtered && found && messages.length === 50 && (
        <p className="list-empty">Показаны 50 последних. Уточните запрос или даты.</p>
      )}
      {(query || filtered) && (
        <span className="sr-only" aria-live="polite">
          {found ? `Найдено сообщений: ${messages.length}` : ''}
        </span>
      )}
    </div>
  );
}
