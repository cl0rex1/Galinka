import express, { type Request, type Response, type NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import multer from 'multer';
import { Pool, Client, type PoolClient } from 'pg';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z, ZodError } from 'zod';
import { digest, hashPassword, verifyPassword, readCookie } from './security.js';
import { nelyaReply } from './nelya.js';
import { pushEnabled, startPushWorker } from './push.js';

const production = process.env.NODE_ENV === 'production';
const origin = process.env.APP_ORIGIN || 'http://localhost:5173';
const inviteCode = process.env.INVITE_CODE || '';
if (inviteCode.length < 12)
  throw Error('Set INVITE_CODE to a random string of at least 12 characters.');
if (new URL(origin).origin !== origin)
  throw Error('APP_ORIGIN must be an origin without a path or trailing slash.');
if (production && !origin.startsWith('https://') && process.env.COOKIE_SECURE !== 'false')
  throw Error('APP_ORIGIN must use HTTPS (or set COOKIE_SECURE=false for local testing only).');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
const directory = path.resolve(process.env.UPLOAD_DIR || 'uploads');
await mkdir(directory, { recursive: true });
const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
const migrate = await pool.connect();
try {
  await migrate.query('BEGIN');
  await migrate.query('SELECT pg_advisory_xact_lock(648291)');
  await migrate.query(schema);
  await migrate.query('COMMIT');
} catch (error) {
  await migrate.query('ROLLBACK');
  throw error;
} finally {
  migrate.release();
}
const app = express();
const packageInfo = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const buildInfo = {
  version: packageInfo.version,
  build: process.env.BUILD_SHA || packageInfo.version,
};
// The public API lives under /messenger; /api remains the internal health/dev route.
app.use((req, _res, next) => {
  if (
    req.url === '/messenger' ||
    req.url.startsWith('/messenger/') ||
    req.url.startsWith('/messenger?')
  )
    req.url = '/api' + req.url.slice('/messenger'.length);
  next();
});
app.use('/api', (req, res, next) => {
  const requestOrigin = req.headers.origin;
  if (requestOrigin === origin || (!production && requestOrigin === 'http://127.0.0.1:5173')) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') {
    res.sendStatus(
      requestOrigin === origin || (!production && requestOrigin === 'http://127.0.0.1:5173')
        ? 204
        : 403,
    );
    return;
  }
  next();
});
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'font-src': ["'self'"],
        'img-src': ["'self'", 'blob:', 'data:'],
        'connect-src': [
          "'self'",
          ...(process.env.PUBLIC_API_ORIGIN ? [new URL(process.env.PUBLIC_API_ORIGIN).origin] : []),
        ],
        'object-src': ["'none'"],
        'upgrade-insecure-requests': production && origin.startsWith('https:') ? [] : null,
      },
    },
  }),
);
app.use(express.json({ limit: '32kb' }));
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/api', (req, res, next) => {
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
    req.headers.origin &&
    req.headers.origin !== origin &&
    (production || req.headers.origin !== 'http://127.0.0.1:5173')
  ) {
    res.status(403).json({ error: 'Этот источник не разрешён.' });
    return;
  }
  next();
});
// ponytail: per-instance limits; use a shared gateway limit when adding public replicas.
app.use(
  '/api',
  rateLimit({
    windowMs: 60_000,
    limit: 180,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Слишком много запросов. Подождите минуту.' },
  }),
);
const authLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Слишком много попыток. Попробуйте через 15 минут.' },
});
const uuid = z.uuid();
const credentials = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,24}$/),
  password: z.string().min(10).max(128),
});
const personSQL = `id, username, name, color`;
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const requireValue = (condition: unknown, status: number, message: string) => {
  if (!condition) throw new HttpError(status, message);
};
type User = { id: string; username: string; name: string; color: number };
type AuthedRequest = Request & { user: User; sessionToken: string };
async function auth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = digest(readCookie(req.headers.cookie));
    const { rows } = await pool.query(
      `SELECT u.id,u.username,u.name,u.color FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=$1 AND s.expires_at>now()`,
      [token],
    );
    if (!rows[0]) {
      res.status(401).json({ error: 'Войдите в Galinka.' });
      return;
    }
    Object.assign(req, { user: rows[0], sessionToken: token });
    next();
  } catch (error) {
    next(error);
  }
}
const user = (req: Request) => (req as AuthedRequest).user;
async function member(chatId: string, userId: string, db: Pool | PoolClient = pool) {
  const { rows } = await db.query(
    'SELECT c.* FROM chats c JOIN members m ON m.chat_id=c.id WHERE c.id=$1 AND m.user_id=$2',
    [uuid.parse(chatId), userId],
  );
  requireValue(rows[0], 404, 'Чат не найден.');
  return rows[0];
}
async function transaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const value = await fn(db);
    await db.query('COMMIT');
    return value;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}
