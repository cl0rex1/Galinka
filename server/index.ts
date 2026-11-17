import express, { type Request, type Response, type NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import multer from 'multer';
import { Pool, Client, type PoolClient, type QueryResultRow } from 'pg';
import { createHash, randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import {
  copyFile,
  readFile,
  mkdir,
  unlink,
  open,
  opendir,
  writeFile,
  stat,
  truncate,
} from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z, ZodError } from 'zod';
import { digest, hashPassword, verifyPassword, readCookie } from './security.js';
import { migrate } from './migrate.js';
import { startTranscriptionWorker } from './transcription.js';
import {
  fileUsage,
  maxAccountFileBytes,
  maxUploadBytes,
  mediaMetaSchema,
  needsVideoWork,
  startMediaWorker,
  visualMeta,
  videoPath,
  voiceWaveform,
  type MediaMeta,
} from './media.js';
import { nelyaReply } from './nelya.js';
import {
  PreviewError,
  assertSafePublicUrl,
  downloadTikTokVideo,
  extractFirstUrl,
  fetchLinkPreview,
  fetchPreviewImage,
  searchGifs,
  type LinkPreviewData,
} from './previews.js';
import {
  AudioError,
  normalizeUploadedAudio,
  audioPreview,
  removeAudioPreview,
  isRecordedAudio,
} from './audio.js';
import {
  pushEnabled,
  anyPushEnabled,
  browserPushAvailable,
  webPushPublicKey,
  webPushEndpointSchema,
  webPushSubscriptionSchema,
  startPushWorker,
  messageInfoSQL,
  mentionsSQL,
  quietSQL,
  previewText,
} from './push.js';

const production = process.env.NODE_ENV === 'production';
const origin = process.env.APP_ORIGIN || 'http://localhost:5173';
const publicApiOrigin = process.env.PUBLIC_API_ORIGIN
  ? new URL(process.env.PUBLIC_API_ORIGIN).origin
  : undefined;
const apiOrigins = publicApiOrigin ? [publicApiOrigin] : [];
// Optional shared code. Without it, only one-time invites from the admin panel register accounts.
const inviteCode = process.env.INVITE_CODE || '';
if (inviteCode && inviteCode.length < 12)
  throw Error(
    'INVITE_CODE must be at least 12 characters, or empty to allow only one-time invites.',
  );
if (new URL(origin).origin !== origin)
  throw Error('APP_ORIGIN must be an origin without a path or trailing slash.');
if (production && !origin.startsWith('https://') && process.env.COOKIE_SECURE !== 'false')
  throw Error('APP_ORIGIN must use HTTPS (or set COOKIE_SECURE=false for local testing only).');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
const directory = path.resolve(process.env.UPLOAD_DIR || 'uploads');
await mkdir(directory, { recursive: true });
await migrate(pool);
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
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
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
        'img-src': ["'self'", 'blob:', 'data:', ...apiOrigins],
        'media-src': ["'self'", 'blob:', ...apiOrigins],
        'frame-src': [
          "'self'",
          'https://www.youtube.com',
          'https://www.youtube-nocookie.com',
          'https://open.spotify.com',
          'https://www.tiktok.com',
        ],
        'connect-src': ["'self'", ...apiOrigins],
        'object-src': ["'none'"],
        'upgrade-insecure-requests': production && origin.startsWith('https:') ? [] : null,
      },
    },
  }),
);
const startedAt = Date.now();
const httpMetrics = { total: 0, ok: 0, clientError: 0, serverError: 0 };
const metricsToken = process.env.METRICS_TOKEN || '';
app.use(express.json({ limit: '32kb' }));
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.on('finish', () => {
    httpMetrics.total++;
    if (res.statusCode >= 500) httpMetrics.serverError++;
    else if (res.statusCode >= 400) httpMetrics.clientError++;
    else httpMetrics.ok++;
  });
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
/** Endpoints that call third-party services on the user's behalf. */
const externalLimit = rateLimit({
  windowMs: 60_000,
  limit: 40,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Подождите минуту.' },
});
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
const personSQL = `id, username, name, color, role, avatar`;
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
type User = {
  id: string;
  username: string;
  name: string;
  color: number;
  role: 'admin' | 'user';
  avatar: string | null;
  show_last_seen: boolean;
  group_invites: 'all' | 'nobody';
  notify_preview: 'full' | 'sender' | 'none';
  notify_direct: boolean;
  notify_groups: boolean;
  mention_policy: 'all' | 'known' | 'none';
  quiet_from: number | null;
  quiet_to: number | null;
  time_zone: string;
};
const accountSQL = `show_last_seen,group_invites,notify_preview,notify_direct,notify_groups,mention_policy,quiet_from,quiet_to,time_zone`;
type AuthedRequest = Request & { user: User; sessionToken: string };
async function auth(req: Request, res: Response, next: NextFunction) {
  try {
    const raw = readCookie(req.headers.cookie);
    const token = digest(raw);
    const { rows } = await pool.query(
      `SELECT u.id,u.username,u.name,u.color,u.role,u.avatar,u.show_last_seen,u.group_invites,u.notify_preview,
       u.notify_direct,u.notify_groups,u.mention_policy,u.quiet_from,u.quiet_to,u.time_zone,(s.expires_at<now()+interval '15 days' OR s.last_seen_at<now()-interval '1 hour') AS stale
       FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=$1 AND s.expires_at>now() AND NOT u.blocked`,
      [token],
    );
    if (!rows[0]) {
      res.status(401).json({ error: 'Войдите снова.' });
      return;
    }
    const { stale, ...account } = rows[0];
    // Sliding expiry: active devices keep their session and push registrations.
    if (stale) {
      await pool.query(
        "UPDATE sessions SET expires_at=now()+interval '30 days',last_seen_at=now() WHERE token=$1",
        [token],
      );
      setSessionCookie(res, raw);
    }
    Object.assign(req, { user: account, sessionToken: token });
    next();
  } catch (error) {
    next(error);
  }
}
const user = (req: Request) => (req as AuthedRequest).user;
function admin(req: Request, _res: Response, next: NextFunction) {
  requireValue(user(req).role === 'admin', 403, 'Доступ только для администратора.');
  next();
}
async function member(chatId: string, userId: string, db: Pool | PoolClient = pool) {
  const { rows } = await db.query(
    'SELECT c.* FROM chats c JOIN members m ON m.chat_id=c.id WHERE c.id=$1 AND m.user_id=$2',
    [uuid.parse(chatId), userId],
  );
  requireValue(rows[0], 404, 'Чат не найден.');
  return rows[0];
}
// Membership changes and mutations share the chat lock, so a removed member cannot
// commit a message or upload after a concurrent removal has completed.
async function lockedMember(chatId: string, userId: string, db: PoolClient) {
  await db.query('SELECT id FROM chats WHERE id=$1 FOR UPDATE', [uuid.parse(chatId)]);
  return member(chatId, userId, db);
}
async function removeStoredFiles(ids: string[]) {
  await Promise.all(
    ids.map(async (id) => {
      const filename = path.join(directory, id);
      await unlink(filename).catch(() => {});
      await unlink(videoPath(directory, id)).catch(() => {});
      // Do not wait for a running decoder; its output is discarded when it finishes.
      void removeAudioPreview(filename);
    }),
  );
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
/** Saved Messages never notify the owner's other devices; a due reminder does (deliverScheduledRow). */
async function queuePush(db: PoolClient, chatKind: string, messageId: string, silent?: boolean) {
  if (anyPushEnabled && !silent && chatKind !== 'saved')
    await db.query('INSERT INTO push_jobs(message_id) VALUES($1)', [messageId]);
}
async function notify(
  db: Pool | PoolClient,
  chatId: string,
  deletedId?: string,
  removedUserId?: string,
  changedMessage?: {
    event: 'message.created' | 'message.updated';
    messageId: string;
    senderId: string;
    silent?: boolean;
    batch?: boolean;
  },
  forUserId?: string,
) {
  await db.query("SELECT pg_notify('galinka', $1)", [
    JSON.stringify({
      chatId,
      deletedId,
      removedUserId,
      forUserId,
      ...(changedMessage ? changedMessage : {}),
    }),
  ]);
}
const secure =
  process.env.COOKIE_SECURE === 'true' || (production && process.env.COOKIE_SECURE !== 'false');
function setSessionCookie(res: Response, token: string) {
  res.cookie('galinka', token, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    maxAge: 30 * 86400_000,
    path: '/',
  });
}
async function session(req: Request, res: Response, id: string) {
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    "INSERT INTO sessions(token,user_id,expires_at,user_agent) VALUES($1,$2,now()+interval '30 days',$3)",
    [digest(token), id, String(req.headers['user-agent'] || '').slice(0, 300)],
  );
  setSessionCookie(res, token);
}
app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1');
  res.status(listening ? 200 : 503).json({ ok: listening });
});
app.get('/api/version', (_req, res) => res.json(buildInfo));
app.get('/api/push/status', auth, (_req, res) =>
  res.json({
    enabled: pushEnabled,
    browserAvailable: browserPushAvailable,
    publicKey: webPushPublicKey,
  }),
);
const pushToken = z.object({
  token: z
    .string()
    .min(20)
    .max(4096)
    .regex(/^[A-Za-z0-9_:\-]+$/),
  /** The Android build draws its own notification with Reply / Mark as read. */
  actions: z.boolean().optional(),
});
app.post('/api/push/devices', auth, async (req, res) => {
  requireValue(pushEnabled, 503, 'Пуши пока не подключены.');
  const { token, actions } = pushToken.parse(req.body);
  await transaction(async (db) => {
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user(req).id]);
    await db.query(
      `INSERT INTO push_devices(token,user_id,session_token,native_actions) VALUES($1,$2,$3,$4)
      ON CONFLICT(token) DO UPDATE SET user_id=$2,session_token=$3,native_actions=$4,updated_at=now()`,
      [token, user(req).id, (req as AuthedRequest).sessionToken, actions === true],
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
app.post('/api/push/subscriptions', auth, async (req, res) => {
  requireValue(browserPushAvailable, 503, 'Уведомления пока недоступны.');
  const subscription = webPushSubscriptionSchema.parse(req.body);
  requireValue(
    !subscription.expirationTime || subscription.expirationTime > Date.now(),
    400,
    'Подписка истекла. Включите уведомления ещё раз.',
  );
  await transaction(async (db) => {
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user(req).id]);
    const { rowCount } = await db.query(
      'SELECT token FROM sessions WHERE token=$1 AND user_id=$2 AND expires_at>now() FOR SHARE',
      [(req as AuthedRequest).sessionToken, user(req).id],
    );
    requireValue(rowCount, 401, 'Войдите в Galinka.');
    await db.query(
      `INSERT INTO web_push_subscriptions(endpoint,user_id,session_token,p256dh,auth,expires_at)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(endpoint) DO UPDATE SET user_id=$2,session_token=$3,p256dh=$4,auth=$5,expires_at=$6,updated_at=now()`,
      [
        subscription.endpoint,
        user(req).id,
        (req as AuthedRequest).sessionToken,
        subscription.keys.p256dh,
        subscription.keys.auth,
        subscription.expirationTime ? new Date(subscription.expirationTime) : null,
      ],
    );
    await db.query(
      `DELETE FROM web_push_subscriptions WHERE user_id=$1 AND endpoint IN
       (SELECT endpoint FROM web_push_subscriptions WHERE user_id=$1 ORDER BY updated_at DESC,endpoint OFFSET 12)`,
      [user(req).id],
    );
  });
  res.json({ ok: true });
});
app.delete('/api/push/subscriptions', auth, async (req, res) => {
  const { endpoint } = z.object({ endpoint: webPushEndpointSchema }).parse(req.body);
  await pool.query('DELETE FROM web_push_subscriptions WHERE endpoint=$1 AND user_id=$2', [
    endpoint,
    user(req).id,
  ]);
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
async function createAccount(
  data: { username: string; name: string; password: string; role?: 'admin' | 'user' },
  invite?: string,
) {
  const id = randomUUID(),
    password = await hashPassword(data.password);
  return transaction(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO users(id,username,name,password,color,role) VALUES($1,$2,$3,$4,$5,$6) RETURNING ${personSQL}`,
      [id, data.username, data.name, password, Math.floor(Math.random() * 6), data.role || 'user'],
    );
    if (invite) {
      const used = await db.query(
        'UPDATE signup_invites SET used_by=$2,used_at=now() WHERE token=$1 AND used_at IS NULL AND expires_at>now()',
        [invite, id],
      );
      requireValue(used.rowCount, 403, 'Приглашение недействительно или уже использовано.');
    }
    const chatId = randomUUID();
    await db.query(
      "INSERT INTO chats(id,kind,title,owner_id,nelya) VALUES($1,'saved','Избранное',$2,true)",
      [chatId, id],
    );
    await db.query('INSERT INTO members(chat_id,user_id) VALUES($1,$2)', [chatId, id]);
    await db.query('INSERT INTO messages(id,chat_id,body,nonce) VALUES($1,$2,$3,$4)', [
      randomUUID(),
      chatId,
      'Здесь можно хранить заметки и файлы. Команды Нели: «@неля помощь».',
      randomUUID(),
    ]);
    return rows[0];
  });
}
app.post('/api/auth/register', authLimit, async (req, res) => {
  const data = credentials
    .extend({ name: z.string().trim().min(1).max(40), invite: z.string().max(200) })
    .parse(req.body);
  const code = data.invite.trim();
  const shared =
    Boolean(inviteCode) &&
    timingSafeEqual(Buffer.from(digest(code)), Buffer.from(digest(inviteCode)));
  requireValue(shared || code.length >= 20, 403, 'Код приглашения не подошёл.');
  const account = await createAccount(data, shared ? undefined : digest(code));
  await session(req, res, account.id);
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
  requireValue(account && valid, 401, 'Неверный логин или пароль.');
  requireValue(!account.blocked, 403, 'Аккаунт заблокирован.');
  await session(req, res, account.id);
  const { id, username, name, color, role } = account;
  res.json({ id, username, name, color, role });
});
/*
 * Sign in by QR, as in Telegram: a new device shows a code, a signed-in phone scans it and
 * confirms. The code carries only `token`; the new device also holds a private `key`, so a
 * photographed code cannot be used to collect the session. One use, two minutes.
 * ponytail: in-memory, one server instance; move to the database when running replicas.
 */
const qrLogins = new Map<
  string,
  { key: string; agent: string; expires: number; userId?: string }
>();
const qrToken = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
function liveQr(token: string) {
  const entry = qrLogins.get(token);
  if (entry && entry.expires < Date.now()) qrLogins.delete(token);
  return qrLogins.get(token);
}
app.post('/api/auth/qr', authLimit, (req, res) => {
  for (const [token, entry] of qrLogins) if (entry.expires < Date.now()) qrLogins.delete(token);
  requireValue(qrLogins.size < 5000, 503, 'Попробуйте войти по QR через минуту.');
  const token = randomBytes(24).toString('base64url');
  const key = randomBytes(32).toString('base64url');
  const expires = Date.now() + 120_000;
  qrLogins.set(token, {
    key,
    agent: String(req.headers['user-agent'] || '').slice(0, 300),
    expires,
  });
  res.json({ token, key, expires });
});
app.post('/api/auth/qr/poll', async (req, res) => {
  const { token, key } = z.object({ token: qrToken, key: z.string().max(64) }).parse(req.body);
  const entry = liveQr(token);
  requireValue(entry && entry.key === key, 410, 'QR-код устарел. Обновите его.');
  if (!entry!.userId) {
    res.json({ status: 'pending' });
    return;
  }
  qrLogins.delete(token);
  const { rows } = await pool.query(`SELECT ${personSQL},blocked FROM users WHERE id=$1`, [
    entry!.userId,
  ]);
  requireValue(rows[0] && !rows[0].blocked, 403, 'Аккаунт заблокирован.');
  await session(req, res, rows[0].id);
  const { id, username, name, color, role } = rows[0];
  res.json({ status: 'approved', person: { id, username, name, color, role } });
});
// The phone first sees which device asks, then approves.
app.post('/api/auth/qr/inspect', auth, (req, res) => {
  const entry = liveQr(qrToken.parse(req.body.token));
  requireValue(entry && !entry.userId, 410, 'QR-код устарел. Попросите показать новый.');
  res.json({ agent: entry!.agent });
});
app.post('/api/auth/qr/approve', auth, (req, res) => {
  const entry = liveQr(qrToken.parse(req.body.token));
  requireValue(entry && !entry.userId, 410, 'QR-код устарел. Попросите показать новый.');
  entry!.userId = user(req).id;
  res.json({ ok: true });
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
const endStreams = (userId: string, keep?: string) => {
  for (const [response, info] of streams)
    if (info.userId === userId && info.token !== keep) response.end();
};
app.post('/api/me/password', auth, authLimit, async (req, res) => {
  const { current, password } = z
    .object({ current: z.string().max(128), password: credentials.shape.password })
    .parse(req.body);
  const { rows } = await pool.query('SELECT password FROM users WHERE id=$1', [user(req).id]);
  requireValue(await verifyPassword(current, rows[0].password), 403, 'Текущий пароль не подошёл.');
  const token = (req as AuthedRequest).sessionToken;
  const hashed = await hashPassword(password);
  await transaction(async (db) => {
    await db.query('UPDATE users SET password=$1 WHERE id=$2', [hashed, user(req).id]);
    await db.query('DELETE FROM sessions WHERE user_id=$1 AND token<>$2', [user(req).id, token]);
  });
  endStreams(user(req).id, token);
  res.json({ ok: true });
});
app.get('/api/me/sessions', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT left(token,16) AS id,created_at,last_seen_at,user_agent,token=$2 AS current
     FROM sessions WHERE user_id=$1 AND expires_at>now() ORDER BY token=$2 DESC,last_seen_at DESC`,
    [user(req).id, (req as AuthedRequest).sessionToken],
  );
  res.json(rows);
});
app.delete('/api/me/sessions/:id', auth, async (req, res) => {
  const id = z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .parse(req.params.id);
  const token = (req as AuthedRequest).sessionToken;
  const { rows } = await pool.query(
    'DELETE FROM sessions WHERE user_id=$1 AND left(token,16)=$2 AND token<>$3 RETURNING token',
    [user(req).id, id, token],
  );
  requireValue(rows[0], 404, 'Сеанс не найден.');
  for (const [response, info] of streams) if (info.token === rows[0].token) response.end();
  res.json({ ok: true });
});
app.delete('/api/me/sessions', auth, async (req, res) => {
  const token = (req as AuthedRequest).sessionToken;
  await pool.query('DELETE FROM sessions WHERE user_id=$1 AND token<>$2', [user(req).id, token]);
  endStreams(user(req).id, token);
  res.json({ ok: true });
});
app.get('/api/users', auth, async (req, res) => {
  const q = z.string().trim().min(2).max(40).parse(req.query.q);
  const { rows } = await pool.query(
    `SELECT ${personSQL} FROM users WHERE id<>$1 AND NOT blocked AND (strpos(lower(name),lower($2))>0 OR strpos(username,lower($2))>0) ORDER BY username LIMIT 20`,
    [user(req).id, q],
  );
  res.json(rows);
});
const pageQuery = z.coerce.number().int().min(1).max(100000).default(1);
const accountFields = credentials.extend({
  name: z.string().trim().min(1).max(40),
  role: z.enum(['admin', 'user']).default('user'),
});
app.get('/api/admin/users', auth, admin, async (req, res) => {
  const q = z.string().trim().max(40).default('').parse(req.query.q);
  const page = pageQuery.parse(req.query.page);
  const where = 'strpos(lower(name),lower($1))>0 OR strpos(username,lower($1))>0';
  const { rows } = await pool.query(
    `SELECT ${personSQL},blocked,created_at FROM users WHERE ${where} ORDER BY created_at,id LIMIT 50 OFFSET $2`,
    [q, (page - 1) * 50],
  );
  const count = await pool.query(`SELECT count(*)::int AS total FROM users WHERE ${where}`, [q]);
  res.json({ items: rows, total: count.rows[0].total, page });
});
app.post('/api/admin/users', auth, admin, async (req, res) => {
  res.status(201).json(await createAccount(accountFields.parse(req.body)));
});
app.patch('/api/admin/users/:id', auth, admin, async (req, res) => {
  const id = uuid.parse(req.params.id);
  const data = accountFields
    .partial()
    .extend({ role: z.enum(['admin', 'user']).optional(), blocked: z.boolean().optional() })
    .strict()
    .parse(req.body);
  const password = data.password === undefined ? undefined : await hashPassword(data.password);
  const account = await transaction(async (db) => {
    // Serialize role/block changes so concurrent requests cannot remove the last active admin.
    await db.query('SELECT pg_advisory_xact_lock(648292)');
    const actor = await db.query(
      "SELECT 1 FROM users WHERE id=$1 AND role='admin' AND NOT blocked",
      [user(req).id],
    );
    requireValue(actor.rowCount, 403, 'Права администратора изменились. Войдите снова.');
    const { rows } = await db.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [id]);
    requireValue(rows[0], 404, 'Пользователь не найден.');
    const current = rows[0];
    if (
      current.role === 'admin' &&
      !current.blocked &&
      (data.role === 'user' || data.blocked === true)
    ) {
      const others = await db.query(
        "SELECT 1 FROM users WHERE role='admin' AND NOT blocked AND id<>$1 LIMIT 1",
        [id],
      );
      requireValue(others.rowCount, 409, 'Нельзя отключить последнего активного администратора.');
    }
    const result = await db.query(
      `UPDATE users SET username=COALESCE($1,username),name=COALESCE($2,name),role=COALESCE($3,role),blocked=COALESCE($4,blocked),password=COALESCE($5,password) WHERE id=$6 RETURNING ${personSQL},blocked,created_at`,
      [data.username, data.name, data.role, data.blocked, password, id],
    );
    if (
      data.blocked === true ||
      password !== undefined ||
      (data.role !== undefined && data.role !== current.role)
    ) {
      await db.query('DELETE FROM sessions WHERE user_id=$1', [id]);
      await db.query("SELECT pg_notify('galinka',$1)", [JSON.stringify({ revokedUserId: id })]);
    }
    return result.rows[0];
  });
  res.json(account);
});
app.get('/api/admin/invites', auth, admin, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT left(i.token,16) AS id,i.note,i.created_at,i.expires_at,i.used_at,u.name AS used_by
     FROM signup_invites i LEFT JOIN users u ON u.id=i.used_by ORDER BY i.created_at DESC LIMIT 50`,
  );
  res.json(rows);
});
app.post('/api/admin/invites', auth, admin, async (req, res) => {
  const { note, days } = z
    .object({
      note: z.string().trim().max(80).default(''),
      days: z.number().int().min(1).max(30).default(7),
    })
    .parse(req.body);
  const token = randomBytes(24).toString('base64url');
  await pool.query(
    'INSERT INTO signup_invites(token,created_by,note,expires_at) VALUES($1,$2,$3,now()+make_interval(days=>$4))',
    [digest(token), user(req).id, note, days],
  );
  res.status(201).json({ url: `${origin}/app?signup=${token}` });
});
app.delete('/api/admin/invites/:id', auth, admin, async (req, res) => {
  const id = z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .parse(req.params.id);
  const result = await pool.query(
    'DELETE FROM signup_invites WHERE left(token,16)=$1 AND used_at IS NULL',
    [id],
  );
  requireValue(result.rowCount, 404, 'Приглашение не найдено или уже использовано.');
  res.json({ ok: true });
});
const announcementFields = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(10000),
  published: z.boolean().default(false),
});
async function announcements(req: Request, res: Response, all: boolean) {
  const page = pageQuery.parse(req.query.page);
  const where = all ? 'true' : 'published';
  const { rows } = await pool.query(
    `SELECT id,title,body,published,author_id,created_at,updated_at FROM announcements WHERE ${where} ORDER BY updated_at DESC,id DESC LIMIT 50 OFFSET $1`,
    [(page - 1) * 50],
  );
  const count = await pool.query(`SELECT count(*)::int AS total FROM announcements WHERE ${where}`);
  res.json({ items: rows, total: count.rows[0].total, page });
}
app.get('/api/announcements', auth, (req, res) => announcements(req, res, false));
app.get('/api/admin/announcements', auth, admin, (req, res) => announcements(req, res, true));
app.post('/api/admin/announcements', auth, admin, async (req, res) => {
  const data = announcementFields.parse(req.body);
  const { rows } = await pool.query(
    'INSERT INTO announcements(id,title,body,published,author_id) VALUES($1,$2,$3,$4,$5) RETURNING *',
    [randomUUID(), data.title, data.body, data.published, user(req).id],
  );
  res.status(201).json(rows[0]);
});
app.patch('/api/admin/announcements/:id', auth, admin, async (req, res) => {
  const data = announcementFields
    .partial()
    .extend({ published: z.boolean().optional() })
    .strict()
    .parse(req.body);
  const { rows } = await pool.query(
    'UPDATE announcements SET title=COALESCE($1,title),body=COALESCE($2,body),published=COALESCE($3,published),updated_at=now() WHERE id=$4 RETURNING *',
    [data.title, data.body, data.published, uuid.parse(req.params.id)],
  );
  requireValue(rows[0], 404, 'Объявление не найдено.');
  res.json(rows[0]);
});
app.delete('/api/admin/announcements/:id', auth, admin, async (req, res) => {
  const result = await pool.query('DELETE FROM announcements WHERE id=$1', [
    uuid.parse(req.params.id),
  ]);
  requireValue(result.rowCount, 404, 'Объявление не найдено.');
  res.json({ ok: true });
});
/**
 * What one person may see of another's activity, as in Telegram. Online means an open event
 * stream. Hiding your last seen hides it from everyone and, in return, hides theirs from you:
 * both then see only "recently" (within a week).
 */
function presence<
  T extends { id: string; last_seen_at?: string | Date | null; show_last_seen?: boolean },
>(person: T, viewerShows: boolean) {
  const { last_seen_at: seenAt, show_last_seen: shows, ...rest } = person;
  const online = [...streams.values()].some((stream) => stream.userId === person.id);
  const last = seenAt ? new Date(seenAt).toISOString() : null;
  if (viewerShows && shows !== false) return { ...rest, seen: online ? 'online' : last };
  const recent = online || (last !== null && Date.now() - Date.parse(last) < 7 * 86400_000);
  return { ...rest, seen: recent ? 'recently' : null };
}
async function refuseGroupInvites(db: PoolClient, ids: string[], inviter: string) {
  const { rows } = await db.query(
    "SELECT name FROM users WHERE id=ANY($1::uuid[]) AND id<>$2 AND group_invites='nobody'",
    [ids, inviter],
  );
  requireValue(
    !rows.length,
    403,
    `${rows.map((row) => row.name).join(', ')} не разрешает добавлять себя в группы. Отправьте ссылку-приглашение.`,
  );
}
app.patch('/api/me/settings', auth, async (req, res) => {
  const data = z
    .object({
      show_last_seen: z.boolean().optional(),
      group_invites: z.enum(['all', 'nobody']).optional(),
      notify_preview: z.enum(['full', 'sender', 'none']).optional(),
      notify_direct: z.boolean().optional(),
      notify_groups: z.boolean().optional(),
      mention_policy: z.enum(['all', 'known', 'none']).optional(),
      /** Minutes after local midnight; null turns quiet hours off. */
      quiet_hours: z
        .object({
          from: z.number().int().min(0).max(1439),
          to: z.number().int().min(0).max(1439),
        })
        .nullable()
        .optional(),
      time_zone: z.string().min(1).max(64).optional(),
    })
    .strict()
    .parse(req.body);
  if (data.time_zone) {
    const known = await pool.query('SELECT 1 FROM pg_timezone_names WHERE name=$1', [
      data.time_zone,
    ]);
    requireValue(known.rowCount, 400, 'Неизвестный часовой пояс.');
  }
  const { rows } = await pool.query(
    `UPDATE users SET show_last_seen=COALESCE($1,show_last_seen),group_invites=COALESCE($2,group_invites),
     notify_preview=COALESCE($3,notify_preview),notify_direct=COALESCE($4,notify_direct),
     notify_groups=COALESCE($5,notify_groups),mention_policy=COALESCE($6,mention_policy),
     quiet_from=CASE WHEN $7 THEN $8::smallint ELSE quiet_from END,
     quiet_to=CASE WHEN $7 THEN $9::smallint ELSE quiet_to END,
     time_zone=COALESCE($10,time_zone) WHERE id=$11
     RETURNING ${personSQL},${accountSQL}`,
    [
      data.show_last_seen ?? null,
      data.group_invites ?? null,
      data.notify_preview ?? null,
      data.notify_direct ?? null,
      data.notify_groups ?? null,
      data.mention_policy ?? null,
      data.quiet_hours !== undefined,
      data.quiet_hours?.from ?? null,
      data.quiet_hours?.to ?? null,
      data.time_zone ?? null,
      user(req).id,
    ],
  );
  res.json(rows[0]);
});
// Desktop and in-app notifications ask for the text the same way pushes build it.
app.get('/api/messages/:id/notification', auth, async (req, res) => {
  const id = uuid.parse(req.params.id);
  // The same decision a push makes: whether to show it at all, and whether without a sound.
  const { rows } = await pool.query(
    `SELECT info.*,
       (c.kind='group' AND ${mentionsSQL('msg', '$2')}) AS mention,
       (c.kind='saved' OR (c.kind='group' AND ${mentionsSQL('msg', '$2')})
         OR (NOT member.muted AND CASE c.kind WHEN 'direct' THEN recipient.notify_direct WHEN 'group' THEN recipient.notify_groups ELSE true END)) AS notify,
       ${quietSQL} AS quiet
     FROM (${messageInfoSQL}) info
     JOIN messages msg ON msg.id=$1 JOIN chats c ON c.id=msg.chat_id
     JOIN members member ON member.chat_id=msg.chat_id AND member.user_id=$2
     JOIN users recipient ON recipient.id=$2`,
    [id, user(req).id],
  );
  requireValue(rows[0], 404, 'Сообщение не найдено.');
  const { mention, notify, quiet } = rows[0];
  res.json({ ...previewText(rows[0], user(req).notify_preview), mention, notify, quiet });
});
app.get('/api/chats', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.id,c.kind,c.owner_id,c.nelya,c.created_at,c.avatar,c.auto_delete_seconds,m.read_at,m.pinned,m.muted,m.sound,m.archived,m.draft,m.draft_updated_at,
 CASE WHEN c.kind='direct' THEN peer.name ELSE c.title END AS title,
 (SELECT count(*)::int FROM members WHERE chat_id=c.id) AS member_count,
 (SELECT count(*)::int FROM scheduled_messages sm WHERE sm.chat_id=c.id AND sm.sender_id=$1) AS scheduled_count,
 CASE WHEN peer.id IS NULL THEN NULL ELSE json_build_object('id',peer.id,'name',peer.name,'username',peer.username,'color',peer.color,'avatar',peer.avatar,'last_seen_at',peer.last_seen_at,'show_last_seen',peer.show_last_seen) END AS peer,
 CASE WHEN last.created_at IS NULL THEN NULL ELSE json_build_object('body',last.body,'created_at',last.created_at,'sender_id',last.sender_id,'file_id',last.file_id,'file',last.file) END AS last_message,
 (SELECT count(*)::int FROM messages WHERE chat_id=c.id AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at>now()) AND NOT EXISTS(SELECT 1 FROM hidden_messages hm WHERE hm.message_id=messages.id AND hm.user_id=$1) AND created_at>m.read_at AND sender_id IS DISTINCT FROM $1) AS unread,
 CASE WHEN c.kind='group' THEN (SELECT count(*)::int FROM messages WHERE chat_id=c.id AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at>now()) AND NOT EXISTS(SELECT 1 FROM hidden_messages hm WHERE hm.message_id=messages.id AND hm.user_id=$1) AND created_at>m.read_at AND sender_id IS DISTINCT FROM $1 AND ${mentionsSQL('messages', '$1')}) ELSE 0 END AS unread_mentions,
 (SELECT json_build_object('id',pm.id,'body',pm.body,'file_name',pf.name) FROM messages pm LEFT JOIN files pf ON pf.id=pm.file_id
   WHERE pm.id=c.pinned_message_id AND pm.deleted_at IS NULL AND (pm.expires_at IS NULL OR pm.expires_at>now()) AND NOT EXISTS(SELECT 1 FROM hidden_messages hm WHERE hm.message_id=pm.id AND hm.user_id=$1)) AS pinned_message
 FROM chats c JOIN members m ON m.chat_id=c.id
 LEFT JOIN LATERAL (SELECT u.id,u.name,u.username,u.color,u.avatar,u.last_seen_at,u.show_last_seen FROM members mm JOIN users u ON u.id=mm.user_id
   WHERE c.kind='direct' AND mm.chat_id=c.id AND mm.user_id<>$1 LIMIT 1) peer ON true
 LEFT JOIN LATERAL (SELECT lm.body,lm.created_at,lm.sender_id,lm.file_id,
   CASE WHEN f.id IS NULL THEN NULL ELSE json_build_object('id',f.id,'name',f.name,'size',f.size,'mime',f.mime,'width',f.width,'height',f.height,'thumb',f.thumb,'waveform',f.waveform) END AS file
   FROM messages lm LEFT JOIN files f ON f.id=lm.file_id WHERE lm.chat_id=c.id AND lm.deleted_at IS NULL AND (lm.expires_at IS NULL OR lm.expires_at>now()) AND NOT EXISTS(SELECT 1 FROM hidden_messages hm WHERE hm.message_id=lm.id AND hm.user_id=$1)
   ORDER BY lm.created_at DESC,lm.id DESC LIMIT 1) last ON true
 WHERE m.user_id=$1 ORDER BY m.pinned DESC,COALESCE(last.created_at,c.created_at) DESC,c.id`,
    [user(req).id],
  );
  const viewer = user(req).show_last_seen !== false;
  res.json(rows.map((row) => (row.peer ? { ...row, peer: presence(row.peer, viewer) } : row)));
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
    const available = await db.query(
      'SELECT id FROM users WHERE id=ANY($1::uuid[]) AND NOT blocked',
      [ids],
    );
    requireValue(available.rowCount === ids.length, 400, 'Один из пользователей недоступен.');
    if (data.kind === 'group') await refuseGroupInvites(db, ids, user(req).id);
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
  // Recheck access in the data snapshot in case membership changed after the 404 check.
  const { rows } = await pool.query(
    `SELECT u.id,u.name,u.username,u.color,u.avatar,u.last_seen_at,u.show_last_seen FROM members m JOIN users u ON u.id=m.user_id
     WHERE m.chat_id=$1 AND EXISTS(SELECT 1 FROM members viewer WHERE viewer.chat_id=m.chat_id AND viewer.user_id=$2) ORDER BY u.name`,
    [req.params.id, user(req).id],
  );
  const viewer = user(req).show_last_seen !== false;
  res.json(rows.map((row) => presence(row, viewer)));
});
app.patch('/api/chats/:id', auth, async (req, res) => {
  const data = z
    .object({
      nelya: z.boolean().optional(),
      title: z.string().trim().min(1).max(70).optional(),
      ownerId: uuid.optional(),
      autoDeleteSeconds: z
        .number()
        .int()
        .min(0)
        .max(365 * 86400)
        .nullable()
        .optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0)
    .parse(req.body);
  await transaction(async (db) => {
    const chat = await lockedMember(String(req.params.id), user(req).id, db);
    const ownerOnlyChanged =
      data.nelya !== undefined || data.title !== undefined || data.ownerId !== undefined;
    if (ownerOnlyChanged)
      requireValue(chat.owner_id === user(req).id, 403, 'Настройки меняет создатель чата.');
    if (data.autoDeleteSeconds !== undefined)
      requireValue(
        chat.kind !== 'group' || chat.owner_id === user(req).id,
        403,
        'Таймер автоудаления в группе меняет владелец.',
      );
    requireValue(
      data.title === undefined || chat.kind === 'group',
      400,
      'Переименовать можно только группу.',
    );
    if (data.ownerId) {
      requireValue(chat.kind === 'group', 400, 'Передать владение можно только группой.');
      const target = await db.query(
        'SELECT 1 FROM members m JOIN users u ON u.id=m.user_id WHERE m.chat_id=$1 AND m.user_id=$2 AND NOT u.blocked',
        [chat.id, data.ownerId],
      );
      requireValue(target.rowCount, 400, 'Новый владелец должен быть участником группы.');
    }
    const setTimer = data.autoDeleteSeconds !== undefined;
    const timerValue =
      data.autoDeleteSeconds && data.autoDeleteSeconds > 0 ? data.autoDeleteSeconds : null;
    await db.query(
      'UPDATE chats SET nelya=COALESCE($1,nelya),title=COALESCE($2,title),owner_id=COALESCE($3,owner_id),auto_delete_seconds=CASE WHEN $5::boolean THEN $4::integer ELSE auto_delete_seconds END WHERE id=$6',
      [data.nelya, data.title, data.ownerId, timerValue, setTimer, chat.id],
    );
    await notify(db, chat.id);
  });
  res.json({ ok: true });
});
app.patch('/api/chats/:id/preferences', auth, async (req, res) => {
  const data = z
    .object({
      pinned: z.boolean().optional(),
      muted: z.boolean().optional(),
      archived: z.boolean().optional(),
      /** Notification sound for this chat; "silent" still notifies, without a sound. */
      sound: z.enum(['default', 'soft', 'bright', 'silent']).optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0)
    .parse(req.body);
  await transaction(async (db) => {
    const chat = await lockedMember(String(req.params.id), user(req).id, db);
    await db.query(
      'UPDATE members SET pinned=COALESCE($1,pinned),muted=COALESCE($2,muted),archived=COALESCE($3,archived),sound=COALESCE($6,sound) WHERE chat_id=$4 AND user_id=$5',
      [data.pinned, data.muted, data.archived, chat.id, user(req).id, data.sound],
    );
    await notify(db, chat.id);
  });
  res.json({ ok: true });
});
app.put('/api/chats/:id/draft', auth, async (req, res) => {
  const { draft } = z
    .object({ draft: z.string().max(8000) })
    .strict()
    .parse(req.body);
  const chat = await member(String(req.params.id), user(req).id);
  await pool.query(
    'UPDATE members SET draft=$1,draft_updated_at=clock_timestamp() WHERE chat_id=$2 AND user_id=$3',
    [draft, chat.id, user(req).id],
  );
  // The text is read back per stream: pg_notify payloads stop at 8000 bytes. The device that
  // typed it is skipped, or a late echo would overwrite what it typed since.
  await pool.query("SELECT pg_notify('galinka', $1)", [
    JSON.stringify({
      type: 'draft',
      chatId: chat.id,
      forUserId: user(req).id,
      origin: digest((req as AuthedRequest).sessionToken),
    }),
  ]);
  res.json({ ok: true, draft });
});
app.post('/api/chats/:id/members', auth, async (req, res) => {
  const { userIds } = z
    .object({ userIds: z.array(uuid).min(1).max(99) })
    .strict()
    .parse(req.body);
  await transaction(async (db) => {
    const chat = await lockedMember(String(req.params.id), user(req).id, db);
    requireValue(
      chat.kind === 'group' && chat.owner_id === user(req).id,
      403,
      'Участников добавляет владелец группы.',
    );
    const ids = [...new Set<string>(userIds)];
    const available = await db.query(
      'SELECT id FROM users WHERE id=ANY($1::uuid[]) AND NOT blocked',
      [ids],
    );
    requireValue(available.rowCount === ids.length, 400, 'Один из пользователей недоступен.');
    await refuseGroupInvites(db, ids, user(req).id);
    const size = await db.query(
      'SELECT count(*)::int AS n FROM (SELECT user_id FROM members WHERE chat_id=$1 UNION SELECT unnest($2::uuid[])) people',
      [chat.id, ids],
    );
    requireValue(size.rows[0].n <= 100, 400, 'В группе может быть до 100 участников.');
    await db.query(
      'INSERT INTO members(chat_id,user_id) SELECT $1,unnest($2::uuid[]) ON CONFLICT DO NOTHING',
      [chat.id, ids],
    );
    await notify(db, chat.id);
  });
  res.json({ ok: true });
});
app.delete('/api/chats/:id/members/:userId', auth, async (req, res) => {
  const targetId = uuid.parse(req.params.userId);
  const removedFiles = await transaction(async (db) => {
    const chat = await lockedMember(String(req.params.id), user(req).id, db);
    requireValue(chat.kind === 'group', 400, 'Выйти можно только из группы.');
    requireValue(
      targetId === user(req).id || chat.owner_id === user(req).id,
      403,
      'Участников удаляет владелец группы.',
    );
    const target = await db.query('SELECT 1 FROM members WHERE chat_id=$1 AND user_id=$2', [
      chat.id,
      targetId,
    ]);
    requireValue(target.rowCount, 404, 'Участник не найден.');
    if (targetId === chat.owner_id) {
      const size = await db.query('SELECT count(*)::int AS n FROM members WHERE chat_id=$1', [
        chat.id,
      ]);
      requireValue(size.rows[0].n === 1, 409, 'Сначала передайте владение другому участнику.');
      // Attachments forwarded to other chats move there instead of disappearing.
      await db.query(
        `UPDATE files f SET chat_id=used.chat_id FROM (SELECT DISTINCT ON (file_id) file_id,chat_id
         FROM messages WHERE file_id IS NOT NULL AND chat_id<>$1) used WHERE f.id=used.file_id AND f.chat_id=$1`,
        [chat.id],
      );
      const files = await db.query('SELECT id FROM files WHERE chat_id=$1', [chat.id]);
      await db.query('DELETE FROM chats WHERE id=$1', [chat.id]);
      await notify(db, chat.id, undefined, targetId);
      return files.rows.map((file) => file.id as string);
    }
    await db.query('DELETE FROM members WHERE chat_id=$1 AND user_id=$2', [chat.id, targetId]);
    // A removed participant must not regain access using a previously issued link.
    await db.query('DELETE FROM invites WHERE chat_id=$1', [chat.id]);
    await notify(db, chat.id, undefined, targetId);
    return [];
  });
  await removeStoredFiles(removedFiles);
  res.json({ ok: true });
});
app.post('/api/chats/:id/read', auth, async (req, res) => {
  await member(String(req.params.id), user(req).id);
  const { lastMessageId } = z.object({ lastMessageId: uuid }).parse(req.body);
  await transaction(async (db) => {
    const updated = await db.query(
      `UPDATE members SET read_at=GREATEST(members.read_at,msg.created_at),receipt_at=msg.created_at
       FROM messages msg WHERE members.chat_id=$1 AND members.user_id=$2 AND msg.id=$3 AND msg.chat_id=$1
       AND (members.receipt_at IS NULL OR members.receipt_at<msg.created_at)`,
      [req.params.id, user(req).id, lastMessageId],
    );
    if (updated.rowCount)
      await db.query("SELECT pg_notify('galinka', $1)", [
        JSON.stringify({
          type: 'read',
          chatId: String(req.params.id),
          userId: user(req).id,
          lastMessageId: String(lastMessageId),
        }),
      ]);
  });
  res.json({ ok: true });
});
// Unread messages that name the viewer, oldest first: where the "@" button leads.
app.get('/api/chats/:id/mentions', auth, async (req, res) => {
  const chat = await member(String(req.params.id), user(req).id);
  if (chat.kind !== 'group') return res.json([]);
  const { rows } = await pool.query(
    `SELECT msg.id FROM messages msg JOIN members mem ON mem.chat_id=msg.chat_id AND mem.user_id=$2
     WHERE msg.chat_id=$1 AND msg.deleted_at IS NULL AND (msg.expires_at IS NULL OR msg.expires_at>now())
     AND NOT EXISTS(SELECT 1 FROM hidden_messages hm WHERE hm.message_id=msg.id AND hm.user_id=$2)
     AND msg.created_at>mem.read_at AND msg.sender_id IS DISTINCT FROM $2 AND ${mentionsSQL('msg', '$2')}
     ORDER BY msg.created_at,msg.id LIMIT 100`,
    [chat.id, user(req).id],
  );
  res.json(rows.map((row) => row.id));
});
app.post('/api/chats/:id/invite', auth, async (req, res) => {
  const token = randomBytes(24).toString('base64url');
  await transaction(async (db) => {
    const chat = await lockedMember(String(req.params.id), user(req).id, db);
    requireValue(
      chat.kind === 'group' && chat.owner_id === user(req).id,
      403,
      'Приглашение создаёт владелец группы.',
    );
    await db.query('INSERT INTO invites(token,chat_id) VALUES($1,$2)', [digest(token), chat.id]);
  });
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
    // The chat lock may have waited behind a removal which revoked this link.
    const valid = await db.query(
      'SELECT 1 FROM invites WHERE token=$1 AND chat_id=$2 AND expires_at>now()',
      [digest(token), id],
    );
    requireValue(valid.rowCount, 404, 'Приглашение истекло или не существует.');
    const size = await db.query('SELECT count(*)::int AS n FROM members WHERE chat_id=$1', [id]);
    const existing = await db.query('SELECT 1 FROM members WHERE chat_id=$1 AND user_id=$2', [
      id,
      user(req).id,
    ]);
    requireValue(
      existing.rowCount || size.rows[0].n < 100,
      400,
      'В группе может быть до 100 участников.',
    );
    await db.query('INSERT INTO members(chat_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [
      id,
      user(req).id,
    ]);
    await notify(db, id);
    return id;
  });
  res.json({ id });
});
const emojiSchema = z
  .string()
  .trim()
  .min(1)
  .max(16)
  .refine(
    (v) =>
      /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|[\u200d\ufe0f\u20e3#*0-9])+$/u.test(
        v,
      ) && /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(v),
    'Выберите корректный эмодзи.',
  );

