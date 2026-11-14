import type {
  Person,
  Chat,
  Message,
  LinkPreview,
  MessageEdit,
  ScheduledMessage,
  Poll,
} from './types';
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
const SAMPLE_MP4_BASE64 =
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMVbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAACgAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAkB0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAACgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAABAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAAoAAAAAAABAAAAAAG4bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAAAgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABY21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAASNzdGJsAAAAv3N0c2QAAAAAAAAAAQAAAK9hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAQABIAAAASAAAAAAAAAABFUxhdmM2My4xNS4xMDAgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANWF2Y0MBZAAK/+EAGGdkAAqs2UQmwEQAAAMABAAAAwDIPEiWWAEABmjr48siwP34+AAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAIvYAAAAAAAAAAYc3R0cwAAAAAAAAABAAAAAQAAAgAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAEAAAABAAAAFHN0c3oAAAAAAAACzAAAAAEAAAAUc3RjbwAAAAAAAAABAAADRQAAAGF1ZHRhAAAAWW1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALGlsc3QAAAAkqXRvbwAAABxkYXRhAAAAAQAAAABMYXZmNjMuNy4xMDEAAAAIZnJlZQAAAtRtZGF0AAACoAYF//+c3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0yIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MyBiX3B5cmFtaWQ9MiBiX2FkYXB0PTEgYl9iaWFzPTAgZGlyZWN0PTEgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0yNTAga2V5aW50X21pbj0yNSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAACRliIQAK//+2OfzLJm1urBs8OyCqXDqy9r4GQm3R0JYLgNYPaM=';
function svgCardThumb(label: string, bg: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160" viewBox="0 0 320 160"><rect width="320" height="160" rx="12" fill="${bg}"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="22" font-weight="600">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
function demoPreviewFor(rawUrl: string): LinkPreview | null {
  try {
    const u = new URL(rawUrl);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    if (['localhost', '127.0.0.1'].includes(u.hostname))
      throw Error('Локальные и внутренние адреса запрещены.');
    const host = u.hostname.toLowerCase();
    if (host === 'youtu.be' || host.endsWith('youtube.com')) {
      const id =
        host === 'youtu.be'
          ? u.pathname.replace(/^\/+/, '').split('/')[0]
          : u.searchParams.get('v') || u.pathname.split('/')[2] || 'dQw4w9WgXcQ';
      return {
        url: u.href,
        site: 'YouTube',
        title: 'YouTube — Видеоролик',
        description: 'Смотреть на YouTube',
        image: svgCardThumb('▶ YouTube', '#cc181e'),
        provider: 'youtube',
        embed_url: `https://www.youtube.com/embed/${id}`,
      };
    }
    if (host === 'open.spotify.com') {
      return {
        url: u.href,
        site: 'Spotify',
        title: 'Spotify — Трек или плейлист',
        description: 'Слушать в Spotify',
        image: svgCardThumb('♫ Spotify', '#1db954'),
        provider: 'spotify',
        embed_url: `https://open.spotify.com/embed${u.pathname}`,
      };
    }
    if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
      return {
        url: u.href,
        site: 'TikTok',
        title: 'Видео из TikTok',
        description: u.hostname,
        image: svgCardThumb('♪ TikTok', '#161823'),
        provider: 'tiktok',
      };
    }
    return {
      url: u.href,
      site: host.replace(/^www\./, ''),
      title: host.replace(/^www\./, ''),
      description: u.pathname !== '/' ? u.pathname : 'Внешняя ссылка',
      image: svgCardThumb(host.replace(/^www\./, '').slice(0, 18), '#2c5364'),
      provider: 'web',
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes('адреса запрещены')) throw err;
    return null;
  }
}
function firstUrlIn(text: string): string | null {
  const m = text.replace(/\[(?:sticker|gif):[^\]]+\]/g, ' ').match(/https?:\/\/[^\s<>"'`]+/i);
  return m ? m[0].replace(/[.,!?;:)'"]+$/, '') : null;
}
function demoTranslate(text: string, targetLang: string) {
  const dict: Record<string, string> = {
    hello: 'Привет',
    'hello world': 'Привет, мир',
    'good morning': 'Доброе утро',
    'how are you?': 'Как дела?',
    привет: 'Hello',
    спасибо: 'Thank you',
  };
  const lower = text.trim().toLowerCase();
  const hasCyrillic = /[а-яё]/i.test(text);
  const sourceLang = hasCyrillic ? 'ru' : 'en';
  const translated =
    dict[lower] || (sourceLang === targetLang ? text : `[${targetLang.toUpperCase()}] ${text}`);
  return { translated, sourceLang, targetLang };
}
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
    hidden: [] as string[],
    deleted: {} as Record<string, Message>,
    edits: {} as Record<string, MessageEdit[]>,
    scheduled: [] as ScheduledMessage[],
    polls: {} as Record<string, Poll & { creator_id: string; votes: Record<number, string[]> }>,
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
state.hidden ??= [];
state.deleted ??= {};
state.edits ??= {};
state.scheduled ??= [];
state.polls ??= {};
function syncPollSummary(pollId: string) {
  const p = state.polls[pollId];
  if (!p) return null;
  const votersSet = new Set<string>();
  const options = p.options.map((opt) => {
    const uids = p.votes[opt.index] ?? [];
    for (const u of uids) votersSet.add(u);
    return {
      ...opt,
      votes: uids.length,
      voted: uids.includes(self.id),
      voters: p.anonymous
        ? undefined
        : uids.map((uid) => state.people.find((pe) => pe.id === uid) || self),
    };
  });
  const summary: Poll = {
    id: p.id,
    question: p.question,
    multiple: p.multiple,
    anonymous: p.anonymous,
    closed: p.closed,
    total_votes: votersSet.size,
    options,
  };
  for (const m of state.messages) if (m.poll?.id === pollId) m.poll = summary;
  return summary;
}
function purgeDemoExpired() {
  const now = Date.now();
  const expired = new Set(
    state.messages
      .filter((m) => m.expires_at && Date.parse(m.expires_at) <= now)
      .map((m) => m.id),
  );
  if (expired.size) {
    state.messages = state.messages.filter((m) => !expired.has(m.id));
    for (const c of state.chats) {
      if (c.pinned_message && expired.has(c.pinned_message.id)) c.pinned_message = null;
      c.last_message =
        state.messages
          .filter((m) => m.chat_id === c.id && !state.hidden.includes(m.id))
          .at(-1) || null;
    }
  }
}
Object.assign(
  self,
  state.people.find((p) => p.id === self.id),
);
const save = () => localStorage.setItem('galinka-demo-v1', JSON.stringify(state));
export async function demoRequest(url: string, method: string, body: unknown): Promise<unknown> {
  purgeDemoExpired();
  const data = body as Record<string, any>;
  const [pathname, query] = url.split('?');
  const params = new URLSearchParams(query);
  const parts = pathname.split('/').filter(Boolean);
  const chat = state.chats.find((c) => c.id === parts[1]);
  let result: unknown = { ok: true };
  if (pathname === '/announcements') return { items: [], total: 0, page: 1 };
  if (pathname === '/link-preview') {
    const targetUrl = params.get('url') || '';
    return { preview: demoPreviewFor(targetUrl) };
  }
  if (pathname === '/gifs') {
    const q = (params.get('q') || '').trim().toLowerCase();
    const demoGifs = [
      { id: 'dance', title: 'Танцы', keywords: ['танец', 'веселье', 'музыка', 'party', 'dance'] },
      { id: 'applause', title: 'Браво!', keywords: ['браво', 'хлопаю', 'супер', 'applause', 'clap'] },
      { id: 'rocket', title: 'В космос', keywords: ['ракета', 'старт', 'вперед', 'космос', 'rocket'] },
      { id: 'coffee', title: 'Утренний кофе', keywords: ['кофе', 'утро', 'доброе', 'coffee', 'morning'] },
      { id: 'heart', title: 'Сердечко', keywords: ['любовь', 'сердце', 'heart', 'love'] },
      { id: 'confetti', title: 'Праздник', keywords: ['праздник', 'салют', 'ура', 'confetti', 'party'] },
      { id: 'cat-type', title: 'Котик печатает', keywords: ['кот', 'работаю', 'чат', 'cat', 'typing'] },
      { id: 'thumb', title: 'Топчик', keywords: ['класс', 'ок', 'лайк', 'cool', 'ok'] },
    ];
    return {
      items: q
        ? demoGifs.filter(
            (g) => g.title.toLowerCase().includes(q) || g.keywords.some((kw) => kw.includes(q)),
          )
        : demoGifs,
    };
  }
  if (pathname === '/translate' && method === 'POST') {
    return demoTranslate(String(data.text || ''), String(data.targetLang || 'ru'));
  }
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
      .filter((m) => !state.hidden.includes(m.id) && m.body.toLowerCase().includes(needle))
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
    } else if (parts[2] === 'draft' && method === 'PUT') {
      chat.draft = String(data.draft || '');
      chat.draft_updated_at = new Date().toISOString();
    } else if (parts[2] === 'read') chat.unread = 0;
    else if (parts[2] === 'pin') {
      if (chat.kind === 'group' && chat.owner_id !== self.id)
        throw Error('Закрепляет владелец группы.');
      const target = state.messages.find((m) => m.id === data.messageId && m.chat_id === chat.id);
      chat.pinned_message = target
        ? { id: target.id, body: target.body, file_name: target.file?.name || null }
        : null;
    } else if (parts[2] === 'forward') {
      const sources = state.messages.filter((m) => data.messageIds.includes(m.id));
      result = {
        ids: sources.map((source, index) => {
          const copy: Message = {
            ...structuredClone(source),
            id: crypto.randomUUID(),
            chat_id: chat.id,
            sender_id: self.id,
            sender: self,
            created_at: new Date(Date.now() + index).toISOString(),
            expires_at: chat.auto_delete_seconds
              ? new Date(Date.now() + chat.auto_delete_seconds * 1000).toISOString()
              : null,
            nonce: crypto.randomUUID(),
            reactions: [],
            reply: null,
            edited_at: null,
            read_by: 0,
            forwarded_from: source.forwarded_from || source.sender.name,
          };
          state.messages.push(copy);
          chat.last_message = copy;
          return copy.id;
        }),
      };
    } else if (parts[2] === 'invite') result = { url: `${location.origin}/?demo=1` };
    else if (parts.length === 2 && method === 'PATCH') {
      const ownerOnly =
        data.ownerId !== undefined || data.title !== undefined || data.nelya !== undefined;
      if (ownerOnly && chat.owner_id !== self.id)
        throw Error('Настройки меняет владелец группы.');
      if (data.autoDeleteSeconds !== undefined && chat.kind === 'group' && chat.owner_id !== self.id)
        throw Error('Таймер автоудаления в группе меняет владелец.');
      if (data.ownerId) chat.owner_id = data.ownerId;
      if (data.title !== undefined) chat.title = data.title;
      if (data.nelya !== undefined) chat.nelya = data.nelya;
      if (data.autoDeleteSeconds !== undefined)
        chat.auto_delete_seconds =
          data.autoDeleteSeconds && data.autoDeleteSeconds > 0 ? data.autoDeleteSeconds : null;
    } else if (parts[2] === 'scheduled') {
      if (method === 'GET') {
        result = state.scheduled
          .filter((s) => s.chat_id === chat.id)
          .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));
      } else if (method === 'POST' && parts[4] === 'send') {
        const idx = state.scheduled.findIndex((s) => s.id === parts[3] && s.chat_id === chat.id);
        if (idx < 0) throw Error('Отложенное сообщение не найдено.');
        const item = state.scheduled.splice(idx, 1)[0];
        const preview = firstUrlIn(item.body) ? demoPreviewFor(firstUrlIn(item.body)!) : null;
        const m: Message = {
          id: crypto.randomUUID(),
          chat_id: chat.id,
          sender_id: self.id,
          sender: self,
          body: item.body,
          created_at: new Date().toISOString(),
          expires_at: chat.auto_delete_seconds
            ? new Date(Date.now() + chat.auto_delete_seconds * 1000).toISOString()
            : null,
          link_preview: preview,
          nonce: crypto.randomUUID(),
          file: null,
          reactions: [],
          edited_at: null,
          read_by: 0,
          silent: item.silent,
        };
        state.messages.push(m);
        chat.last_message = m;
        result = { id: m.id };
      } else if (method === 'POST') {
        const item: ScheduledMessage = {
          id: crypto.randomUUID(),
          chat_id: chat.id,
          body: String(data.body || ''),
          file_id: data.fileId || null,
          silent: Boolean(data.silent),
          is_reminder: Boolean(data.isReminder || chat.kind === 'saved'),
          scheduled_for: String(data.scheduledFor),
          created_at: new Date().toISOString(),
        };
        state.scheduled.push(item);
        result = item;
      } else if (method === 'DELETE') {
        state.scheduled = state.scheduled.filter((s) => !(s.id === parts[3] && s.chat_id === chat.id));
      }
    } else if (parts[2] === 'tiktok' && method === 'POST') {
      const fileId = crypto.randomUUID();
      const raw = atob(SAMPLE_MP4_BASE64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'video/mp4' });
      demoFiles.set(fileId, URL.createObjectURL(blob));
      const file = { id: fileId, name: 'tiktok-video.mp4', size: bytes.length, mime: 'video/mp4' };
      const m: Message = {
        id: crypto.randomUUID(),
        chat_id: chat.id,
        sender_id: self.id,
        sender: self,
        body: data.caption || 'Видео из TikTok',
        created_at: new Date().toISOString(),
        expires_at: chat.auto_delete_seconds
          ? new Date(Date.now() + chat.auto_delete_seconds * 1000).toISOString()
          : null,
        nonce: crypto.randomUUID(),
        file,
        reactions: [],
        edited_at: null,
        read_by: 0,
      };
      state.messages.push(m);
      chat.last_message = m;
      result = { id: m.id, file };
    } else if (parts[2] === 'polls' && method === 'POST') {
      if (parts[4] === 'vote') {
        const p = state.polls[parts[3]];
        if (!p) throw Error('Опрос не найден.');
        if (p.closed) throw Error('Голосование завершено.');
        const chosen: number[] = Array.isArray(data.optionIndices) ? data.optionIndices : [];
        for (const key of Object.keys(p.votes)) {
          p.votes[Number(key)] = (p.votes[Number(key)] || []).filter((id) => id !== self.id);
        }
        for (const idx of chosen) {
          p.votes[idx] = [...(p.votes[idx] || []), self.id];
        }
        syncPollSummary(p.id);
      } else if (parts[4] === 'close') {
        const p = state.polls[parts[3]];
        if (!p) throw Error('Опрос не найден.');
        p.closed = true;
        syncPollSummary(p.id);
      } else {
        const pollId = crypto.randomUUID();
        const opts = (Array.isArray(data.options) ? data.options : []) as string[];
        const votes: Record<number, string[]> = {};
        const options = opts.map((text, index) => {
          votes[index] = [];
          return { index, text, votes: 0, voted: false, voters: [] };
        });
        state.polls[pollId] = {
          id: pollId,
          question: String(data.question || ''),
          multiple: Boolean(data.multiple),
          anonymous: Boolean(data.anonymous),
          closed: false,
          total_votes: 0,
          options,
          creator_id: self.id,
          votes,
        };
        const pollSummary = syncPollSummary(pollId)!;
        const m: Message = {
          id: crypto.randomUUID(),
          chat_id: chat.id,
          sender_id: self.id,
          sender: self,
          body: pollSummary.question,
          poll: pollSummary,
          created_at: new Date().toISOString(),
          expires_at: chat.auto_delete_seconds
            ? new Date(Date.now() + chat.auto_delete_seconds * 1000).toISOString()
            : null,
          nonce: data.nonce || crypto.randomUUID(),
          file: null,
          reactions: [],
          edited_at: null,
          read_by: 0,
        };
        state.messages.push(m);
        chat.last_message = m;
        result = { id: m.id, pollId };
      }
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
      if (method === 'GET' && parts.length === 3)
        result = state.messages
          .filter(
            (m) =>
              m.chat_id === chat.id &&
              !state.hidden.includes(m.id) &&
              (!params.get('q') || m.body.toLowerCase().includes(params.get('q')!.toLowerCase())) &&
              (!params.get('before') ||
                state.messages.indexOf(m) <
                  state.messages.findIndex((v) => v.id === params.get('before'))),
          )
          .slice(-60);
      else if (parts[4] === 'edits' && method === 'GET') {
        const target = state.messages.find((m) => m.id === parts[3] && m.chat_id === chat.id);
        result = { current: target?.body || '', edits: state.edits[parts[3]] || [] };
      } else if (parts[4] === 'details' && method === 'GET') {
        const target = state.messages.find((m) => m.id === parts[3] && m.chat_id === chat.id);
        const membersIds =
          state.membership[chat.id] ??
          (chat.kind === 'direct'
            ? [self.id, chat.peer!.id]
            : chat.kind === 'saved'
              ? [self.id]
              : state.people.slice(0, chat.member_count).map((p) => p.id));
        const readers = membersIds
          .filter((id) => id !== target?.sender_id)
          .map((id, idx) => {
            const person = state.people.find((p) => p.id === id) || people[0];
            return {
              ...person,
              read_at: new Date(Date.now() - (idx + 1) * 45_000).toISOString(),
            };
          });
        const reactions = (target?.reactions || []).map((r) => {
          const others = state.people.filter((p) => p.id !== self.id);
          const users: Person[] = [];
          if (r.mine) users.push(self);
          while (users.length < r.count && others.length) users.push(others[users.length % others.length]);
          return { emoji: r.emoji, users };
        });
        result = { readers, reactions };
      } else if (parts[4] === 'restore' && method === 'POST') {
        if (state.hidden.includes(parts[3])) {
          state.hidden = state.hidden.filter((id) => id !== parts[3]);
        } else if (state.deleted[parts[3]]) {
          state.messages.push(state.deleted[parts[3]]);
          state.messages.sort((a, b) => a.created_at.localeCompare(b.created_at));
          delete state.deleted[parts[3]];
        } else {
          throw Error('Время для отмены удаления истекло.');
        }
        chat.last_message =
          state.messages.filter((m) => m.chat_id === chat.id && !state.hidden.includes(m.id)).at(-1) ||
          null;
      } else if (parts[4] === 'reactions') {
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
        const nextBody = data.body.trim();
        if (target.body !== nextBody) {
          state.edits[target.id] = [
            { id: crypto.randomUUID(), previous_body: target.body, edited_at: new Date().toISOString() },
            ...(state.edits[target.id] || []),
          ];
          target.body = nextBody;
          target.edited_at = new Date().toISOString();
          target.link_preview = firstUrlIn(nextBody) ? demoPreviewFor(firstUrlIn(nextBody)!) : null;
        }
        for (const message of state.messages)
          if (message.reply?.id === target.id) message.reply.body = target.body;
        if (chat.last_message?.created_at === target.created_at) chat.last_message = target;
      } else if (method === 'DELETE') {
        const scope = params.get('scope') === 'me' ? 'me' : 'all';
        if (scope === 'me') {
          if (!state.hidden.includes(parts[3])) state.hidden.push(parts[3]);
        } else {
          const target = state.messages.find((m) => m.id === parts[3]);
          if (target) state.deleted[target.id] = target;
          state.messages = state.messages.filter((m) => m.id !== parts[3]);
          if (chat.pinned_message?.id === parts[3]) chat.pinned_message = null;
          for (const message of state.messages)
            if (message.reply?.id === parts[3]) message.reply = null;
        }
        chat.last_message =
          state.messages
            .filter((message) => message.chat_id === chat.id && !state.hidden.includes(message.id))
            .at(-1) || null;
        result = { ok: true, scope, canUndo: true };
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
        const foundUrl = data.skipPreview ? null : firstUrlIn(data.body || '');
        const m: Message = {
          id: crypto.randomUUID(),
          chat_id: chat.id,
          sender_id: self.id,
          sender: self,
          body: data.body,
          created_at: new Date().toISOString(),
          expires_at: chat.auto_delete_seconds
            ? new Date(Date.now() + chat.auto_delete_seconds * 1000).toISOString()
            : null,
          link_preview: foundUrl ? demoPreviewFor(foundUrl) : null,
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