async function notify(db: Pool | PoolClient, chatId: string, deletedId?: string) {
  await db.query("SELECT pg_notify('galinka', $1)", [JSON.stringify({ chatId, deletedId })]);
}
const secure =
  process.env.COOKIE_SECURE === 'true' || (production && process.env.COOKIE_SECURE !== 'false');
async function session(res: Response, id: string) {
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    "INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [digest(token), id],
  );
  res.cookie('galinka', token, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    maxAge: 30 * 86400_000,
    path: '/',
  });
}
app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
});
app.get('/api/version', (_req, res) => res.json(buildInfo));
app.get('/api/push/status', auth, (_req, res) => res.json({ enabled: pushEnabled }));
const pushToken = z.object({
  token: z
    .string()
    .min(20)
    .max(4096)
    .regex(/^[A-Za-z0-9_:\-]+$/),
});
app.post('/api/push/devices', auth, async (req, res) => {
  requireValue(pushEnabled, 503, 'Пуши пока не подключены.');
  const { token } = pushToken.parse(req.body);
  await transaction(async (db) => {
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user(req).id]);
    await db.query(
      `INSERT INTO push_devices(token,user_id,session_token) VALUES($1,$2,$3)
      ON CONFLICT(token) DO UPDATE SET user_id=$2,session_token=$3,updated_at=now()`,
      [token, user(req).id, (req as AuthedRequest).sessionToken],
    );
    await db.query(
      'DELETE FROM push_devices WHERE user_id=$1 AND token IN (SELECT token FROM push_devices WHERE user_id=$1 ORDER BY updated_at DESC OFFSET 12)',
      [user(req).id],
    );
  });
  res.json({ ok: true });
});
app.delete('/api/push/devices', auth, async (req, res) => {
  const { token } = pushToken.parse(req.body);
  await pool.query('DELETE FROM push_devices WHERE token=$1 AND user_id=$2', [token, user(req).id]);
  res.json({ ok: true });
});
let releaseCache: { expires: number; value: unknown } | undefined;
app.get('/api/downloads', async (_req, res) => {
  if (releaseCache && releaseCache.expires > Date.now()) {
    res.json(releaseCache.value);
    return;
  }
  try {
    const response = await fetch('https://api.github.com/repos/cl0rex1/Galinka/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Galinka' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      res.status(503).json({ error: 'Релиз ещё готовится.' });
      return;
    }
    const release = (await response.json()) as {
      tag_name: string;
      html_url: string;
      assets: { name: string; browser_download_url: string; size: number }[];
    };
    const value = {
      version: release.tag_name.replace(/^v/, ''),
      url: release.html_url,
      assets: release.assets
        .filter((a) => /\.(exe|dmg|AppImage|deb|apk|pkg\.tar\.zst)$/.test(a.name))
        .map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
    };
    releaseCache = { expires: Date.now() + 60000, value };
    res.json(value);
  } catch {
    res.status(503).json({ error: 'Не удалось проверить сборки. Попробуйте позже.' });
  }
});
app.post('/api/auth/register', authLimit, async (req, res) => {
  const data = credentials
    .extend({ name: z.string().trim().min(1).max(40), invite: z.string().max(200) })
    .parse(req.body);
  requireValue(
    timingSafeEqual(Buffer.from(digest(data.invite)), Buffer.from(digest(inviteCode))),
    403,
    'Код приглашения не подошёл. Попросите его у владельца сервера.',
  );
  const id = randomUUID(),
    password = await hashPassword(data.password);
  const account = await transaction(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO users(id,username,name,password,color) VALUES($1,$2,$3,$4,$5) RETURNING ${personSQL}`,
      [id, data.username, data.name, password, Math.floor(Math.random() * 6)],
    );
    const chatId = randomUUID();
    await db.query(
      "INSERT INTO chats(id,kind,title,owner_id,nelya) VALUES($1,'saved','Избранное',$2,true)",
      [chatId, id],
    );
    await db.query('INSERT INTO members(chat_id,user_id) VALUES($1,$2)', [chatId, id]);
    await db.query('INSERT INTO messages(id,chat_id,body,nonce) VALUES($1,$2,$3,$4)', [
      randomUUID(),
      chatId,
      'Привет! Это ваше место для заметок, файлов и мыслей. Я Неля — напишите «@неля помощь», и я расскажу, что умею.',
      randomUUID(),
    ]);
    return rows[0];
  });
  await session(res, id);
  res.status(201).json(account);
});
app.post('/api/auth/login', authLimit, async (req, res) => {
  const data = credentials.parse(req.body);
  const { rows } = await pool.query('SELECT * FROM users WHERE username=$1', [data.username]);
  const account = rows[0];
  const valid = await verifyPassword(
    data.password,
    account?.password || '00000000000000000000000000000000:' + '0'.repeat(128),
  );
  requireValue(account && valid, 401, 'Логин или пароль не подошли.');
  await session(res, account.id);
  const { id, username, name, color } = account;
  res.json({ id, username, name, color });
});
app.post('/api/auth/logout', auth, async (req, res) => {
  const token = (req as AuthedRequest).sessionToken;
  await pool.query('DELETE FROM sessions WHERE token=$1', [token]);
  for (const [response, info] of streams) if (info.token === token) response.end();
  res.clearCookie('galinka', { httpOnly: true, secure, sameSite: 'strict', path: '/' });
  res.json({ ok: true });
});
app.get('/api/me', auth, (req, res) => res.json(user(req)));
app.patch('/api/me', auth, async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(40) }).parse(req.body);
  const { rows } = await pool.query(`UPDATE users SET name=$1 WHERE id=$2 RETURNING ${personSQL}`, [
    name,
    user(req).id,
  ]);
  res.json(rows[0]);
});
app.get('/api/users', auth, async (req, res) => {
  const q = z.string().trim().min(2).max(40).parse(req.query.q);
  const { rows } = await pool.query(
    `SELECT ${personSQL} FROM users WHERE id<>$1 AND (strpos(lower(name),lower($2))>0 OR strpos(username,lower($2))>0) ORDER BY username LIMIT 20`,
    [user(req).id, q],
  );
  res.json(rows);
});
app.get('/api/chats', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.id,c.kind,c.owner_id,c.nelya,c.created_at,m.read_at,
 CASE WHEN c.kind='direct' THEN (SELECT u.name FROM members mm JOIN users u ON u.id=mm.user_id WHERE mm.chat_id=c.id AND mm.user_id<>$1 LIMIT 1) ELSE c.title END AS title,
 (SELECT count(*)::int FROM members WHERE chat_id=c.id) AS member_count,
 (SELECT row_to_json(u) FROM (SELECT u.id,u.name,u.username,u.color FROM members mm JOIN users u ON u.id=mm.user_id WHERE mm.chat_id=c.id AND mm.user_id<>$1 LIMIT 1) u) AS peer,
 (SELECT row_to_json(msg) FROM (SELECT body,created_at,sender_id,file_id FROM messages WHERE chat_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1) msg) AS last_message,
 (SELECT count(*)::int FROM messages WHERE chat_id=c.id AND created_at>m.read_at AND sender_id IS DISTINCT FROM $1) AS unread
 FROM chats c JOIN members m ON m.chat_id=c.id WHERE m.user_id=$1 ORDER BY COALESCE((SELECT max(created_at) FROM messages WHERE chat_id=c.id),c.created_at) DESC`,
    [user(req).id],
  );
  res.json(rows);
});
app.post('/api/chats', auth, async (req, res) => {
  const data = z
    .object({
      kind: z.enum(['direct', 'group']),
      title: z.string().trim().min(1).max(70).optional(),
      userIds: z.array(uuid).max(49),
    })
    .parse(req.body);
  const ids = [...new Set([user(req).id, ...data.userIds])];
  requireValue(
    data.kind === 'group' ? !!data.title : ids.length === 2,
    400,
    'Укажите название группы или собеседника.',
  );
  const id = await transaction(async (db) => {
    const key = data.kind === 'direct' ? [...ids].sort().join(':') : null;
    const { rows } = await db.query(
      `INSERT INTO chats(id,kind,title,owner_id,direct_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(direct_key) DO UPDATE SET direct_key=EXCLUDED.direct_key RETURNING id`,
      [randomUUID(), data.kind, data.title || '', user(req).id, key],
    );
    const id = rows[0].id;
    for (const uid of ids)
      await db.query('INSERT INTO members(chat_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [
        id,
        uid,
      ]);
    await notify(db, id);
    return id;
  });
  res.status(201).json({ id });
});
app.get('/api/chats/:id/members', auth, async (req, res) => {
  await member(String(req.params.id), user(req).id);
  const { rows } = await pool.query(
    'SELECT u.id,u.name,u.username,u.color FROM members m JOIN users u ON u.id=m.user_id WHERE m.chat_id=$1 ORDER BY u.name',
    [req.params.id],
  );
  res.json(rows);
});
app.patch('/api/chats/:id', auth, async (req, res) => {
  const chat = await member(String(req.params.id), user(req).id);
  requireValue(chat.owner_id === user(req).id, 403, 'Настройки меняет создатель чата.');
  const data = z
    .object({ nelya: z.boolean().optional(), title: z.string().trim().min(1).max(70).optional() })
    .parse(req.body);
  requireValue(
    data.title === undefined || chat.kind === 'group',
    400,
    'Переименовать можно только группу.',
  );
  await pool.query(
    'UPDATE chats SET nelya=COALESCE($1,nelya),title=COALESCE($2,title) WHERE id=$3',
    [data.nelya, data.title, chat.id],
  );
  await notify(pool, chat.id);
  res.json({ ok: true });
});
app.post('/api/chats/:id/read', auth, async (req, res) => {
  await member(String(req.params.id), user(req).id);
  const { lastMessageId } = z.object({ lastMessageId: uuid }).parse(req.body);
  await pool.query(
    'UPDATE members SET read_at=GREATEST(read_at,COALESCE((SELECT created_at FROM messages WHERE id=$3 AND chat_id=$1),read_at)) WHERE chat_id=$1 AND user_id=$2',
    [req.params.id, user(req).id, lastMessageId],
  );
  res.json({ ok: true });
});
app.post('/api/chats/:id/invite', auth, async (req, res) => {
  const chat = await member(String(req.params.id), user(req).id);
  requireValue(
    chat.kind === 'group' && chat.owner_id === user(req).id,
    403,
    'Приглашение создаёт владелец группы.',
  );
  const token = randomBytes(24).toString('base64url');
  await pool.query('INSERT INTO invites(token,chat_id) VALUES($1,$2)', [digest(token), chat.id]);
  res.json({ url: `${origin}/app?join=${token}` });
});
app.post('/api/join', auth, async (req, res) => {
  const { token } = z.object({ token: z.string().min(20).max(100) }).parse(req.body);
  const id = await transaction(async (db) => {
    const { rows } = await db.query(
      'SELECT i.chat_id FROM invites i JOIN chats c ON c.id=i.chat_id WHERE token=$1 AND expires_at>now() FOR UPDATE OF c',
      [digest(token)],
    );
    requireValue(rows[0], 404, 'Приглашение истекло или не существует.');
    const id = rows[0].chat_id;
    const size = await db.query('SELECT count(*)::int AS n FROM members WHERE chat_id=$1', [id]);
    requireValue(size.rows[0].n < 100, 400, 'В MVP группа ограничена 100 участниками.');
    await db.query('INSERT INTO members(chat_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [
      id,
      user(req).id,
    ]);
    await notify(db, id);
    return id;
  });
  res.json({ id });
});
const messageSQL = `SELECT m.id,m.chat_id,m.sender_id,m.body,m.created_at,m.nonce,
 CASE WHEN u.id IS NULL THEN json_build_object('id','nelya','name','Неля','username','nelya','color',5) ELSE json_build_object('id',u.id,'name',u.name,'username',u.username,'color',u.color) END AS sender,
 CASE WHEN f.id IS NULL THEN NULL ELSE json_build_object('id',f.id,'name',f.name,'size',f.size) END AS file,
 COALESCE((SELECT json_agg(r) FROM (SELECT emoji,count(*)::int AS count,bool_or(user_id=$2) AS mine FROM reactions WHERE message_id=m.id GROUP BY emoji ORDER BY emoji) r),'[]') AS reactions
 FROM messages m LEFT JOIN users u ON u.id=m.sender_id LEFT JOIN files f ON f.id=m.file_id`;