async function cachedLinkPreview(url: string) {
  const { rows } = await pool.query<{ preview: LinkPreviewData }>(
    "SELECT preview FROM link_previews WHERE url=$1 AND fetched_at>now()-interval '7 days'",
    [url],
  );
  return rows[0]?.preview ?? null;
}
async function resolveLinkPreview(text: string): Promise<LinkPreviewData | null> {
  const url = extractFirstUrl(text);
  if (!url) return null;
  const cached = await cachedLinkPreview(url);
  if (cached) return cached;
  try {
    const preview = await fetchLinkPreview(url);
    if (preview) {
      await pool.query(
        `INSERT INTO link_previews(url,preview,fetched_at) VALUES($1,$2,clock_timestamp())
         ON CONFLICT(url) DO UPDATE SET preview=$2,fetched_at=clock_timestamp()`,
        [url, JSON.stringify(preview)],
      );
    }
    return preview;
  } catch {
    return null;
  }
}
/**
 * The card for a message's first link. A cached card is stored with the message; otherwise the
 * message goes out at once and the card is attached by `attachLinkPreview` when the site answers.
 */
async function instantLinkPreview(text: string) {
  const url = extractFirstUrl(text);
  return url ? cachedLinkPreview(url) : null;
}
function attachLinkPreview(chatId: string, messageId: string, senderId: string, body: string) {
  if (!extractFirstUrl(body)) return;
  void resolveLinkPreview(body)
    .then(async (preview) => {
      if (!preview || stopping) return;
      // Skip when the text was edited meanwhile or the card is already there.
      const { rowCount } = await pool.query(
        'UPDATE messages SET link_preview=$1 WHERE id=$2 AND body=$3 AND link_preview IS NULL AND deleted_at IS NULL',
        [JSON.stringify(preview), messageId, body],
      );
      if (rowCount)
        await notify(pool, chatId, undefined, undefined, {
          event: 'message.updated',
          messageId,
          senderId,
        });
    })
    .catch((error) => console.error('link preview', error));
}

