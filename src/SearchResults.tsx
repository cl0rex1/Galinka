import { Avatar } from './Avatar';
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
  const at = body.toLowerCase().indexOf(query.toLowerCase());
  return at > 40 ? `…${body.slice(at - 30)}` : body;
}

/** Sidebar search, as in Telegram: matching chats, people to write to, messages from all chats. */
export function SearchResults({
  query,
  chats,
  found,
  me,
  onChat,
  onPerson,
  onMessage,
}: {
  query: string;
  chats: Chat[];
  found: { messages: SearchHit[]; people: Person[] } | null;
  me: Person;
  onChat: (id: string) => void;
  onPerson: (person: Person) => void;
  onMessage: (hit: SearchHit) => void;
}) {
  const lower = query.toLowerCase();
  const matching = chats.filter(
    (chat) =>
      chat.title.toLowerCase().includes(lower) || chat.peer?.username.toLowerCase().includes(lower),
  );
  const people = (found?.people ?? []).filter(
    (person) => !chats.some((chat) => chat.kind === 'direct' && chat.peer?.id === person.id),
  );
  const messages = (found?.messages ?? []).filter((hit) =>
    chats.some((chat) => chat.id === hit.chat_id),
  );
  const nothing = found && !matching.length && !people.length && !messages.length;
  return (
    <div className="chat-list search-results" aria-label="Результаты поиска">
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
                {marked(snippet(hit.body, query), query)}
              </small>
            </span>
          </button>
        );
      })}
      {!found && query.length >= 2 && (
        <p className="list-empty" role="status">
          Ищем…
        </p>
      )}
      {nothing && <p className="list-empty">Ничего не найдено</p>}
      {query.length < 2 && !matching.length && (
        <p className="list-empty">Введите ещё букву, чтобы искать по сообщениям</p>
      )}
    </div>
  );
}
