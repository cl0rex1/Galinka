import type { Person, Chat, Message } from './types';
const self: Person = { id: 'demo-me', name: 'Саша', username: 'sasha', color: 0 };
const people: Person[] = [
  self,
  { id: 'anya', name: 'Аня', username: 'anya', color: 1 },
  { id: 'max', name: 'Макс', username: 'max', color: 2 },
  { id: 'dasha', name: 'Даша', username: 'dasha', color: 3 },
  { id: 'ilya', name: 'Илья', username: 'ilya', color: 4 },
];
const bot: Person = { id: 'nelya', name: 'Неля', username: 'nelya', color: 5 };
function seed() {
  const chats: Chat[] = [
    {
      id: 'weekend',
      kind: 'group',
      title: 'На выходные',
      owner_id: self.id,
      nelya: true,
      member_count: 5,
      peer: null,
      unread: 0,
      created_at: new Date().toISOString(),
      last_message: null,
    },
    {
      id: 'anya-chat',
      kind: 'direct',
      title: 'Аня',
      owner_id: self.id,
      nelya: false,
      member_count: 2,
      peer: people[1],
      unread: 2,
      created_at: new Date().toISOString(),
      last_message: null,
    },
    {
      id: 'home',
      kind: 'group',
      title: 'Свои люди',
      owner_id: self.id,
      nelya: false,
      member_count: 5,
      peer: null,
      unread: 3,
      created_at: new Date().toISOString(),
      last_message: null,
    },
    {
      id: 'max-chat',
      kind: 'direct',
      title: 'Макс',
      owner_id: self.id,
      nelya: false,
      member_count: 2,
      peer: people[2],
      unread: 0,
      created_at: new Date().toISOString(),
      last_message: null,
    },
    {
      id: 'saved',
      kind: 'saved',
      title: 'Избранное',
      owner_id: self.id,
      nelya: true,
      member_count: 1,
      peer: null,
      unread: 0,
      created_at: new Date().toISOString(),
      last_message: null,
    },
  ];
  const messages: Message[] = [];
  const add = (
    chat: string,
    sender: Person,
    body: string,
    minutes: number,
    reactions: Message['reactions'] = [],
  ) =>
    messages.push({
      id: crypto.randomUUID(),
      chat_id: chat,
      sender_id: sender.id === 'nelya' ? null : sender.id,
      sender,
      body,
      created_at: new Date(Date.now() - minutes * 60000).toISOString(),
      nonce: crypto.randomUUID(),
      file: null,
      reactions,
    });
  add('weekend', people[1], 'Ребят, а давайте на выходных куда-нибудь из города? 🌿', 48);
  add('weekend', people[2], 'Я за! Хочется гор, тишины и никакой работы.', 47);
  add('weekend', self, 'У меня как раз есть маршрут. Несложный, но с очень красивым видом.', 45);
  add(
    'weekend',
    self,
    'Предлагаю в субботу. Встретимся в 9 у кофейни, возьмём кофе и в путь?',
    44,
    [{ emoji: '❤', count: 3, mine: false }],
  );
  add('weekend', people[3], 'Звучит как идеальный план. Беру плед и что-нибудь вкусное ☕', 41);
  add('weekend', people[1], '@неля выбери бутерброды | круассаны | всё сразу', 39);
  add('weekend', bot, 'Я выбираю: всё сразу\nНа свежем воздухе аппетит лучше :)', 39);
  add('weekend', people[2], 'Вот поэтому Неля в нашей команде 😄', 37, [
    { emoji: '😂', count: 2, mine: true },
  ]);
  add('anya-chat', people[1], 'Кстати, скинешь тот плейлист? Очень понравился.', 15);
  add('home', people[4], 'Кто сегодня на настолки? Собираемся у меня.', 25);
  add('max-chat', people[2], 'Спасибо за вчера! Надо чаще так собираться.', 85);
  add(
    'saved',
    bot,
    'Здесь ваши заметки и важное. Напишите «@неля помощь», чтобы познакомиться.',
    120,
  );
  for (const c of chats) {
    const m = messages.filter((m) => m.chat_id === c.id).at(-1);
    if (m) c.last_message = m;
  }
  return { chats, messages, people, membership: {} as Record<string, string[]> };
}
let state: ReturnType<typeof seed>;
try {
  state = JSON.parse(localStorage.getItem('galinka-demo-v1') || 'null') || seed();
} catch {
  state = seed();
}
state.membership ??= {};
Object.assign(
  self,
  state.people.find((p) => p.id === self.id),
);
const save = () => localStorage.setItem('galinka-demo-v1', JSON.stringify(state));
export async function demoRequest(url: string, method: string, body: unknown): Promise<unknown> {
  const data = body as Record<string, any>;
  const [pathname, query] = url.split('?');
  const params = new URLSearchParams(query);
  const parts = pathname.split('/').filter(Boolean);
  const chat = state.chats.find((c) => c.id === parts[1]);
  let result: unknown = { ok: true };
  if (pathname === '/me') {
    if (method === 'PATCH') {
      Object.assign(self, { name: data.name });
      Object.assign(state.people[0], { name: data.name });
    }
    result = self;
  } else if (pathname === '/users')
    result = state.people.filter(
      (p) =>
        p.id !== self.id &&
        `${p.name} ${p.username}`.toLowerCase().includes((params.get('q') || '').toLowerCase()),
    );
  else if (pathname === '/chats' && method === 'GET') result = state.chats;
  else if (pathname === '/chats' && method === 'POST') {
    const peer = people.find((p) => p.id === data.userIds[0]);
    const existing = data.kind === 'direct' && state.chats.find((c) => c.peer?.id === peer?.id);
    if (existing) result = { id: existing.id };
    else {
      const c: Chat = {
        id: crypto.randomUUID(),
        kind: data.kind,
        title: data.kind === 'group' ? data.title : peer?.name || 'Новый чат',
        owner_id: self.id,
        nelya: false,
        member_count: data.userIds.length + 1,
        peer: data.kind === 'direct' ? peer || null : null,
        unread: 0,
        created_at: new Date().toISOString(),
        last_message: null,
      };
      state.chats.unshift(c);
      state.membership[c.id] = [self.id, ...data.userIds];
      result = { id: c.id };
    }
  } else if (parts[0] === 'chats' && chat) {
    if (parts[2] === 'members')
      result = state.membership[chat.id]
        ? state.membership[chat.id].map((id) => state.people.find((p) => p.id === id))
        : chat.kind === 'direct'
          ? [self, chat.peer]
          : chat.kind === 'saved'
            ? [self]
            : people.slice(0, chat.member_count);
    else if (parts[2] === 'read') chat.unread = 0;
    else if (parts[2] === 'invite') result = { url: `${location.origin}/?demo=1` };
    else if (parts.length === 2 && method === 'PATCH') Object.assign(chat, data);
    else if (parts[2] === 'files') {
      const f = (body as FormData).get('file') as File;
      result = { id: crypto.randomUUID(), name: f.name, size: f.size };
    } else if (parts[2] === 'messages') {
      if (method === 'GET')
        result = state.messages
          .filter(
            (m) =>
              m.chat_id === chat.id &&
              (!params.get('q') || m.body.toLowerCase().includes(params.get('q')!.toLowerCase())) &&
              (!params.get('before') ||
                state.messages.indexOf(m) <
                  state.messages.findIndex((v) => v.id === params.get('before'))),
          )
          .slice(-60);
      else if (parts[4] === 'reactions') {
        const m = state.messages.find((m) => m.id === parts[3]);
        if (m) {
          const r = m.reactions.find((r) => r.emoji === data.emoji);
          if (r) {
            r.count += r.mine ? -1 : 1;
            r.mine = !r.mine;
            m.reactions = m.reactions.filter((r) => r.count > 0);
          } else m.reactions.push({ emoji: data.emoji, count: 1, mine: true });
        }
      } else if (method === 'DELETE')
        state.messages = state.messages.filter((m) => m.id !== parts[3]);
      else if (method === 'POST') {
        const m: Message = {
          id: crypto.randomUUID(),
          chat_id: chat.id,
          sender_id: self.id,
          sender: self,
          body: data.body,
          created_at: new Date().toISOString(),
          nonce: data.nonce,
          file: data.fileId ? data.demoFile : null,
          reactions: [],
        };
        state.messages.push(m);
        chat.last_message = m;
        result = { id: m.id };
        if (chat.nelya && /^@неля/iu.test(data.body)) {
          let text =
            'Я Неля! Попробуйте «@неля монетка», «@неля идея» или «@неля выбери чай | кофе».';
          if (/монетка/iu.test(data.body))
            text = `Выпало: ${Math.random() > 0.5 ? 'орёл' : 'решка'}!`;
          else if (/выбери/iu.test(data.body)) {
            const opts = data.body
              .replace(/^@неля\s+выбери\s*/iu, '')
              .split('|')
              .map((s: string) => s.trim())
              .filter(Boolean);
            text =
              opts.length > 1
                ? `Я выбираю: ${opts[Math.floor(Math.random() * opts.length)]}`
                : 'Разделите варианты символом |';
          } else if (/идея/iu.test(data.body))
            text = 'Как насчёт прогулки без маршрута? Каждый по очереди выбирает поворот.';
          const reply = {
            ...m,
            id: crypto.randomUUID(),
            sender_id: null,
            sender: bot,
            body: text,
            file: null,
            reactions: [],
          };
          state.messages.push(reply);
          chat.last_message = reply;
        }
      }
    }
  }
  save();
  return structuredClone(result);
}