const pollSelectSQL = `CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object(
  'id',p.id,'question',p.question,'multiple',p.multiple,'anonymous',p.anonymous,'closed',p.closed,
  'total_votes',COALESCE((SELECT count(DISTINCT pv.user_id)::int FROM poll_votes pv WHERE pv.poll_id=p.id),0),
  'options',COALESCE((
    SELECT json_agg(json_build_object(
      'index',o.idx-1,
      'text',o.val,
      'votes',COALESCE((SELECT count(*)::int FROM poll_votes pv WHERE pv.poll_id=p.id AND pv.option_index=(o.idx-1)),0),
      'voted',EXISTS(SELECT 1 FROM poll_votes pv WHERE pv.poll_id=p.id AND pv.option_index=(o.idx-1) AND pv.user_id=$2),
      'voters',CASE WHEN p.anonymous THEN NULL ELSE COALESCE((
        SELECT json_agg(json_build_object('id',vu.id,'name',vu.name,'avatar',vu.avatar,'color',vu.color) ORDER BY vu.name)
        FROM poll_votes pv JOIN users vu ON vu.id=pv.user_id WHERE pv.poll_id=p.id AND pv.option_index=(o.idx-1)
      ),'[]'::json) END
    ) ORDER BY o.idx)
    FROM jsonb_array_elements_text(p.options) WITH ORDINALITY AS o(val,idx)
  ),'[]'::json)
) END AS poll`;

