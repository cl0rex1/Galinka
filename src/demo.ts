import type { Person, Chat, Message } from './types';
const self: Person = { id: 'demo-me', name: 'Саша', username: 'sasha', color: 0 };
const people: Person[] = [
  self,
  { id: 'anya', name: 'Аня', username: 'anya', color: 1, seen: 'online' },
  {
    id: 'max',
    name: 'Макс',
    username: 'max',
    color: 2,
    seen: new Date(Date.now() - 2 * 3600_000).toISOString(),
  },
  { id: 'dasha', name: 'Даша', username: 'dasha', color: 3, seen: 'recently' },
  { id: 'ilya', name: 'Илья', username: 'ilya', color: 4 },
];
const bot: Person = { id: 'nelya', name: 'Неля', username: 'nelya', color: 5 };
const demoFiles = new Map<string, string>();
// Photos picked in the demo are kept as data URLs so they survive a reload.
export const getDemoFileUrl = (id: string) => demoFiles.get(id) ?? state?.avatars?.[id];
const asDataUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(Error('Не удалось прочитать фото.'));
    reader.readAsDataURL(file);
  });
function seed() {
  const chats: Chat[] = [
    {
      id: 'weekend',
      kind: 'group',
      pinned: true,
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
  return {
    chats,
    messages,
    people,
    membership: {} as Record<string, string[]>,
    avatars: {} as Record<string, string>,
  };
}
let state: ReturnType<typeof seed>;
try {
  state = JSON.parse(localStorage.getItem('galinka-demo-v1') || 'null') || seed();
} catch {
  state = seed();
}
state.membership ??= {};
state.avatars ??= {};
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
  if (pathname === '/announcements') return { items: [], total: 0, page: 1 };
  const updateSelf = (change: Partial<Person> & Record<string, unknown>) => {
    Object.assign(self, change);
    Object.assign(state.people.find((p) => p.id === self.id) ?? {}, change);
    save();
    return self;
  };
  if (pathname === '/me/settings') return updateSelf(data);
  if (pathname === '/me/avatar') {
    if (method === 'DELETE') return updateSelf({ avatar: null });
    const id = crypto.randomUUID();
    state.avatars[id] = await asDataUrl((body as FormData).get('file') as File);
    return updateSelf({ avatar: id });
  }
  if (parts[0] === 'chats' && parts[2] === 'avatar' && chat) {
    let avatar: string | null = null;
    if (method !== 'DELETE') {
      avatar = crypto.randomUUID();
      state.avatars[avatar] = await asDataUrl((body as FormData).get('file') as File);
    }
    chat.avatar = avatar;
    save();
    return { avatar };
  }
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
  else if (pathname === '/search') {
    const needle = (params.get('q') || '').toLowerCase();
    result = state.messages
      .filter((m) => m.body.toLowerCase().includes(needle))
      .reverse()
      .slice(0, 50)
      .map((m) => ({
        id: m.id,
        chat_id: m.chat_id,
        body: m.body,
        created_at: m.created_at,
        sender_id: m.sender_id,
        sender_name: m.sender.name,
      }));
  } else if (pathname === '/chats' && method === 'GET')
    result = [...state.chats].sort(
      (a, b) =>
        Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
        (b.last_message?.created_at || b.created_at).localeCompare(
          a.last_message?.created_at || a.created_at,
        ),
    );
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
    if (parts[2] === 'members') {
      const ids =
        state.membership[chat.id] ??
        (chat.kind === 'direct'
          ? [self.id, chat.peer!.id]
          : chat.kind === 'saved'
            ? [self.id]
            : people.slice(0, chat.member_count).map((person) => person.id));
      if (method === 'POST') {
        if (chat.kind !== 'group' || chat.owner_id !== self.id)
          throw Error('Участников добавляет владелец группы.');
        state.membership[chat.id] = [...new Set([...ids, ...data.userIds])];
        chat.member_count = state.membership[chat.id].length;
      } else if (method === 'DELETE') {
        if (chat.kind !== 'group' || (parts[3] !== self.id && chat.owner_id !== self.id))
          throw Error('Недостаточно прав.');
        if (parts[3] === chat.owner_id && ids.length > 1)
          throw Error('Сначала передайте группу другому участнику.');
        state.membership[chat.id] = ids.filter((id) => id !== parts[3]);
        chat.member_count = state.membership[chat.id].length;
        if (parts[3] === self.id) state.chats = state.chats.filter((item) => item.id !== chat.id);
      } else
        result = ids.map((id) => state.people.find((person) => person.id === id)).filter(Boolean);
    } else if (parts[2] === 'preferences' && method === 'PATCH') {
      for (const key of ['pinned', 'muted', 'archived'] as const)
        if (typeof data[key] === 'boolean') chat[key] = data[key];
      result = { pinned: !!chat.pinned, muted: !!chat.muted, archived: !!chat.archived };
    } else if (parts[2] === 'read') chat.unread = 0;
    else if (parts[2] === 'invite') result = { url: `${location.origin}/?demo=1` };
    else if (parts.length === 2 && method === 'PATCH') {
      if (chat.owner_id !== self.id) throw Error('Настройки меняет владелец группы.');
      if (data.ownerId) chat.owner_id = data.ownerId;
      if (data.title !== undefined) chat.title = data.title;
      if (data.nelya !== undefined) chat.nelya = data.nelya;
    } else if (parts[2] === 'files') {
      const f = (body as FormData).get('file') as File;
      const id = crypto.randomUUID();
      demoFiles.set(id, URL.createObjectURL(f));
      result = {
        id,
        name: f.name,
        size: f.size,
        mime: f.type.split(';')[0] || 'application/octet-stream',
      };
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
      } else if (method === 'PATCH') {
        const target = state.messages.find(
          (message) =>
            message.id === parts[3] && message.chat_id === chat.id && message.sender_id === self.id,
        );
        if (!target) throw Error('Можно изменить только своё сообщение.');
        if (!data.body?.trim() && !target.file) throw Error('Сообщение не может быть пустым.');
        target.body = data.body.trim();
        target.edited_at = new Date().toISOString();
        for (const message of state.messages)
          if (message.reply?.id === target.id) message.reply.body = target.body;
        if (chat.last_message?.created_at === target.created_at) chat.last_message = target;
      } else if (method === 'DELETE') {
        state.messages = state.messages.filter((m) => m.id !== parts[3]);
        for (const message of state.messages)
          if (message.reply?.id === parts[3]) message.reply = null;
        chat.last_message =
          state.messages.filter((message) => message.chat_id === chat.id).at(-1) || null;
      } else if (method === 'POST') {
        const duplicate = state.messages.find(
          (message) => message.sender_id === self.id && message.nonce === data.nonce,
        );
        if (duplicate) return { id: duplicate.id };
        const quoted = data.replyTo
          ? state.messages.find(
              (message) => message.id === data.replyTo && message.chat_id === chat.id,
            )
          : undefined;
        if (data.replyTo && !quoted) throw Error('Сообщение для ответа не найдено.');
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
          edited_at: null,
          read_by: 0,
          reply: quoted
            ? {
                id: quoted.id,
                body: quoted.body,
                sender: { id: quoted.sender.id, name: quoted.sender.name },
                file_name: quoted.file?.name || null,
              }
            : null,
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
            reply: null,
            edited_at: null,
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