app.get('/api/chats/:id/messages', auth, async (req, res) => {
  await member(String(req.params.id), user(req).id);
  const q = z.string().trim().max(100).optional().parse(req.query.q);
  const before = uuid.optional().parse(req.query.before);
  const { rows } = await pool.query(
    `${messageSQL} WHERE m.chat_id=$1 AND ($3::text IS NULL OR strpos(lower(m.body),lower($3))>0) AND ($4::uuid IS NULL OR (m.created_at,m.id)<(SELECT created_at,id FROM messages WHERE id=$4 AND chat_id=$1)) ORDER BY m.created_at DESC,m.id DESC LIMIT 60`,
    [req.params.id, user(req).id, q || null, before || null],
  );
  res.json(rows.reverse());
});
app.post('/api/chats/:id/messages', auth, async (req, res) => {
  const data = z
    .object({ body: z.string().trim().max(8000).default(''), fileId: uuid.optional(), nonce: uuid })
    .parse(req.body);
  requireValue(data.body || data.fileId, 400, 'Напишите сообщение или выберите файл.');
  const id = await transaction(async (db) => {
    const chat = await member(String(req.params.id), user(req).id, db);
    if (data.fileId) {
      const { rows } = await db.query(
        'SELECT id FROM files WHERE id=$1 AND chat_id=$2 AND user_id=$3',
        [data.fileId, chat.id, user(req).id],
      );
      requireValue(rows[0], 400, 'Файл недоступен.');
    }
    const { rows } = await db.query(
      'INSERT INTO messages(id,chat_id,sender_id,body,file_id,nonce) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(sender_id,nonce) DO NOTHING RETURNING id',
      [randomUUID(), chat.id, user(req).id, data.body, data.fileId, data.nonce],
    );
    if (rows[0]) {
      if (pushEnabled) await db.query('INSERT INTO push_jobs(message_id) VALUES($1)', [rows[0].id]);
      const reply = chat.nelya ? nelyaReply(data.body) : null;
      if (reply)
        await db.query('INSERT INTO messages(id,chat_id,body,nonce) VALUES($1,$2,$3,$4)', [
          randomUUID(),
          chat.id,
          reply,
          randomUUID(),
        ]);
      await notify(db, chat.id);
      return rows[0].id;
    }
    const existing = await db.query(
      'SELECT id FROM messages WHERE sender_id=$1 AND nonce=$2 AND chat_id=$3',
      [user(req).id, data.nonce, chat.id],
    );
    requireValue(existing.rows[0], 409, 'Идентификатор сообщения уже использован.');
    return existing.rows[0].id;
  });
  res.status(201).json({ id });
});
app.delete('/api/chats/:id/messages/:messageId', auth, async (req, res) => {
  await member(String(req.params.id), user(req).id);
  const result = await pool.query(
    'DELETE FROM messages WHERE id=$1 AND chat_id=$2 AND sender_id=$3',
    [uuid.parse(req.params.messageId), req.params.id, user(req).id],
  );
  requireValue(result.rowCount, 404, 'Можно удалить только своё сообщение.');
  await notify(pool, String(req.params.id), String(req.params.messageId));
  res.json({ ok: true });
});
app.post('/api/chats/:id/messages/:messageId/reactions', auth, async (req, res) => {
  await member(String(req.params.id), user(req).id);
  const { emoji } = z.object({ emoji: z.enum(['❤', '👍', '😂', '🔥']) }).parse(req.body);
  await transaction(async (db) => {
    const target = await db.query('SELECT id FROM messages WHERE id=$1 AND chat_id=$2 FOR UPDATE', [
      uuid.parse(req.params.messageId),
      req.params.id,
    ]);
    requireValue(target.rows[0], 404, 'Сообщение не найдено.');
    const result = await db.query(
      'DELETE FROM reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3',
      [req.params.messageId, user(req).id, emoji],
    );
    if (!result.rowCount)
      await db.query('INSERT INTO reactions(message_id,user_id,emoji) VALUES($1,$2,$3)', [
        req.params.messageId,
        user(req).id,
        emoji,
      ]);
    await notify(db, String(req.params.id));
  });
  res.json({ ok: true });
});
const upload = multer({
  storage: multer.diskStorage({
    destination: directory,
    filename: (_req, _file, cb) => cb(null, randomUUID()),
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 0 },
});
app.post(
  '/api/chats/:id/files',
  auth,
  async (req, res, next) => {
    try {
      await member(String(req.params.id), user(req).id);
      next();
    } catch (e) {
      next(e);
    }
  },
  upload.single('file'),
  async (req, res) => {
    requireValue(req.file, 400, 'Выберите файл.');
    const file = req.file!;
    try {
      const name =
        Buffer.from(file.originalname, 'latin1')
          .toString('utf8')
          .replace(/[\x00-\x1f\x7f/\\]/g, '_')
          .slice(0, 180) || 'Файл';
      const record = await transaction(async (db) => {
        await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user(req).id]);
        const usage = await db.query(
          'SELECT COALESCE(sum(size),0)::bigint AS total FROM files WHERE user_id=$1',
          [user(req).id],
        );
        requireValue(
          Number(usage.rows[0].total) + file.size <= 500 * 1024 * 1024,
          413,
          'Лимит файлов аккаунта — 500 МБ. Свяжитесь с владельцем сервера.',
        );
        const { rows } = await db.query(
          'INSERT INTO files(id,chat_id,user_id,name,size) VALUES($1,$2,$3,$4,$5) RETURNING id,name,size',
          [file.filename, req.params.id, user(req).id, name, file.size],
        );
        return rows[0];
      });
      res.status(201).json(record);
    } catch (error) {
      await unlink(file.path).catch(() => {});
      throw error;
    }
  },
);
app.get('/api/files/:id', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT f.* FROM files f JOIN members m ON m.chat_id=f.chat_id WHERE f.id=$1 AND m.user_id=$2',
    [uuid.parse(req.params.id), user(req).id],
  );
  requireValue(rows[0], 404, 'Файл не найден.');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.download(path.join(directory, rows[0].id), rows[0].name);
});
const streams = new Map<Response, { userId: string; token: string }>();
app.get('/api/events', auth, async (req, res) => {
  const uid = user(req).id,
    token = (req as AuthedRequest).sessionToken;
  if ([...streams.values()].filter((s) => s.userId === uid).length >= 8) {
    res.status(429).json({ error: 'Слишком много открытых вкладок.' });
    return;
  }
  res.set({
    'Content-Type': 'text/event-stream',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('data: {"type":"connected"}\n\n');
  streams.set(res, { userId: uid, token });
  const heartbeat = setInterval(async () => {
    try {
      const valid = await pool.query('SELECT 1 FROM sessions WHERE token=$1 AND expires_at>now()', [
        token,
      ]);
      if (!valid.rowCount) {
        res.end();
        return;
      }
      res.write(': heartbeat\n\n');
    } catch {
      res.end();
    }
  }, 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    streams.delete(res);
  });
});
let listener: Client | undefined,
  stopping = false;
async function listen() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  listener = client;
  client.on('error', () => client.end().catch(() => {}));
  client.on('end', () => {
    if (!stopping) setTimeout(() => listen().catch(() => {}), 2000).unref();
  });
  client.on('notification', async (event) => {
    try {
      if (!event.payload) return;
      const change = JSON.parse(event.payload) as { chatId: string; deletedId?: string };
      const { rows } = await pool.query('SELECT user_id FROM members WHERE chat_id=$1', [
        change.chatId,
      ]);
      const ids = new Set(rows.map((r) => r.user_id));
      for (const [res, info] of streams)
        if (ids.has(info.userId)) {
          if (res.writableLength > 1024 * 1024) {
            res.end();
            continue;
          }
          res.write(`data: ${JSON.stringify({ type: 'refresh', ...change })}\n\n`);
        }
    } catch (error) {
      console.error('Notification delivery failed', error);
    }
  });
  await client.connect();
  await client.query('LISTEN galinka');
  // A listener reconnection invalidates clients so missed transient notifications recover from PostgreSQL.
  for (const res of streams.keys()) res.write('data: {"type":"connected"}\n\n');
}
await listen();
app.use('/api', (_req, res) => res.status(404).json({ error: 'Маршрут не найден.' }));
const publicDir = path.resolve('dist');
if (production) {
  app.use(
    express.static(publicDir, {
      index: false,
      setHeaders(res, file) {
        if (file.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-store');
      },
    }),
  );
  app.get('/{*path}', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ error: 'Некорректный JSON.' });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({
      error:
        'Проверьте данные: логин — 3–24 латинских символа, пароль — от 10 символов. Поля не должны быть пустыми.',
    });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof multer.MulterError) {
    res.status(400).json({ error: 'Файл слишком большой. Максимум — 20 МБ, по одному файлу.' });
    return;
  }
  if ((error as { code?: string }).code === '23505') {
    res.status(409).json({ error: 'Этот логин уже занят.' });
    return;
  }
  if ((error as { code?: string }).code === '23503') {
    res.status(400).json({ error: 'Пользователь или файл не найден.' });
    return;
  }
  if ((error as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ error: 'Запрос слишком большой.' });
    return;
  }
  console.error(error);
  res.status(500).json({ error: 'Сервер не смог выполнить запрос. Попробуйте ещё раз.' });
});
const server = app.listen(Number(process.env.PORT) || 3001, '0.0.0.0', () =>
  console.log(`Galinka API on http://localhost:${process.env.PORT || 3001}`),
);
const stopPush = startPushWorker(pool);
server.requestTimeout = 120_000;
async function stop() {
  stopPush();
  stopping = true;
  for (const res of streams.keys()) res.end();
  server.close();
  await listener?.end();
  await pool.end();
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
// Expired sessions are small indexed deletes; external maintenance can replace this for a large deployment.
const cleanup = setInterval(
  () => pool.query('DELETE FROM sessions WHERE expires_at<now()').catch(console.error),
  3600_000,
);
cleanup.unref();