/** @все or @all as a word of its own; the client highlights by the same rule. */
/** The nonce of the n-th message of an album, stable across retries of the same request. */
const derivedNonce = (nonce: string, index: number) => {
  const hex = createHash('sha256').update(`${nonce}:${index}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const MENTION_ALL = /(^|[^\p{L}\p{N}_@])@(все|all)(?![\p{L}\p{N}_])/iu;
const visibleMessageWhere = `m.deleted_at IS NULL AND (m.expires_at IS NULL OR m.expires_at>now()) AND NOT EXISTS(SELECT 1 FROM hidden_messages hm WHERE hm.message_id=m.id AND hm.user_id=$2)`;

async function voiceTranscript(req: Request, res: Response) {
  const fileId = uuid.parse(req.params.id);
  const { rows } = await pool.query(
    `SELECT f.name,f.mime,t.state,t.transcript FROM files f
     LEFT JOIN voice_transcripts t ON t.file_id=f.id
     WHERE f.id=$1 AND EXISTS(SELECT 1 FROM messages m JOIN members mm ON mm.chat_id=m.chat_id
       WHERE m.file_id=f.id AND mm.user_id=$2 AND ${visibleMessageWhere})`,
    [fileId, user(req).id],
  );
  const voice = rows[0];
  requireValue(
    voice?.name.startsWith('Голосовое-') && isRecordedAudio(voice.mime),
    404,
    'Голосовое не найдено.',
  );
  if (voice.state === 'ready') {
    res.json({ state: 'ready', text: voice.transcript });
    return;
  }
  requireValue(process.env.WHISPER_MODEL, 503, 'На сервере не настроена расшифровка голосовых.');
  if (req.method === 'POST') {
    if (!voice.state || voice.state === 'failed') {
      await pool.query(
        `INSERT INTO voice_transcripts(file_id) VALUES($1)
         ON CONFLICT(file_id) DO UPDATE SET state='pending',updated_at=now()
         WHERE voice_transcripts.state='failed'`,
        [fileId],
      );
    }
  } else {
    requireValue(voice.state, 404, 'Расшифровку ещё не запрашивали.');
    requireValue(
      voice.state !== 'failed',
      422,
      'Не удалось расшифровать голосовое. Попробуйте ещё раз.',
    );
  }
  res.status(202).json({ state: 'pending' });
}
app.route('/api/files/:id/transcription').post(auth, voiceTranscript).get(auth, voiceTranscript);

const messageSQL = `SELECT m.id,m.chat_id,m.sender_id,m.body,m.created_at,m.edited_at,m.expires_at,m.link_preview,m.nonce,m.forwarded_from,m.mention_all,m.album_id,
 CASE WHEN u.id IS NULL THEN json_build_object('id','nelya','name','Неля','username','nelya','color',5) ELSE json_build_object('id',u.id,'name',u.name,'username',u.username,'color',u.color) END AS sender,
 CASE WHEN f.id IS NULL THEN NULL ELSE json_build_object('id',f.id,'name',f.name,'size',f.size,'mime',f.mime,'width',f.width,'height',f.height,'thumb',f.thumb,'waveform',f.waveform) END AS file,
 CASE WHEN replied.id IS NULL THEN NULL ELSE json_build_object('id',replied.id,'body',replied.body,'sender',json_build_object('id',COALESCE(reply_user.id::text,'nelya'),'name',COALESCE(reply_user.name,'Неля')),'file_name',reply_file.name) END AS reply,
 ${pollSelectSQL},
 (SELECT count(*)::int FROM members reader WHERE reader.chat_id=m.chat_id AND reader.user_id IS DISTINCT FROM m.sender_id AND reader.receipt_at>=m.created_at) AS read_by,
 COALESCE((SELECT json_agg(r) FROM (SELECT emoji,count(*)::int AS count,bool_or(user_id=$2) AS mine FROM reactions WHERE message_id=m.id GROUP BY emoji ORDER BY emoji) r),'[]') AS reactions
 FROM messages m LEFT JOIN users u ON u.id=m.sender_id LEFT JOIN files f ON f.id=m.file_id
 LEFT JOIN polls p ON p.id=m.poll_id
 LEFT JOIN messages replied ON replied.id=m.reply_to_id AND replied.chat_id=m.chat_id AND replied.deleted_at IS NULL AND (replied.expires_at IS NULL OR replied.expires_at>now())
 LEFT JOIN users reply_user ON reply_user.id=replied.sender_id LEFT JOIN files reply_file ON reply_file.id=replied.file_id`;
app.get('/api/chats/:id/messages', auth, async (req, res) => {
  await member(String(req.params.id), user(req).id);
  const q = z.string().trim().max(100).optional().parse(req.query.q);
  const before = uuid.optional().parse(req.query.before);
  const through = uuid.optional().parse(req.query.through);
  const since = z.coerce.date().optional().parse(req.query.since);
  // An older client expects exactly 60 rows in a full page. Newer clients also
  // need the remaining tiles when a page starts in the middle of an album.
  async function completeOldestAlbum(rows: QueryResultRow[]) {
    const edge = rows.at(-1);
    if (req.query.completeAlbums !== '1' || !edge?.album_id || q) return rows;
    const older = await pool.query(
      `${messageSQL} WHERE m.chat_id=$1 AND ${visibleMessageWhere} AND m.album_id=$3
       AND EXISTS(SELECT 1 FROM members viewer WHERE viewer.chat_id=m.chat_id AND viewer.user_id=$2)
       AND (m.created_at,m.id)<(SELECT created_at,id FROM messages WHERE id=$4)
       ORDER BY m.created_at DESC,m.id DESC`,
      [req.params.id, user(req).id, edge.album_id, edge.id],
    );
    return [...rows, ...older.rows];
  }
  if (through || since) {
    // Everything from a message (or a date) up to `before`, plus a little older context, in
    // one request: jumping to a search hit or a day far back must not page 60 at a time.
    // ponytail: capped at 3000 messages per call; the client repeats the call past the cap.
    const anchor = through
      ? '(SELECT created_at,id FROM messages WHERE id=$3 AND chat_id=$1)'
      : "($3::timestamptz,'00000000-0000-0000-0000-000000000000'::uuid)";
    const where = `m.chat_id=$1 AND EXISTS(SELECT 1 FROM members viewer WHERE viewer.chat_id=m.chat_id AND viewer.user_id=$2) AND ${visibleMessageWhere}`;
    const params = [req.params.id, user(req).id, through ?? since!.toISOString(), before ?? null];
    const range = await pool.query(
      `${messageSQL} WHERE ${where} AND (m.created_at,m.id)>=${anchor}
       AND ($4::uuid IS NULL OR (m.created_at,m.id)<(SELECT created_at,id FROM messages WHERE id=$4 AND chat_id=$1))
       ORDER BY m.created_at DESC,m.id DESC LIMIT 3000`,
      params,
    );
    const complete = range.rows.length < 3000;
    const older = complete
      ? await pool.query(
          `${messageSQL} WHERE ${where} AND (m.created_at,m.id)<${anchor} ORDER BY m.created_at DESC,m.id DESC LIMIT 20`,
          params.slice(0, 3),
        )
      : { rows: [] };
    const page = await completeOldestAlbum([...range.rows, ...older.rows]);
    return res.json({
      messages: page.reverse(),
      hasOlder: !complete || older.rows.length === 20,
      complete,
    });
  }
  const { rows } = await pool.query(
    `${messageSQL} WHERE m.chat_id=$1 AND EXISTS(SELECT 1 FROM members viewer WHERE viewer.chat_id=m.chat_id AND viewer.user_id=$2) AND ${visibleMessageWhere} AND ($3::text IS NULL OR m.body ILIKE $3) AND ($4::uuid IS NULL OR (m.created_at,m.id)<(SELECT created_at,id FROM messages WHERE id=$4 AND chat_id=$1)) ORDER BY m.created_at DESC,m.id DESC LIMIT 60`,
    [req.params.id, user(req).id, q ? contains(q) : null, before || null],
  );
  res.json((await completeOldestAlbum(rows)).reverse());
});
// Search across every chat the user is in; the client opens a hit in its conversation.
// ILIKE pattern for a literal substring; the messages_body_trgm index serves it.
const contains = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;
/** SQL per attachment kind; names follow what the app records (see fileLabel on the client). */
const searchKinds = {
  photo: "f.id IS NOT NULL AND f.mime LIKE 'image/%'",
  video: "f.id IS NOT NULL AND f.mime LIKE 'video/%' AND f.name NOT LIKE 'Кружок%'",
  voice: "f.id IS NOT NULL AND (f.name LIKE 'Голосовое-%' OR f.name LIKE 'Кружок%')",
  file: "f.id IS NOT NULL AND f.mime NOT LIKE 'image/%' AND f.mime NOT LIKE 'video/%' AND f.name NOT LIKE 'Голосовое-%'",
  link: "m.body ~* 'https?://'",
} as const;
app.get('/api/search', auth, async (req, res) => {
  const filters = z
    .object({
      q: z.string().trim().max(100).optional(),
      /** A user id, or "me". */
      from: z.union([uuid, z.literal('me')]).optional(),
      type: z.enum(['photo', 'video', 'voice', 'file', 'link']).optional(),
      after: z.coerce.date().optional(),
      before: z.coerce.date().optional(),
    })
    .parse(req.query);
  const q = filters.q || '';
  // Without words, a filter alone is enough ("all photos from Anna").
  requireValue(
    q.length >= 2 || filters.from || filters.type || filters.after || filters.before,
    400,
    'Введите хотя бы две буквы или выберите фильтр.',
  );
  const from = filters.from === 'me' ? user(req).id : filters.from;
  const { rows } = await pool.query(
    `SELECT m.id,m.chat_id,m.body,m.created_at,m.sender_id,COALESCE(u.name,'Неля') AS sender_name,
       CASE WHEN f.id IS NULL THEN NULL ELSE json_build_object('id',f.id,'name',f.name,'size',f.size,'mime',f.mime,'width',f.width,'height',f.height,'thumb',f.thumb,'waveform',f.waveform) END AS file
     FROM messages m JOIN members viewer ON viewer.chat_id=m.chat_id AND viewer.user_id=$1
     LEFT JOIN users u ON u.id=m.sender_id LEFT JOIN files f ON f.id=m.file_id
     WHERE m.deleted_at IS NULL AND (m.expires_at IS NULL OR m.expires_at>now())
     AND NOT EXISTS(SELECT 1 FROM hidden_messages hm WHERE hm.message_id=m.id AND hm.user_id=$1)
     AND ($2::text IS NULL OR m.body ILIKE $2 OR f.name ILIKE $2)
     AND ($3::uuid IS NULL OR m.sender_id=$3)
     AND ($4::timestamptz IS NULL OR m.created_at>=$4) AND ($5::timestamptz IS NULL OR m.created_at<$5)
     ${filters.type ? `AND ${searchKinds[filters.type]}` : ''}
     ORDER BY m.created_at DESC,m.id DESC LIMIT 50`,
    [
      user(req).id,
      q.length >= 2 ? contains(q) : null,
      from ?? null,
      filters.after ?? null,
      filters.before ?? null,
    ],
  );
  res.json(rows);
});
/** The chat profile's "Медиа, файлы, ссылки, голосовые": one kind at a time, newest first. */
app.get('/api/chats/:id/media', auth, async (req, res) => {
  const query = z
    .object({
      type: z.enum(['media', 'file', 'voice', 'link']),
      /** The `cursor` of the last item of the previous page. */
      before: z.string().max(80).optional(),
    })
    .parse(req.query);
  const chat = await member(String(req.params.id), user(req).id);
  // Legacy cursors contain only the PostgreSQL timestamp. Keep all six
  // fractional digits so pages cannot lose items within the same millisecond.
  const [time, cursorId, ...extra] = query.before?.split('|') ?? [];
  if (query.before !== undefined) {
    requireValue(!extra.length, 400, 'Неверный курсор.');
    z.iso.datetime({ offset: true }).parse(time.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
    if (cursorId !== undefined) uuid.parse(cursorId);
  }
  const kind =
    query.type === 'media'
      ? `(${searchKinds.photo} OR ${searchKinds.video})`
      : searchKinds[query.type];
  const { rows } = await pool.query(
    `SELECT m.id,m.created_at,m.created_at::text||'|'||m.id::text AS cursor,m.body,m.link_preview,COALESCE(u.name,'Неля') AS sender_name,
       CASE WHEN f.id IS NULL THEN NULL ELSE json_build_object('id',f.id,'name',f.name,'size',f.size,'mime',f.mime,'width',f.width,'height',f.height,'thumb',f.thumb,'waveform',f.waveform) END AS file
     FROM messages m LEFT JOIN users u ON u.id=m.sender_id LEFT JOIN files f ON f.id=m.file_id
     WHERE m.chat_id=$1 AND ${visibleMessageWhere} AND ${kind}
     AND ($3::timestamptz IS NULL OR (m.created_at,m.id)<($3::timestamptz,$4::uuid))
     ORDER BY m.created_at DESC,m.id DESC LIMIT 61`,
    [chat.id, user(req).id, time ?? null, cursorId ?? '00000000-0000-0000-0000-000000000000'],
  );
  res.json({ items: rows.slice(0, 60), more: rows.length > 60 });
});
app.post('/api/chats/:id/messages', auth, async (req, res) => {
  const data = z
    .object({
      body: z.string().trim().max(8000).default(''),
      fileId: uuid.optional(),
      /** Several attachments at once: one message each, the text goes with the last. */
      fileIds: z.array(uuid).min(1).max(10).optional(),
      /** Photos and videos sent together are drawn as one album. */
      album: z.boolean().optional(),
      nonce: uuid,
      replyTo: uuid.optional(),
      /** Delivered without a notification. */
      silent: z.boolean().optional(),
      skipPreview: z.boolean().optional(),
    })
    .parse(req.body);
  const fileIds = [...new Set(data.fileIds ?? (data.fileId ? [data.fileId] : []))];
  const slots = fileIds.length ? fileIds : [null];
  const nonces = slots.map((_, index) => (index ? derivedNonce(data.nonce, index) : data.nonce));
  requireValue(data.body || fileIds.length, 400, 'Напишите сообщение или выберите файл.');
  const linkPreview = data.skipPreview ? null : await instantLinkPreview(data.body);
  let created = false;
  const id = await transaction(async (db) => {
    const chat = await lockedMember(String(req.params.id), user(req).id, db);
    // Resolve retries before checking references: the replied-to message might have
    // been deleted after this message was already committed and its response lost.
    const existing = await db.query(
      `SELECT id,chat_id FROM messages WHERE sender_id=$1 AND nonce=ANY($2::uuid[])
       ORDER BY array_position($2::uuid[],nonce) DESC LIMIT 1`,
      [user(req).id, nonces],
    );
    if (existing.rows[0]) {
      requireValue(
        existing.rows[0].chat_id === chat.id,
        409,
        'Идентификатор сообщения уже использован.',
      );
      return existing.rows[0].id;
    }
    if (data.replyTo) {
      const target = await db.query(
        'SELECT id FROM messages WHERE id=$1 AND chat_id=$2 AND deleted_at IS NULL',
        [data.replyTo, chat.id],
      );
      requireValue(target.rowCount, 400, 'Сообщение для ответа не найдено в этом чате.');
    }
    let albumId = null;
    if (fileIds.length) {
      const { rows } = await db.query(
        'SELECT id,mime,name FROM files WHERE id=ANY($1) AND chat_id=$2 AND user_id=$3',
        [fileIds, chat.id, user(req).id],
      );
      requireValue(rows.length === fileIds.length, 400, 'Файл недоступен.');
      if (
        data.album &&
        rows.length > 1 &&
        rows.every((f) => /^(image|video)\//.test(f.mime) && !f.name.startsWith('Кружок-'))
      )
        albumId = randomUUID();
    }
    const expiresAt = chat.auto_delete_seconds
      ? new Date(Date.now() + Number(chat.auto_delete_seconds) * 1000)
      : null;
    // @все from the group owner mentions everyone, once per ten minutes so it stays useful.
    // From anyone else it is plain text.
    const mentionAll =
      chat.kind === 'group' && chat.owner_id === user(req).id && MENTION_ALL.test(data.body);
    if (mentionAll) {
      const recent = await db.query(
        "SELECT 1 FROM messages WHERE chat_id=$1 AND mention_all AND created_at>now()-interval '10 minutes'",
        [chat.id],
      );
      requireValue(!recent.rowCount, 429, 'Упомянуть всех можно раз в 10 минут.');
    }
    // An album is one message per file, written together: the first carries the reply, the
    // last the text. Each gets its own nonce, derived from the request's, so a retry is safe.
    const ids: string[] = [];
    for (const [index, fileId] of slots.entries()) {
      const last = index === slots.length - 1;
      const { rows } = await db.query(
        'INSERT INTO messages(id,chat_id,sender_id,body,file_id,nonce,reply_to_id,link_preview,expires_at,mention_all,album_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(sender_id,nonce) DO NOTHING RETURNING id',
        [
          randomUUID(),
          chat.id,
          user(req).id,
          last ? data.body : '',
          fileId,
          nonces[index],
          index ? null : data.replyTo,
          last && linkPreview ? JSON.stringify(linkPreview) : null,
          expiresAt,
          last && mentionAll,
          albumId,
        ],
      );
      requireValue(rows[0], 409, 'Идентификатор сообщения уже использован.');
      ids.push(rows[0].id);
    }
    const lastId = ids.at(-1)!;
    created = true;
    await queuePush(db, chat.kind, lastId, data.silent);
    const reply = chat.nelya ? nelyaReply(data.body) : null;
    if (reply)
      await db.query(
        'INSERT INTO messages(id,chat_id,body,nonce,expires_at) VALUES($1,$2,$3,$4,$5)',
        [randomUUID(), chat.id, reply, randomUUID(), expiresAt],
      );
    await notify(db, chat.id, undefined, undefined, {
      event: 'message.created',
      messageId: lastId,
      senderId: user(req).id,
      silent: data.silent || undefined,
      batch: ids.length > 1 || undefined,
    });
    return lastId;
  });
  if (created && !linkPreview && !data.skipPreview)
    attachLinkPreview(String(req.params.id), id, user(req).id, data.body);
  res.status(201).json({ id });
});
app.patch('/api/chats/:id/messages/:messageId', auth, async (req, res) => {
  const { body } = z
    .object({ body: z.string().trim().max(8000) })
    .strict()
    .parse(req.body);
  const instant = await instantLinkPreview(body);
  let refetchPreview = false;
  await transaction(async (db) => {
    const chat = await lockedMember(String(req.params.id), user(req).id, db);
    const target = await db.query(
      'SELECT body,file_id,poll_id,link_preview FROM messages WHERE id=$1 AND chat_id=$2 AND sender_id=$3 AND deleted_at IS NULL FOR UPDATE',
      [uuid.parse(req.params.messageId), chat.id, user(req).id],
    );
    requireValue(target.rows[0], 404, 'Можно изменить только своё сообщение.');
    requireValue(!target.rows[0].poll_id, 400, 'Нельзя изменить текст опроса.');
    requireValue(body || target.rows[0].file_id, 400, 'Сообщение не может быть пустым.');
    if (target.rows[0].body !== body) {
      await db.query(
        'INSERT INTO message_edits(id,message_id,previous_body,edited_at) VALUES($1,$2,$3,clock_timestamp())',
        [randomUUID(), req.params.messageId, target.rows[0].body],
      );
      // Same link: keep the card (or its absence, if the author removed it).
      const sameLink = extractFirstUrl(body) === extractFirstUrl(target.rows[0].body);
      const preview = sameLink ? target.rows[0].link_preview : instant;
      refetchPreview = !sameLink && !instant;
      await db.query(
        'UPDATE messages SET body=$1,edited_at=clock_timestamp(),link_preview=$2 WHERE id=$3',
        [body, preview ? JSON.stringify(preview) : null, req.params.messageId],
      );
      await notify(db, chat.id, undefined, undefined, {
        event: 'message.updated',
        messageId: String(req.params.messageId),
        senderId: user(req).id,
      });
    }
  });
  if (refetchPreview)
    attachLinkPreview(String(req.params.id), String(req.params.messageId), user(req).id, body);
  res.json({ ok: true });
});
app.get('/api/chats/:id/messages/:messageId/edits', auth, async (req, res) => {
  const chat = await member(String(req.params.id), user(req).id);
  const messageId = uuid.parse(req.params.messageId);
  const msg = await pool.query(
    `SELECT m.id,m.body,m.edited_at FROM messages m WHERE m.id=$1 AND m.chat_id=$2 AND m.deleted_at IS NULL
     AND NOT EXISTS(SELECT 1 FROM hidden_messages hm WHERE hm.message_id=m.id AND hm.user_id=$3)`,
    [messageId, chat.id, user(req).id],
  );
  requireValue(msg.rows[0], 404, 'Сообщение не найдено.');
  const { rows } = await pool.query(
    'SELECT id,previous_body,edited_at FROM message_edits WHERE message_id=$1 ORDER BY edited_at DESC',
    [messageId],
  );
  res.json({ current: msg.rows[0].body, edits: rows });
});
app.delete('/api/chats/:id/messages/:messageId', auth, async (req, res) => {
  const scope = req.query.scope === 'me' ? 'me' : 'all';
  const allowUndo = req.query.undo === '1';
  const removed = await transaction(async (db) => {
    await lockedMember(String(req.params.id), user(req).id, db);
    const messageId = uuid.parse(req.params.messageId);
    if (scope === 'me') {
      const target = await db.query(
        'SELECT id FROM messages WHERE id=$1 AND chat_id=$2 AND deleted_at IS NULL',
        [messageId, req.params.id],
      );
      requireValue(target.rowCount, 404, 'Сообщение не найдено.');
      await db.query(
        'INSERT INTO hidden_messages(message_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [messageId, user(req).id],
      );
      await notify(db, String(req.params.id), messageId, undefined, undefined, user(req).id);
      return [] as string[];
    }
    if (allowUndo) {
      const result = await db.query(
        `UPDATE messages m SET deleted_at=clock_timestamp(),deleted_by=$3 FROM chats c
         WHERE m.id=$1 AND m.chat_id=$2 AND c.id=m.chat_id AND m.deleted_at IS NULL
         AND (m.sender_id=$3 OR (c.kind='group' AND c.owner_id=$3)) RETURNING m.id`,
        [messageId, req.params.id, user(req).id],
      );
      requireValue(result.rowCount, 404, 'Можно удалить только своё сообщение.');
      await db.query(
        'UPDATE chats SET pinned_message_id=NULL WHERE id=$1 AND pinned_message_id=$2',
        [req.params.id, messageId],
      );
      await notify(db, String(req.params.id), messageId);
      return [] as string[];
    }
    // Authors delete their own messages; a group owner moderates any message in the group.
    const result = await db.query(
      `DELETE FROM messages m USING chats c WHERE m.id=$1 AND m.chat_id=$2 AND c.id=m.chat_id
       AND (m.sender_id=$3 OR (c.kind='group' AND c.owner_id=$3)) RETURNING m.file_id`,
      [messageId, req.params.id, user(req).id],
    );
    requireValue(result.rowCount, 404, 'Можно удалить только своё сообщение.');
    await notify(db, String(req.params.id), messageId);
    // A deleted attachment must stop being downloadable and stop counting toward the quota.
    const files = await db.query(
      'DELETE FROM files f WHERE f.id=$1 AND NOT EXISTS(SELECT 1 FROM messages WHERE file_id=f.id) AND NOT EXISTS(SELECT 1 FROM scheduled_messages WHERE file_id=f.id) RETURNING id',
      [result.rows[0].file_id],
    );
    return files.rows.map((file) => file.id as string);
  });
  await removeStoredFiles(removed);
  res.json({ ok: true, scope, canUndo: scope === 'me' || allowUndo });
});
app.post('/api/chats/:id/messages/:messageId/restore', auth, async (req, res) => {
  await transaction(async (db) => {
    const chat = await lockedMember(String(req.params.id), user(req).id, db);
    const messageId = uuid.parse(req.params.messageId);
    const unhid = await db.query(
      'DELETE FROM hidden_messages WHERE message_id=$1 AND user_id=$2 RETURNING message_id',
      [messageId, user(req).id],
    );
    if (unhid.rowCount) {
      await notify(
        db,
        chat.id,
        undefined,
        undefined,
        { event: 'message.created', messageId, senderId: user(req).id },
        user(req).id,
      );
      return;
    }
    const restored = await db.query(
      `UPDATE messages SET deleted_at=NULL,deleted_by=NULL
       WHERE id=$1 AND chat_id=$2 AND deleted_at IS NOT NULL AND deleted_at>now()-interval '60 seconds'
       AND (deleted_by=$3 OR sender_id=$3) RETURNING id,sender_id`,
      [messageId, chat.id, user(req).id],
    );
    requireValue(restored.rowCount, 404, 'Время для отмены удаления истекло.');
    await notify(db, chat.id, undefined, undefined, {
      event: 'message.created',
      messageId,
      senderId: restored.rows[0].sender_id || user(req).id,
    });
  });
  res.json({ ok: true });
});
app.post('/api/chats/:id/messages/:messageId/reactions', auth, async (req, res) => {
  const { emoji } = z.object({ emoji: emojiSchema }).parse(req.body);
  await transaction(async (db) => {
    await lockedMember(String(req.params.id), user(req).id, db);
    const target = await db.query(
      'SELECT id FROM messages WHERE id=$1 AND chat_id=$2 AND deleted_at IS NULL FOR UPDATE',
      [uuid.parse(req.params.messageId), req.params.id],
    );
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
    await notify(db, String(req.params.id), undefined, undefined, {
      event: 'message.updated',
      messageId: String(req.params.messageId),
      senderId: user(req).id,
    });
  });
  res.json({ ok: true });
});
app.get('/api/chats/:id/messages/:messageId/details', auth, async (req, res) => {
  const chat = await member(String(req.params.id), user(req).id);
  const messageId = uuid.parse(req.params.messageId);
  const { rows: msgRows } = await pool.query(
    `SELECT created_at,sender_id FROM messages m WHERE m.id=$1 AND m.chat_id=$2 AND m.deleted_at IS NULL
     AND NOT EXISTS(SELECT 1 FROM hidden_messages hm WHERE hm.message_id=m.id AND hm.user_id=$3)`,
    [messageId, chat.id, user(req).id],
  );
  requireValue(msgRows[0], 404, 'Сообщение не найдено.');
  const readers = await pool.query(
    `SELECT u.id,u.username,u.name,u.color,u.role,u.avatar,mem.receipt_at AS read_at
     FROM members mem JOIN users u ON u.id=mem.user_id
     WHERE mem.chat_id=$1 AND mem.user_id IS DISTINCT FROM $2 AND mem.receipt_at>=$3
     ORDER BY mem.receipt_at DESC,u.name`,
    [chat.id, msgRows[0].sender_id, msgRows[0].created_at],
  );
  const reactions = await pool.query(
    `SELECT r.emoji,json_agg(json_build_object('id',u.id,'name',u.name,'username',u.username,'color',u.color,'avatar',u.avatar) ORDER BY u.name) AS users
     FROM reactions r JOIN users u ON u.id=r.user_id WHERE r.message_id=$1
     GROUP BY r.emoji ORDER BY r.emoji`,
    [messageId],
  );
  res.json({ readers: readers.rows, reactions: reactions.rows });
});
// One pinned message per chat. In a group the owner pins; in a personal chat either side.
app.put('/api/chats/:id/pin', auth, async (req, res) => {
  const { messageId } = z.object({ messageId: uuid.nullable() }).strict().parse(req.body);
  await transaction(async (db) => {
    const chat = await lockedMember(String(req.params.id), user(req).id, db);
    requireValue(
      chat.kind !== 'group' || chat.owner_id === user(req).id,
      403,
      'Закрепляет владелец группы.',
    );
    if (messageId) {
      const target = await db.query(
        'SELECT 1 FROM messages WHERE id=$1 AND chat_id=$2 AND deleted_at IS NULL',
        [messageId, chat.id],
      );
      requireValue(target.rowCount, 404, 'Сообщение не найдено.');
    }
    await db.query('UPDATE chats SET pinned_message_id=$1 WHERE id=$2', [messageId, chat.id]);
    await notify(db, chat.id);
  });
  res.json({ ok: true });
});
// Copies messages from chats the user reads into this chat, oldest first, marked with
// the original author. Attachments are shared, not copied (see fileAccessSQL).
app.post('/api/chats/:id/forward', auth, async (req, res) => {
  const { messageIds } = z
    .object({ messageIds: z.array(uuid).min(1).max(100) })
    .strict()
    .parse(req.body);
  const ids = await transaction(async (db) => {
    const chat = await lockedMember(String(req.params.id), user(req).id, db);
    const { rows } = await db.query(
      `SELECT m.body,m.file_id,m.link_preview,m.album_id,count(*) OVER (PARTITION BY m.album_id) AS album_count,
       COALESCE(m.forwarded_from,u.name,'Неля') AS origin FROM messages m
       JOIN members viewer ON viewer.chat_id=m.chat_id AND viewer.user_id=$2
       LEFT JOIN users u ON u.id=m.sender_id
       WHERE m.id=ANY($1::uuid[]) AND m.deleted_at IS NULL AND (m.expires_at IS NULL OR m.expires_at>now())
       AND NOT EXISTS(SELECT 1 FROM hidden_messages hm WHERE hm.message_id=m.id AND hm.user_id=$2)
       ORDER BY m.created_at,m.id`,
      [[...new Set(messageIds)], user(req).id],
    );
    requireValue(rows.length === new Set(messageIds).size, 404, 'Сообщение не найдено.');
    const expiresAt = chat.auto_delete_seconds
      ? new Date(Date.now() + Number(chat.auto_delete_seconds) * 1000)
      : null;
    const ids: string[] = [];
    const forwardedAlbums = new Map<string, string>();
    for (const row of rows) {
      const id = randomUUID();
      if (row.album_id && Number(row.album_count) > 1 && !forwardedAlbums.has(row.album_id))
        forwardedAlbums.set(row.album_id, randomUUID());
      await db.query(
        'INSERT INTO messages(id,chat_id,sender_id,body,file_id,nonce,forwarded_from,link_preview,expires_at,album_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          id,
          chat.id,
          user(req).id,
          row.body,
          row.file_id,
          randomUUID(),
          row.origin,
          row.link_preview ? JSON.stringify(row.link_preview) : null,
          expiresAt,
          forwardedAlbums.get(row.album_id) ?? null,
        ],
      );
      ids.push(id);
    }
    // One notification for the batch, as for a single message.
    await queuePush(db, chat.kind, ids.at(-1)!);
    // A single message travels with its event; a batch makes open chats refetch.
    await notify(db, chat.id, undefined, undefined, {
      event: 'message.created',
      messageId: ids.at(-1)!,
      senderId: user(req).id,
      batch: ids.length > 1 || undefined,
    });
    return ids;
  });
  res.status(201).json({ ids });
});
app.get('/api/link-preview', externalLimit, auth, async (req, res) => {
  const url = z.string().trim().min(1).max(2048).parse(req.query.url);
  await assertSafePublicUrl(url);
  const preview = await resolveLinkPreview(url);
  res.json({ preview });
});
app.get('/api/link-preview/image', auth, async (req, res) => {
  const url = z.string().trim().min(1).max(2048).parse(req.query.url);
  await assertSafePublicUrl(url);
  const result = await fetchPreviewImage(url);
  requireValue(result, 404, 'Изображение недоступно.');
  res.setHeader('Content-Type', result!.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(result!.buffer);
});
app.post('/api/chats/:id/tiktok', externalLimit, auth, async (req, res) => {
  const data = z
    .object({
      url: z.string().trim().min(1).max(2048),
      caption: z.string().trim().max(2000).optional(),
      replyTo: uuid.optional(),
      silent: z.boolean().optional(),
    })
    .strict()
    .parse(req.body);
  // Do not fetch 20 MB for a chat the user cannot post to.
  await member(String(req.params.id), user(req).id);
  const downloaded = await downloadTikTokVideo(data.url);
  const fileId = randomUUID();
  const filepath = path.join(directory, fileId);
  await writeFile(filepath, downloaded.buffer);
  try {
    const result = await transaction(async (db) => {
      const chat = await lockedMember(String(req.params.id), user(req).id, db);
      const usage = await db.query(
        'SELECT COALESCE(sum(size),0)::bigint AS total FROM files WHERE user_id=$1',
        [user(req).id],
      );
      requireValue(
        Number(usage.rows[0].total) + downloaded.buffer.length <= 500 * 1024 * 1024,
        413,
        'Лимит файлов аккаунта — 500 МБ. Свяжитесь с владельцем сервера.',
      );
      if (data.replyTo) {
        const target = await db.query(
          'SELECT id FROM messages WHERE id=$1 AND chat_id=$2 AND deleted_at IS NULL',
          [data.replyTo, chat.id],
        );
        requireValue(target.rowCount, 400, 'Сообщение для ответа не найдено в этом чате.');
      }
      const { rows: fileRows } = await db.query(
        'INSERT INTO files(id,chat_id,user_id,name,size,mime,audio_ready) VALUES($1,$2,$3,$4,$5,$6,false) RETURNING id,name,size,mime',
        [
          fileId,
          chat.id,
          user(req).id,
          downloaded.filename,
          downloaded.buffer.length,
          downloaded.mime,
        ],
      );
      const messageId = randomUUID();
      const expiresAt = chat.auto_delete_seconds
        ? new Date(Date.now() + Number(chat.auto_delete_seconds) * 1000)
        : null;
      await db.query(
        'INSERT INTO messages(id,chat_id,sender_id,body,file_id,nonce,reply_to_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          messageId,
          chat.id,
          user(req).id,
          // The video speaks for itself; its TikTok description is mostly hashtags.
          data.caption ?? '',
          fileId,
          randomUUID(),
          data.replyTo ?? null,
          expiresAt,
        ],
      );
      await queuePush(db, chat.kind, messageId, data.silent);
      await notify(db, chat.id, undefined, undefined, {
        event: 'message.created',
        messageId,
        senderId: user(req).id,
        silent: data.silent || undefined,
      });
      return { id: messageId, file: fileRows[0] };
    });
    res.status(201).json(result);
  } catch (err) {
    await unlink(filepath).catch(() => {});
    throw err;
  }
});
// Animated stickers: Noto Animated Emoji (CC BY 4.0) as Lottie, fetched once and kept on disk.
const stickerDir = path.join(directory, 'stickers');
const stickerLoads = new Map<string, Promise<Buffer>>();
async function loadSticker(code: string) {
  const file = path.join(stickerDir, `${code}.json`);
  try {
    return await readFile(file);
  } catch {
    /* Not cached yet. */
  }
  const response = await fetch(
    `https://fonts.gstatic.com/s/e/notoemoji/latest/${code}/lottie.json`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) throw new HttpError(404, 'Стикер не найден.');
  const data = Buffer.from(await response.arrayBuffer());
  requireValue(data.length < 2 * 1024 * 1024, 502, 'Стикер недоступен.');
  JSON.parse(data.toString('utf8'));
  await mkdir(stickerDir, { recursive: true });
  await writeFile(file, data);
  return data;
}
app.get('/api/stickers/:code', async (req, res) => {
  const code = String(req.params.code).replace(/\.json$/, '');
  requireValue(/^[0-9a-f]{2,6}(?:_[0-9a-f]{2,6}){0,9}$/.test(code), 404, 'Стикер не найден.');
  let load = stickerLoads.get(code);
  if (!load) {
    load = loadSticker(code);
    stickerLoads.set(code, load);
    const forget = () => stickerLoads.delete(code);
    load.then(forget, forget);
  }
  const data = await load;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
  res.send(data);
});
app.get('/api/gifs', externalLimit, auth, async (req, res) => {
  const q = z.string().trim().max(100).optional().parse(req.query.q) ?? '';
  const limitRaw = Number(req.query.limit ?? 18);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(30, Math.floor(limitRaw))) : 18;
  const items = await searchGifs(q, limit);
  res.json({ items });
});
async function deliverScheduledRow(
  db: PoolClient,
  row: {
    id: string;
    chat_id: string;
    sender_id: string;
    body: string;
    file_id: string | null;
    reply_to_id: string | null;
    silent: boolean;
    is_reminder: boolean;
  },
  /** Delivered by the timer rather than "send now": a due reminder notifies its author. */
  due: boolean,
) {
  await db.query('DELETE FROM scheduled_messages WHERE id=$1', [row.id]);
  const { rows: chats } = await db.query(
    'SELECT c.* FROM chats c JOIN members m ON m.chat_id=c.id WHERE c.id=$1 AND m.user_id=$2 FOR UPDATE',
    [row.chat_id, row.sender_id],
  );
  if (!chats[0]) return null;
  const chat = chats[0];
  let replyTo = row.reply_to_id;
  if (replyTo) {
    const r = await db.query(
      'SELECT 1 FROM messages WHERE id=$1 AND chat_id=$2 AND deleted_at IS NULL',
      [replyTo, row.chat_id],
    );
    if (!r.rowCount) replyTo = null;
  }
  const expiresAt = chat.auto_delete_seconds
    ? new Date(Date.now() + Number(chat.auto_delete_seconds) * 1000)
    : null;
  const preview = await instantLinkPreview(row.body);
  const messageId = randomUUID();
  await db.query(
    'INSERT INTO messages(id,chat_id,sender_id,body,file_id,nonce,reply_to_id,link_preview,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      messageId,
      row.chat_id,
      row.sender_id,
      row.body,
      row.file_id,
      randomUUID(),
      replyTo,
      preview ? JSON.stringify(preview) : null,
      expiresAt,
    ],
  );
  if (due && row.is_reminder && chat.kind === 'saved' && anyPushEnabled)
    await db.query('INSERT INTO push_jobs(message_id) VALUES($1)', [messageId]);
  else await queuePush(db, chat.kind, messageId, row.silent);
  const reply = chat.nelya ? nelyaReply(row.body) : null;
  if (reply)
    await db.query(
      'INSERT INTO messages(id,chat_id,body,nonce,expires_at) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), chat.id, reply, randomUUID(), expiresAt],
    );
  await notify(db, row.chat_id, undefined, undefined, {
    event: 'message.created',
    messageId,
    senderId: row.sender_id,
    silent: row.silent || undefined,
  });
  // The author's scheduled list shrank.
  await notify(db, row.chat_id, undefined, undefined, undefined, row.sender_id);
  return { messageId, needsPreview: !preview, row };
}
app.get('/api/chats/:id/scheduled', auth, async (req, res) => {
  const chat = await member(String(req.params.id), user(req).id);
  const { rows } = await pool.query(
    `SELECT sm.id,sm.chat_id,sm.body,sm.file_id,f.name AS file_name,sm.silent,sm.is_reminder,sm.scheduled_for,sm.created_at
     FROM scheduled_messages sm LEFT JOIN files f ON f.id=sm.file_id
     WHERE sm.chat_id=$1 AND sm.sender_id=$2 ORDER BY sm.scheduled_for ASC`,
    [chat.id, user(req).id],
  );
  res.json(rows);
});
app.post('/api/chats/:id/scheduled', auth, async (req, res) => {
  const data = z
    .object({
      body: z.string().trim().max(8000).default(''),
      fileId: uuid.optional(),
      replyTo: uuid.optional(),
      silent: z.boolean().optional(),
      isReminder: z.boolean().optional(),
      scheduledFor: z.string().trim().min(1),
    })
    .strict()
    .parse(req.body);
  requireValue(data.body || data.fileId, 400, 'Напишите сообщение или выберите файл.');
  const ts = Date.parse(data.scheduledFor);
  requireValue(
    Number.isFinite(ts) && ts > Date.now() - 5000 && ts <= Date.now() + 365 * 86400_000,
    400,
    'Укажите корректную дату и время отправки.',
  );
  const item = await transaction(async (db) => {
    const chat = await lockedMember(String(req.params.id), user(req).id, db);
    if (data.replyTo) {
      const target = await db.query(
        'SELECT 1 FROM messages WHERE id=$1 AND chat_id=$2 AND deleted_at IS NULL',
        [data.replyTo, chat.id],
      );
      requireValue(target.rowCount, 400, 'Сообщение для ответа не найдено в этом чате.');
    }
    if (data.fileId) {
      const { rows } = await db.query(
        'SELECT id FROM files WHERE id=$1 AND chat_id=$2 AND user_id=$3',
        [data.fileId, chat.id, user(req).id],
      );
      requireValue(rows[0], 400, 'Файл недоступен.');
    }
    const { rows } = await db.query(
      `INSERT INTO scheduled_messages(id,chat_id,sender_id,body,file_id,reply_to_id,silent,is_reminder,scheduled_for)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id,chat_id,body,file_id,silent,is_reminder,scheduled_for,created_at`,
      [
        randomUUID(),
        chat.id,
        user(req).id,
        data.body,
        data.fileId ?? null,
        data.replyTo ?? null,
        Boolean(data.silent),
        Boolean(data.isReminder || chat.kind === 'saved'),
        new Date(ts),
      ],
    );
    await notify(db, chat.id, undefined, undefined, undefined, user(req).id);
    return rows[0];
  });
  res.status(201).json(item);
});
app.delete('/api/chats/:id/scheduled/:scheduleId', auth, async (req, res) => {
  const removedFiles = await transaction(async (db) => {
    const chat = await lockedMember(String(req.params.id), user(req).id, db);
    const { rows } = await db.query(
      'DELETE FROM scheduled_messages WHERE id=$1 AND chat_id=$2 AND sender_id=$3 RETURNING file_id',
      [uuid.parse(req.params.scheduleId), chat.id, user(req).id],
    );
    requireValue(rows[0], 404, 'Отложенное сообщение не найдено.');
    await notify(db, chat.id, undefined, undefined, undefined, user(req).id);
    if (!rows[0].file_id) return [] as string[];
    const orphaned = await db.query(
      'DELETE FROM files f WHERE f.id=$1 AND NOT EXISTS(SELECT 1 FROM messages WHERE file_id=f.id) AND NOT EXISTS(SELECT 1 FROM scheduled_messages WHERE file_id=f.id) RETURNING id',
      [rows[0].file_id],
    );
    return orphaned.rows.map((r) => r.id as string);
  });
  await removeStoredFiles(removedFiles);
  res.json({ ok: true });
});
app.post('/api/chats/:id/scheduled/:scheduleId/send', auth, async (req, res) => {
  const delivered = await transaction(async (db) => {
    const chat = await lockedMember(String(req.params.id), user(req).id, db);
    const { rows } = await db.query(
      'SELECT * FROM scheduled_messages WHERE id=$1 AND chat_id=$2 AND sender_id=$3 FOR UPDATE',
      [uuid.parse(req.params.scheduleId), chat.id, user(req).id],
    );
    requireValue(rows[0], 404, 'Отложенное сообщение не найдено.');
    return deliverScheduledRow(db, rows[0], false);
  });
  if (delivered?.needsPreview)
    attachLinkPreview(
      delivered.row.chat_id,
      delivered.messageId,
      delivered.row.sender_id,
      delivered.row.body,
    );
  res.status(201).json({ id: delivered?.messageId ?? null });
});
app.post('/api/chats/:id/polls', auth, async (req, res) => {
  const data = z
    .object({
      question: z.string().trim().min(1).max(300),
      options: z.array(z.string().trim().min(1).max(120)).min(2).max(10),
      multiple: z.boolean().default(false),
      anonymous: z.boolean().default(false),
      nonce: uuid,
    })
    .strict()
    .parse(req.body);
  const result = await transaction(async (db) => {
    const chat = await lockedMember(String(req.params.id), user(req).id, db);
    const existing = await db.query(
      'SELECT id,chat_id,poll_id FROM messages WHERE sender_id=$1 AND nonce=$2',
      [user(req).id, data.nonce],
    );
    if (existing.rows[0]) {
      requireValue(
        existing.rows[0].chat_id === chat.id,
        409,
        'Идентификатор сообщения уже использован.',
      );
      return { id: existing.rows[0].id as string, pollId: existing.rows[0].poll_id as string };
    }
    const pollId = randomUUID();
    await db.query(
      'INSERT INTO polls(id,chat_id,creator_id,question,options,multiple,anonymous) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        pollId,
        chat.id,
        user(req).id,
        data.question,
        JSON.stringify(data.options),
        data.multiple,
        data.anonymous,
      ],
    );
    const expiresAt = chat.auto_delete_seconds
      ? new Date(Date.now() + Number(chat.auto_delete_seconds) * 1000)
      : null;
    const messageId = randomUUID();
    await db.query(
      'INSERT INTO messages(id,chat_id,sender_id,body,nonce,poll_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [messageId, chat.id, user(req).id, data.question, data.nonce, pollId, expiresAt],
    );
    await queuePush(db, chat.kind, messageId);
    await notify(db, chat.id, undefined, undefined, {
      event: 'message.created',
      messageId,
      senderId: user(req).id,
    });
    return { id: messageId, pollId };
  });
  res.status(201).json(result);
});
app.post('/api/chats/:id/polls/:pollId/vote', auth, async (req, res) => {
  const { optionIndices } = z
    .object({ optionIndices: z.array(z.number().int().min(0).max(9)).max(10) })
    .strict()
    .parse(req.body);
  const selected = [...new Set(optionIndices)];
  await transaction(async (db) => {
    const chat = await lockedMember(String(req.params.id), user(req).id, db);
    const { rows } = await db.query(
      'SELECT p.id,p.options,p.multiple,p.closed,m.id AS message_id FROM polls p JOIN messages m ON m.poll_id=p.id WHERE p.id=$1 AND p.chat_id=$2 AND m.deleted_at IS NULL FOR UPDATE OF p',
      [uuid.parse(req.params.pollId), chat.id],
    );
    requireValue(rows[0], 404, 'Опрос не найден.');
    requireValue(!rows[0].closed, 400, 'Голосование завершено.');
    const count = Array.isArray(rows[0].options) ? rows[0].options.length : 0;
    requireValue(
      selected.every((i) => i < count) && (rows[0].multiple || selected.length <= 1),
      400,
      'Некорректный выбор ответа.',
    );
    await db.query('DELETE FROM poll_votes WHERE poll_id=$1 AND user_id=$2', [
      rows[0].id,
      user(req).id,
    ]);
    for (const idx of selected) {
      await db.query('INSERT INTO poll_votes(poll_id,option_index,user_id) VALUES($1,$2,$3)', [
        rows[0].id,
        idx,
        user(req).id,
      ]);
    }
    await notify(db, chat.id, undefined, undefined, {
      event: 'message.updated',
      messageId: rows[0].message_id,
      senderId: user(req).id,
    });
  });
  res.json({ ok: true });
});
app.post('/api/chats/:id/polls/:pollId/close', auth, async (req, res) => {
  await transaction(async (db) => {
    const chat = await lockedMember(String(req.params.id), user(req).id, db);
    const { rows } = await db.query(
      'SELECT p.id,p.creator_id,m.id AS message_id FROM polls p JOIN messages m ON m.poll_id=p.id WHERE p.id=$1 AND p.chat_id=$2 AND m.deleted_at IS NULL FOR UPDATE OF p',
      [uuid.parse(req.params.pollId), chat.id],
    );
    requireValue(rows[0], 404, 'Опрос не найден.');
    requireValue(
      rows[0].creator_id === user(req).id ||
        (chat.kind === 'group' && chat.owner_id === user(req).id),
      403,
      'Завершить опрос может автор или владелец группы.',
    );
    await db.query('UPDATE polls SET closed=true WHERE id=$1', [rows[0].id]);
    await notify(db, chat.id, undefined, undefined, {
      event: 'message.updated',
      messageId: rows[0].message_id,
      senderId: user(req).id,
    });
  });
  res.json({ ok: true });
});
// "Typing…", "recording a voice message…": relayed to the chat, never stored.
app.post('/api/chats/:id/typing', auth, async (req, res) => {
  const { action } = z
    .object({ action: z.enum(['typing', 'voice', 'video']) })
    .strict()
    .parse(req.body);
  const chat = await member(String(req.params.id), user(req).id);
  await pool.query("SELECT pg_notify('galinka', $1)", [
    JSON.stringify({
      type: 'typing',
      chatId: chat.id,
      userId: user(req).id,
      name: user(req).name,
      action,
    }),
  ]);
  res.json({ ok: true });
});
const upload = multer({
  storage: multer.diskStorage({
    destination: directory,
    filename: (_req, _file, cb) => cb(null, randomUUID()),
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 3, fieldSize: 4096 },
});
const inlineMediaTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/flac',
  'audio/aac',
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);
async function mediaType(filename: string, declaredType: string) {
  const file = await open(filename, 'r');
  try {
    const prefix = Buffer.alloc(4096);
    const { bytesRead } = await file.read(prefix, 0, prefix.length, 0);
    const bytes = prefix.subarray(0, bytesRead);
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
      return 'image/jpeg';
    if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'image/gif';
    if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
      return 'image/webp';
    if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE')
      return 'audio/wav';
    if (bytes.toString('ascii', 0, 4) === 'fLaC') return 'audio/flac';
    const frame = bytes.length >= 7 && bytes[0] === 0xff;
    if (frame && (bytes[1] & 0xf6) === 0xf0 && (bytes[2] & 0x3c) < 0x34) return 'audio/aac';
    if (
      (bytes.length >= 10 &&
        bytes.toString('ascii', 0, 3) === 'ID3' &&
        [2, 3, 4].includes(bytes[3]) &&
        bytes.subarray(6, 10).every((byte) => byte < 128)) ||
      (frame &&
        (bytes[1] & 0xe6) === 0xe2 &&
        (bytes[1] & 0x18) !== 0x08 &&
        (bytes[2] & 0xf0) !== 0 &&
        (bytes[2] & 0xf0) !== 0xf0 &&
        (bytes[2] & 0x0c) !== 0x0c)
    )
      return 'audio/mpeg';
    // Ogg, MP4 and WebM can carry video too. Only offer the audio player when
    // the upload was declared as audio AND its container signature agrees.
    if (declaredType.toLowerCase().startsWith('audio/')) {
      if (bytes.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
      if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp') return 'audio/mp4';
      if (
        bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])) &&
        bytes.includes(Buffer.from('webm'))
      )
        return 'audio/webm';
    }
    // Same rule for video: declared as video and the container agrees.
    if (declaredType.toLowerCase().startsWith('video/')) {
      if (
        bytes.length >= 12 &&
        bytes.toString('ascii', 4, 8) === 'ftyp' &&
        bytes.toString('ascii', 8, 12) !== 'M4A '
      )
        return bytes.toString('ascii', 8, 10) === 'qt' ? 'video/quicktime' : 'video/mp4';
      if (
        bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])) &&
        bytes.includes(Buffer.from('webm'))
      )
        return 'video/webm';
    }
    return 'application/octet-stream';
  } finally {
    await file.close();
  }
}
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
    const meta = mediaMetaSchema.safeParse(req.body ?? {});
    const record = await storeUploadedFile(req, String(req.params.id), {
      path: file.path,
      id: file.filename,
      size: file.size,
      name: Buffer.from(file.originalname, 'latin1').toString('utf8'),
      declared: file.mimetype,
      meta: meta.success ? meta.data : {},
    });
    res.status(201).json(record);
  },
);
const fileName = (value: string) =>
  value.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 180) || 'Файл';
/**
 * Turns an uploaded file on disk into an attachment: checks what it really is, makes voice
 * playable everywhere (and draws its waveform), counts it against the account limit and queues
 * WebM or big videos for conversion. Removes the file on any failure.
 */
async function storeUploadedFile(
  req: Request,
  chatId: string,
  file: { path: string; id: string; size: number; name: string; declared: string; meta: MediaMeta },
  uploadDb?: PoolClient,
) {
  try {
    let mime = await mediaType(file.path, file.declared);
    let name = fileName(file.name);
    let size = file.size;
    // The normalizer is for recordings. Music can exceed five minutes and must
    // retain its channels, metadata and original bytes when downloaded.
    const originalAudio = req.query.originalAudio === '1' && isRecordedAudio(mime);
    const normalized =
      !originalAudio && size <= 20 * 1024 * 1024
        ? await normalizeUploadedAudio(file.path, mime)
        : null;
    let waveform: number[] | null = null;
    if (normalized) {
      mime = 'audio/mp4';
      name = name.replace(/\.[^.]+$/, '') + '.m4a';
      size = normalized.size;
      waveform = await voiceWaveform(file.path);
    }
    const visual = visualMeta(mime, file.meta);
    const store = async (db: PoolClient) => {
      await lockedMember(chatId, user(req).id, db);
      const account = await db.query('SELECT id,blocked FROM users WHERE id=$1 FOR UPDATE', [
        user(req).id,
      ]);
      requireValue(account.rows[0] && !account.rows[0].blocked, 401, 'Войдите в Galinka снова.');
      const session = await db.query(
        'SELECT token FROM sessions WHERE token=$1 AND user_id=$2 AND expires_at>now() FOR SHARE',
        [(req as AuthedRequest).sessionToken, user(req).id],
      );
      requireValue(session.rowCount, 401, 'Войдите в Galinka снова.');
      // A finished upload exchanges its reservation for the stored attachment atomically.
      if (uploadDb) await db.query('DELETE FROM uploads WHERE id=$1', [file.id]);
      await checkUploadQuota(db, user(req).id, size);
      const { rows } = await db.query(
        `INSERT INTO files(id,chat_id,user_id,name,size,mime,audio_ready,width,height,thumb,waveform)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,name,size,mime,width,height,thumb,waveform`,
        [
          file.id,
          chatId,
          user(req).id,
          name,
          size,
          mime,
          Boolean(normalized) || originalAudio,
          visual.width,
          visual.height,
          visual.thumb,
          waveform,
        ],
      );
      if (needsVideoWork(mime, size))
        await db.query('INSERT INTO media_jobs(file_id) VALUES($1) ON CONFLICT DO NOTHING', [
          file.id,
        ]);
      return rows[0];
    };
    return await (uploadDb ? store(uploadDb) : transaction(store));
  } catch (error) {
    await unlink(file.path).catch(() => {});
    throw error;
  }
}

// Resumable uploads for files up to 100 MB: create, send parts from the offset the server
// reports, finish. A broken connection resumes from what arrived; parts expire after a day.
const uploadPart = (id: string) => path.join(directory, `upload-${id}.part`);
// Called with the user row locked. Unfinished files reserve their declared size.
async function checkUploadQuota(db: PoolClient, userId: string, bytes: number, starting = false) {
  const usage = await fileUsage(db, userId);
  requireValue(
    usage.bytes + bytes <= maxAccountFileBytes,
    413,
    'Лимит файлов аккаунта — 500 МБ. Свяжитесь с владельцем сервера.',
  );
  if (starting) requireValue(usage.open < 20, 429, 'Слишком много незаконченных загрузок.');
}
app.post('/api/chats/:id/uploads', auth, async (req, res) => {
  const data = z
    .object({
      name: z.string().min(1).max(500),
      type: z.string().max(200).default(''),
      size: z.number().int().min(1).max(maxUploadBytes),
    })
    .and(mediaMetaSchema)
    .safeParse(req.body);
  requireValue(data.success, 400, 'Файл больше 100 МБ или описан неверно.');
  const upload = data.data!;
  const id = randomUUID();
  await transaction(async (db) => {
    await lockedMember(String(req.params.id), user(req).id, db);
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user(req).id]);
    await checkUploadQuota(db, user(req).id, upload.size, true);
    await db.query(
      'INSERT INTO uploads(id,chat_id,user_id,name,mime,size,width,height,thumb) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        id,
        req.params.id,
        user(req).id,
        fileName(upload.name),
        upload.type,
        upload.size,
        upload.width ?? null,
        upload.height ?? null,
        upload.thumb ?? null,
      ],
    );
  });
  res.status(201).json({ id, offset: 0 });
});
async function ownUpload(req: Request, db?: PoolClient) {
  const { rows } = await (db ?? pool).query(
    `SELECT * FROM uploads WHERE id=$1 AND user_id=$2 ${db ? 'FOR UPDATE' : ''}`,
    [uuid.parse(req.params.id), user(req).id],
  );
  return rows[0];
}
async function receivedBytes(id: string) {
  try {
    return (await stat(uploadPart(id))).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}
app.get('/api/uploads/:id', auth, async (req, res) => {
  const row = await ownUpload(req);
  if (row) return res.json({ id: row.id, offset: await receivedBytes(row.id), size: row.size });
  const file = await finishedUpload(req);
  res.json({ id: file.id, offset: file.size, size: file.size, file });
});
app.put('/api/uploads/:id', auth, async (req, res) => {
  const result = await transaction(async (db) => {
    const row = await ownUpload(req, db);
    requireValue(row, 404, 'Загрузка не найдена. Начните её заново.');
    const offset = await receivedBytes(row.id);
    if (Number(req.query.offset) !== offset) {
      return { status: 409, body: { error: 'Загрузка продолжится с другого места.', offset } };
    }
    let received = 0;
    const room = row.size - offset;
    requireValue(
      !(Number(req.headers['content-length']) > room),
      413,
      'Файл больше, чем заявлено.',
    );
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        callback(received > room ? new HttpError(413, 'Файл больше, чем заявлено.') : null, chunk);
      },
    });
    try {
      await pipeline(req, limit, createWriteStream(uploadPart(row.id), { flags: 'a' }));
    } catch (error) {
      // What arrived intact stays for the resume; nothing past the declared size is kept.
      if (received > room) await truncate(uploadPart(row.id), offset).catch(() => {});
      throw error instanceof HttpError ? error : new HttpError(400, 'Соединение прервалось.');
    }
    return { status: 200, body: { offset: offset + received } };
  });
  res.status(result.status).json(result.body);
});
async function finishedUpload(req: Request, db: Pool | PoolClient = pool) {
  const { rows } = await db.query(
    'SELECT id,name,size,mime,width,height,thumb,waveform FROM files WHERE id=$1 AND user_id=$2',
    [uuid.parse(req.params.id), user(req).id],
  );
  requireValue(rows[0], 404, 'Загрузка не найдена. Начните её заново.');
  return rows[0];
}
app.post('/api/uploads/:id/finish', auth, async (req, res) => {
  const record = await transaction(async (db) => {
    const row = await ownUpload(req, db);
    if (!row) return finishedUpload(req, db);
    requireValue((await receivedBytes(row.id)) === row.size, 409, 'Файл загружен не полностью.');
    // Keep the uploaded bytes until conversion and the database commit succeed.
    const target = path.join(directory, row.id);
    await copyFile(uploadPart(row.id), target);
    return storeUploadedFile(
      req,
      row.chat_id,
      {
        path: target,
        id: row.id,
        size: row.size,
        name: row.name,
        declared: row.mime,
        meta: {
          width: row.width ?? undefined,
          height: row.height ?? undefined,
          thumb: row.thumb ?? undefined,
        },
      },
      db,
    );
  });
  await unlink(uploadPart(record.id)).catch(() => {});
  res.status(201).json(record);
});
app.delete('/api/uploads/:id', auth, async (req, res) => {
  const { rows } = await pool.query('DELETE FROM uploads WHERE id=$1 AND user_id=$2 RETURNING id', [
    uuid.parse(req.params.id),
    user(req).id,
  ]);
  requireValue(rows[0], 404, 'Загрузка не найдена. Начните её заново.');
  await unlink(uploadPart(rows[0].id)).catch(() => {});
  res.json({ ok: true });
});
// Profile and group photos. The client crops a square and sends a small JPEG or WebP; the
// server checks the file really is an image and serves it only to signed-in users.
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: directory,
    filename: (_req, _file, cb) => cb(null, `avatar-${randomUUID()}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 },
});
const avatarTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const avatarPath = (id: string) => path.join(directory, `avatar-${uuid.parse(id)}`);
async function storeAvatar(file: Express.Multer.File | undefined) {
  requireValue(file, 400, 'Выберите фото.');
  if (!avatarTypes.has(await mediaType(file!.path, file!.mimetype))) {
    await unlink(file!.path).catch(() => {});
    requireValue(false, 400, 'Подходят фото PNG, JPEG или WebP.');
  }
  return file!.filename.slice('avatar-'.length);
}
const dropAvatar = async (id?: string | null) => {
  if (id) await unlink(avatarPath(id)).catch(() => {});
};
async function setUserAvatar(userId: string, avatar: string | null) {
  const { rows: before } = await pool.query('SELECT avatar FROM users WHERE id=$1', [userId]);
  const { rows } = await pool.query(
    `UPDATE users SET avatar=$1 WHERE id=$2 RETURNING ${personSQL}`,
    [avatar, userId],
  );
  await dropAvatar(before[0]?.avatar);
  return rows[0];
}
app.post('/api/me/avatar', auth, avatarUpload.single('file'), async (req, res) => {
  const id = await storeAvatar(req.file);
  try {
    res.json(await setUserAvatar(user(req).id, id));
  } catch (error) {
    await dropAvatar(id);
    throw error;
  }
});
app.delete('/api/me/avatar', auth, async (req, res) => {
  res.json(await setUserAvatar(user(req).id, null));
});
async function groupOwner(req: Request, _res: Response, next: NextFunction) {
  try {
    const chat = await member(String(req.params.id), user(req).id);
    requireValue(
      chat.kind === 'group' && chat.owner_id === user(req).id,
      403,
      'Фото группы меняет владелец.',
    );
    next();
  } catch (error) {
    next(error);
  }
}
async function setChatAvatar(chatId: string, avatar: string | null) {
  const { rows: before } = await pool.query('SELECT avatar FROM chats WHERE id=$1', [chatId]);
  await pool.query('UPDATE chats SET avatar=$1 WHERE id=$2', [avatar, chatId]);
  await dropAvatar(before[0]?.avatar);
  await notify(pool, chatId);
}
app.post(
  '/api/chats/:id/avatar',
  auth,
  groupOwner,
  avatarUpload.single('file'),
  async (req, res) => {
    const id = await storeAvatar(req.file);
    try {
      await setChatAvatar(String(req.params.id), id);
    } catch (error) {
      await dropAvatar(id);
      throw error;
    }
    res.json({ avatar: id });
  },
);
app.delete('/api/chats/:id/avatar', auth, groupOwner, async (req, res) => {
  await setChatAvatar(String(req.params.id), null);
  res.json({ avatar: null });
});
app.get('/api/avatars/:id', auth, async (req, res) => {
  const id = uuid.parse(req.params.id);
  const { rowCount } = await pool.query(
    'SELECT 1 FROM users WHERE avatar=$1 UNION ALL SELECT 1 FROM chats WHERE avatar=$1 LIMIT 1',
    [id],
  );
  requireValue(rowCount, 404, 'Фото не найдено.');
  const file = avatarPath(id);
  res.setHeader('Content-Type', await mediaType(file, 'image/'));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // A new photo gets a new id, so a stored one never changes.
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  if (publicApiOrigin && publicApiOrigin !== origin)
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.sendFile(file);
});
// A file is readable in the chat it was uploaded to and in every chat it was forwarded to.
const fileAccessSQL = `(EXISTS(SELECT 1 FROM members WHERE chat_id=f.chat_id AND user_id=$2)
 OR EXISTS(SELECT 1 FROM messages msg JOIN members mm ON mm.chat_id=msg.chat_id WHERE msg.file_id=f.id AND mm.user_id=$2))`;
async function serveAttachment(req: Request, res: Response, next: NextFunction, retry = true) {
  const { rows } = await pool.query(`SELECT f.* FROM files f WHERE f.id=$1 AND ${fileAccessSQL}`, [
    uuid.parse(req.params.id),
    user(req).id,
  ]);
  requireValue(rows[0], 404, 'Файл не найден.');
  const file = rows[0];
  const original = file.converted_video
    ? videoPath(directory, file.id)
    : path.join(directory, file.id);
  const sent = (error?: Error) => {
    if (!error || res.destroyed) return;
    // Conversion can commit after the lookup and retire the original before
    // sendFile opens it. Look up the new representation, including its MIME.
    if (
      retry &&
      !file.converted_video &&
      needsVideoWork(file.mime, file.size) &&
      !res.headersSent &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      for (const header of ['ETag', 'Last-Modified', 'Content-Length', 'Content-Range'])
        res.removeHeader(header);
      void serveAttachment(req, res, next, false).catch(next);
    } else next(error);
  };
  const mime =
    req.query.inline === '1' &&
    rows[0].mime === 'application/octet-stream' &&
    /\.(mp3|wav|flac|aac)$/i.test(rows[0].name)
      ? await mediaType(original, 'audio/*').catch(() => 'application/octet-stream')
      : rows[0].mime;
  if (req.query.inline === '1' && inlineMediaTypes.has(mime)) {
    const preview =
      isRecordedAudio(mime) && !rows[0].audio_ready && rows[0].size <= 20 * 1024 * 1024
        ? await audioPreview(original, mime)
        : undefined;
    if (preview) {
      if (res.destroyed) {
        preview.release();
        return;
      }
      res.once('finish', preview.release);
      res.once('close', preview.release);
      res.once('error', preview.release);
      const access = await pool.query(
        `SELECT 1 FROM files f JOIN sessions s ON s.user_id=$2 JOIN users u ON u.id=s.user_id
         WHERE f.id=$1 AND s.token=$3 AND s.expires_at>now() AND NOT u.blocked AND ${fileAccessSQL}`,
        [rows[0].id, user(req).id, (req as AuthedRequest).sessionToken],
      );
      requireValue(access.rowCount, 404, 'Файл недоступен.');
    }
    res.setHeader('Content-Type', preview ? 'audio/mp4' : mime);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    if (publicApiOrigin && publicApiOrigin !== origin)
      res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    // The derived file lives in a private dot-directory; Express otherwise
    // rejects it before opening. Both paths are resolved from validated IDs.
    res.sendFile(preview?.path || original, { dotfiles: preview ? 'allow' : 'ignore' }, sent);
    return;
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.download(original, file.name, sent);
}
app.get('/api/files/:id', auth, (req, res, next) => serveAttachment(req, res, next));
const streams = new Map<Response, { userId: string; token: string }>();
// Someone came online or left: remember when, and tell the people they share chats with.
// ponytail: streams of this instance only; publish through pg_notify when running replicas.
async function presenceChanged(userId: string) {
  try {
    await pool.query('UPDATE users SET last_seen_at=now() WHERE id=$1', [userId]);
    const { rows } = await pool.query(
      'SELECT DISTINCT other.user_id FROM members mine JOIN members other ON other.chat_id=mine.chat_id WHERE mine.user_id=$1 AND other.user_id<>$1',
      [userId],
    );
    const peers = new Set(rows.map((row) => row.user_id as string));
    const event = `data: ${JSON.stringify({ type: 'presence', userId })}\n\n`;
    for (const [response, stream] of streams) if (peers.has(stream.userId)) response.write(event);
  } catch {
    /* Presence is best effort; the next connection updates it. */
  }
}
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
  const wasOnline = [...streams.values()].some((stream) => stream.userId === uid);
  streams.set(res, { userId: uid, token });
  if (!wasOnline) void presenceChanged(uid);
  const heartbeat = setInterval(async () => {
    try {
      const valid = await pool.query(
        'SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=$1 AND s.expires_at>now() AND NOT u.blocked',
        [token],
      );
      if (!valid.rowCount) {
        res.end();
        return;
      }
      // Named, so clients before 0.14 ignore it; newer ones use it to notice a dead stream.
      res.write(': heartbeat\n\nevent: ping\ndata: {}\n\n');
    } catch {
      res.end();
    }
  }, 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    streams.delete(res);
    if (![...streams.values()].some((stream) => stream.userId === uid)) void presenceChanged(uid);
  });
});
let listener: Client | undefined,
  listening = false,
  stopping = false;
async function listen() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  listener = client;
  client.on('error', () => client.end().catch(() => {}));
  client.on('end', () => {
    listening = false;
    if (!stopping) setTimeout(() => listen().catch(() => {}), 2000).unref();
  });
  client.on('notification', async (event) => {
    try {
      if (!event.payload) return;
      const change = JSON.parse(event.payload) as {
        type?: 'read' | 'refresh' | 'typing' | 'draft';
        chatId: string;
        deletedId?: string;
        revokedUserId?: string;
        removedUserId?: string;
        forUserId?: string;
        origin?: string;
        event?: 'message.created' | 'message.updated';
        batch?: boolean;
        messageId?: string;
        senderId?: string;
        userId?: string;
        lastMessageId?: string;
      };
      if (change.revokedUserId) {
        for (const [res, info] of streams) if (info.userId === change.revokedUserId) res.end();
        return;
      }
      const { rows } = await pool.query('SELECT user_id FROM members WHERE chat_id=$1', [
        change.chatId,
      ]);
      const ids = new Set(rows.map((r) => r.user_id));
      if (change.removedUserId) ids.add(change.removedUserId);
      // A new or changed message travels with the event, so open chats need no refetch.
      // The row embeds reactions.mine, so it is read once per viewer, not once per stream.
      // event/messageId/senderId stay at the top level for clients older than 0.13.
      const messageCache = new Map<string, unknown>();
      const payloadFor = async (viewerId: string) => {
        if (change.type === 'draft') {
          const { rows: found } = await pool.query(
            'SELECT draft FROM members WHERE chat_id=$1 AND user_id=$2',
            [change.chatId, viewerId],
          );
          return { type: 'draft', chatId: change.chatId, draft: found[0]?.draft ?? '' };
        }
        if (change.event && change.messageId && !change.batch) {
          if (!messageCache.has(viewerId)) {
            const { rows: found } = await pool.query(
              `${messageSQL} WHERE m.id=$1 AND EXISTS(SELECT 1 FROM members viewer WHERE viewer.chat_id=m.chat_id AND viewer.user_id=$2) AND ${visibleMessageWhere}`,
              [change.messageId, viewerId],
            );
            messageCache.set(viewerId, found[0] ?? null);
          }
          const message = messageCache.get(viewerId);
          if (message) return { ...change, type: 'message', message };
        }
        return { type: 'refresh', ...change };
      };
      for (const [res, info] of streams)
        if (ids.has(info.userId)) {
          if (change.forUserId && info.userId !== change.forUserId) continue;
          if (change.origin && digest(info.token) === change.origin) continue;
          if (change.type === 'typing' && info.userId === change.userId) continue;
          if (res.writableLength > 1024 * 1024) {
            res.end();
            continue;
          }
          res.write(`data: ${JSON.stringify(await payloadFor(info.userId))}\n\n`);
        }
    } catch (error) {
      console.error('Notification delivery failed', error);
    }
  });
  await client.connect();
  await client.query('LISTEN galinka');
  listening = true;
  // A listener reconnection invalidates clients so missed transient notifications recover from PostgreSQL.
  for (const res of streams.keys()) res.write('data: {"type":"connected"}\n\n');
}
await listen();
const clientErrorFields = z.object({
  message: z.string().trim().min(1).max(1000),
  stack: z.string().max(8000).default(''),
  url: z.string().max(500).default(''),
  release: z.string().max(80).default(''),
});
async function optionalUserId(req: Request) {
  const raw = readCookie(req.headers.cookie);
  if (!raw) return null;
  const { rows } = await pool.query<{ user_id: string }>(
    'SELECT s.user_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=$1 AND s.expires_at>now() AND NOT u.blocked',
    [digest(raw)],
  );
  return rows[0]?.user_id ?? null;
}
app.post('/api/client-errors', async (req, res) => {
  const data = clientErrorFields.parse(req.body);
  const userId = await optionalUserId(req).catch(() => null);
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 300);
  await pool.query(
    'INSERT INTO client_errors(id,user_id,message,stack,url,user_agent,release) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [randomUUID(), userId, data.message, data.stack, data.url, userAgent, data.release],
  );
  await pool.query(
    'DELETE FROM client_errors WHERE id IN (SELECT id FROM client_errors ORDER BY created_at DESC OFFSET 500)',
  );
  res.status(201).json({ ok: true });
});
app.get('/api/admin/monitoring', auth, admin, async (_req, res) => {
  const [counts, errorRows] = await Promise.all([
    pool.query<{
      users: number;
      chats: number;
      messages: number;
      files: number;
      storage_bytes: string;
      push_queue: number;
      client_errors: number;
    }>(`SELECT
      (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM chats) AS chats,
      (SELECT count(*)::int FROM messages) AS messages,
      (SELECT count(*)::int FROM files) AS files,
      (SELECT COALESCE(sum(size),0)::bigint FROM files) AS storage_bytes,
      (SELECT count(*)::int FROM push_jobs) AS push_queue,
      (SELECT count(*)::int FROM client_errors) AS client_errors`),
    pool.query(
      `SELECT e.id,e.user_id,u.username,u.name AS user_name,e.message,e.stack,e.url,e.user_agent,e.release,e.created_at
       FROM client_errors e LEFT JOIN users u ON u.id=e.user_id
       ORDER BY e.created_at DESC LIMIT 50`,
    ),
  ]);
  const row = counts.rows[0];
  res.json({
    health: {
      ok: listening,
      listening,
      startedAt: new Date(startedAt).toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      memoryBytes: process.memoryUsage().rss,
      version: buildInfo.version,
      build: buildInfo.build,
    },
    metrics: {
      requests: { ...httpMetrics },
      activeStreams: streams.size,
      onlineUsers: new Set([...streams.values()].map((s) => s.userId)).size,
      users: row.users,
      chats: row.chats,
      messages: row.messages,
      files: row.files,
      storageBytes: Number(row.storage_bytes),
      pushQueue: row.push_queue,
      clientErrors: row.client_errors,
    },
    errors: errorRows.rows,
  });
});
app.delete('/api/admin/client-errors', auth, admin, async (_req, res) => {
  await pool.query('DELETE FROM client_errors');
  res.json({ ok: true });
});
async function metricsAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (metricsToken && header?.startsWith('Bearer ')) {
    const provided = header.slice(7);
    if (timingSafeEqual(Buffer.from(digest(provided)), Buffer.from(digest(metricsToken)))) {
      next();
      return;
    }
    res.status(401).json({ error: 'Войдите снова.' });
    return;
  }
  await auth(req, res, (err?: unknown) => {
    if (err) return next(err);
    try {
      admin(req, res, next);
    } catch (error) {
      next(error);
    }
  });
}
app.get('/api/metrics', metricsAuth, async (_req, res) => {
  let dbOk = true;
  let pushQueue = 0;
  let clientErrors = 0;
  try {
    const { rows } = await pool.query<{ push_queue: number; client_errors: number }>(
      `SELECT (SELECT count(*)::int FROM push_jobs) AS push_queue,
              (SELECT count(*)::int FROM client_errors) AS client_errors`,
    );
    pushQueue = rows[0]?.push_queue ?? 0;
    clientErrors = rows[0]?.client_errors ?? 0;
  } catch {
    dbOk = false;
  }
  const onlineUsers = new Set([...streams.values()].map((s) => s.userId)).size;
  const lines = [
    '# HELP galinka_up Server and database availability (1 = ready).',
    '# TYPE galinka_up gauge',
    `galinka_up ${listening && dbOk ? 1 : 0}`,
    '# HELP galinka_uptime_seconds Process uptime in seconds.',
    '# TYPE galinka_uptime_seconds gauge',
    `galinka_uptime_seconds ${Math.floor(process.uptime())}`,
    '# HELP galinka_memory_rss_bytes Resident set size in bytes.',
    '# TYPE galinka_memory_rss_bytes gauge',
    `galinka_memory_rss_bytes ${process.memoryUsage().rss}`,
    '# HELP galinka_http_requests_total Total API requests handled.',
    '# TYPE galinka_http_requests_total counter',
    `galinka_http_requests_total ${httpMetrics.total}`,
    '# HELP galinka_http_errors_total Total API requests returning 4xx or 5xx.',
    '# TYPE galinka_http_errors_total counter',
    `galinka_http_errors_total ${httpMetrics.clientError + httpMetrics.serverError}`,
    '# HELP galinka_sse_streams Active SSE connections.',
    '# TYPE galinka_sse_streams gauge',
    `galinka_sse_streams ${streams.size}`,
    '# HELP galinka_online_users Unique users currently connected via SSE.',
    '# TYPE galinka_online_users gauge',
    `galinka_online_users ${onlineUsers}`,
    '# HELP galinka_push_queue Pending background push jobs.',
    '# TYPE galinka_push_queue gauge',
    `galinka_push_queue ${pushQueue}`,
    '# HELP galinka_client_errors_total Stored client error reports.',
    '# TYPE galinka_client_errors_total gauge',
    `galinka_client_errors_total ${clientErrors}`,
  ];
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(lines.join('\n') + '\n');
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Маршрут не найден.' }));
const publicDir = path.resolve('dist');
if (production) {
  const landingPage = path.resolve('dist-landing.html');
  const hasLandingPage = existsSync(landingPage);
  app.use(
    express.static(publicDir, {
      index: false,
      setHeaders(res, file) {
        if (file.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-store');
      },
    }),
  );
  app.get('/{*path}', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const showLanding = hasLandingPage && req.path === '/' && !req.url.includes('demo=1');
    res.sendFile(showLanding ? landingPage : path.join(publicDir, 'index.html'));
  });
}
const fieldErrors: Record<string, string> = {
  username: 'Логин: 3–24 символа, латиница, цифры и _.',
  password: 'Пароль: от 10 до 128 символов.',
  name: 'Имя: от 1 до 40 символов.',
  body: 'Сообщение: до 8000 символов.',
  title: 'Название не заполнено или слишком длинное.',
  invite: 'Укажите код приглашения.',
};
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ error: 'Некорректный JSON.' });
    return;
  }
  if (error instanceof ZodError) {
    const field = String(error.issues[0]?.path[0] ?? '');
    res.status(400).json({ error: fieldErrors[field] || 'Проверьте введённые данные.' });
    return;
  }
  if (error instanceof HttpError || error instanceof AudioError || error instanceof PreviewError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof multer.MulterError) {
    res.status(400).json({ error: 'Файл слишком большой. Максимум — 20 МБ, по одному файлу.' });
    return;
  }
  if ((error as { code?: string }).code === '23505') {
    const login = (error as { constraint?: string }).constraint === 'users_username_key';
    res.status(409).json({ error: login ? 'Этот логин уже занят.' : 'Запись уже существует.' });
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
const stopTranscription = startTranscriptionWorker(pool, directory, process.env.WHISPER_MODEL);
// A converted video keeps its id; open chats refresh every message that shows it.
const stopMedia = startMediaWorker(pool, directory, async (fileId) => {
  const { rows } = await pool.query('SELECT id,chat_id,sender_id FROM messages WHERE file_id=$1', [
    fileId,
  ]);
  for (const row of rows)
    await notify(pool, row.chat_id, undefined, undefined, {
      event: 'message.updated',
      messageId: row.id,
      senderId: row.sender_id,
    });
});
server.requestTimeout = 120_000;
async function deliverDueScheduledMessages() {
  if (stopping) return;
  const done = await transaction(async (db) => {
    const { rows } = await db.query(
      'SELECT * FROM scheduled_messages WHERE scheduled_for<=clock_timestamp() ORDER BY scheduled_for ASC LIMIT 20 FOR UPDATE SKIP LOCKED',
    );
    const delivered = [];
    for (const row of rows) delivered.push(await deliverScheduledRow(db, row, true));
    return delivered;
  });
  for (const item of done)
    if (item?.needsPreview)
      attachLinkPreview(item.row.chat_id, item.messageId, item.row.sender_id, item.row.body);
}
async function purgeExpiredMessages() {
  if (stopping) return;
  const removedFiles = await transaction(async (db) => {
    const { rows } = await db.query(
      `DELETE FROM messages WHERE (expires_at IS NOT NULL AND expires_at<=clock_timestamp())
       OR (deleted_at IS NOT NULL AND deleted_at<now()-interval '2 minutes')
       RETURNING id,chat_id,file_id,deleted_at`,
    );
    if (!rows.length) return [] as string[];
    for (const row of rows) {
      if (!row.deleted_at) await notify(db, row.chat_id, row.id);
    }
    const fileIds = [...new Set(rows.map((r) => r.file_id).filter(Boolean) as string[])];
    if (!fileIds.length) return [] as string[];
    const orphaned = await db.query(
      `DELETE FROM files f WHERE f.id=ANY($1::uuid[])
       AND NOT EXISTS(SELECT 1 FROM messages WHERE file_id=f.id)
       AND NOT EXISTS(SELECT 1 FROM scheduled_messages WHERE file_id=f.id) RETURNING id`,
      [fileIds],
    );
    return orphaned.rows.map((r) => r.id as string);
  });
  if (removedFiles.length) await removeStoredFiles(removedFiles);
}
const scheduleTimer = setInterval(() => {
  void deliverDueScheduledMessages().catch(console.error);
}, 2500);
scheduleTimer.unref();
const expireTimer = setInterval(() => {
  void purgeExpiredMessages().catch(console.error);
}, 10_000);
expireTimer.unref();
async function stop() {
  stopPush();
  const transcriptionStopped = stopTranscription();
  stopMedia();
  clearInterval(scheduleTimer);
  clearInterval(expireTimer);
  stopping = true;
  for (const res of streams.keys()) res.end();
  server.close();
  await listener?.end();
  await transcriptionStopped;
  await pool.end();
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
// Hourly housekeeping. Uploads never attached to a message are removed after a day.
// ponytail: runs on every replica; the deletes are idempotent, just redundant.
async function housekeeping() {
  await pool.query('DELETE FROM sessions WHERE expires_at<now()');
  await pool.query('DELETE FROM invites WHERE expires_at<now()');
  await pool.query(
    "DELETE FROM signup_invites WHERE used_at IS NULL AND expires_at<now()-interval '30 days'",
  );
  await pool.query("DELETE FROM client_errors WHERE created_at<now()-interval '30 days'");
  await pool.query("DELETE FROM link_previews WHERE fetched_at<now()-interval '30 days'");
  await purgeExpiredMessages();
  const { rows } = await pool.query(
    `DELETE FROM files f WHERE created_at<now()-interval '1 day'
     AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.file_id=f.id)
     AND NOT EXISTS(SELECT 1 FROM scheduled_messages sm WHERE sm.file_id=f.id) RETURNING id`,
  );
  await removeStoredFiles(rows.map((row) => row.id as string));
  const { rows: stale } = await pool.query(
    "DELETE FROM uploads WHERE created_at<now()-interval '1 day' RETURNING id",
  );
  for (const row of stale) {
    await unlink(uploadPart(row.id)).catch(() => {});
    await unlink(path.join(directory, row.id)).catch(() => {});
  }
  // A crash after commit or a cascading chat deletion can leave scratch files
  // without a job/upload row. Active conversions finish within 15 minutes.
  for await (const entry of await opendir(directory)) {
    if (!entry.isFile() || !entry.name.endsWith('.part')) continue;
    const filename = path.join(directory, entry.name);
    const info = await stat(filename).catch(() => null);
    if (!info || Date.now() - info.mtimeMs < 86400_000) continue;
    const pending = /^upload-([a-f0-9-]{36})\.part$/.exec(entry.name);
    if (pending && (await pool.query('SELECT 1 FROM uploads WHERE id=$1', [pending[1]])).rowCount)
      continue;
    if (pending || /^[a-f0-9-]{36}\.[a-f0-9-]{36}\.mp4\.part$/.test(entry.name))
      await unlink(filename).catch(() => {});
  }
}
const cleanup = setInterval(() => housekeeping().catch(console.error), 3600_000);
cleanup.unref();
