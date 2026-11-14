import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getMessaging, type BatchResponse, type MulticastMessage } from 'firebase-admin/messaging';
import { createECDH, createHash, ECDH } from 'node:crypto';
import webPush, { type PushSubscription } from 'web-push';
import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';

export const pushEnabled = process.env.PUSH_ENABLED === 'true';

// Client-provided subscription URLs may only address known browser push services.
// web-push uses HTTPS directly and does not follow redirects.
export function allowedPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash)
      return false;
    if (url.href !== endpoint || endpoint.length > 2048) return false;
    return (
      url.hostname === 'fcm.googleapis.com' ||
      url.hostname === 'updates.push.services.mozilla.com' ||
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.push\.apple\.com$/.test(url.hostname) ||
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.notify\.windows\.com$/.test(url.hostname)
    );
  } catch {
    return false;
  }
}

function validKey(value: string, length: number) {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return false;
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== length || decoded.toString('base64url') !== value.replace(/=+$/, ''))
    return false;
  if (length !== 65) return true;
  try {
    return decoded[0] === 4 && ECDH.convertKey(decoded, 'prime256v1').length === 65;
  } catch {
    return false;
  }
}

export const webPushEndpointSchema = z.string().max(2048).refine(allowedPushEndpoint);
export const webPushSubscriptionSchema = z.object({
  endpoint: webPushEndpointSchema,
  expirationTime: z.number().int().min(1).max(8_640_000_000_000_000).nullable().optional(),
  keys: z.object({
    p256dh: z
      .string()
      .max(90)
      .refine((value) => validKey(value, 65)),
    auth: z
      .string()
      .max(24)
      .refine((value) => validKey(value, 16)),
  }),
});

export function readWebPushConfig(env: NodeJS.ProcessEnv) {
  const publicKey = env.WEB_PUSH_PUBLIC_KEY;
  const privateKey = env.WEB_PUSH_PRIVATE_KEY;
  const subject = env.WEB_PUSH_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  try {
    if (
      publicKey.includes('=') ||
      privateKey.includes('=') ||
      !validKey(publicKey, 65) ||
      !validKey(privateKey, 32)
    )
      return null;
    const key = createECDH('prime256v1');
    key.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    if (key.getPublicKey().toString('base64url') !== publicKey) return null;
    const url = new URL(subject);
    if (!['https:', 'mailto:'].includes(url.protocol) || url.hostname === 'localhost') return null;
    if (url.protocol === 'mailto:' && !/^[^\s@]+@[^\s@]+$/.test(url.pathname)) return null;
    return { subject, publicKey, privateKey };
  } catch {
    return null;
  }
}

const webPushConfig = readWebPushConfig(process.env);
export const browserPushAvailable = webPushConfig !== null;
export const webPushPublicKey = webPushConfig?.publicKey ?? null;
export const anyPushEnabled = pushEnabled || browserPushAvailable;

/** What a notification may say, chosen by each recipient in Settings → Notifications. */
export type Preview = 'full' | 'sender' | 'none';
export type MessageInfo = {
  body: string;
  file_name: string | null;
  mime: string | null;
  kind: string;
  title: string;
  sender: string;
};
export type NotificationText = { title: string; body: string };
const generic: NotificationText = { title: 'Galinka', body: 'Новое сообщение' };
const attachmentWord = (info: MessageInfo) =>
  !info.file_name
    ? 'Новое сообщение'
    : info.mime?.startsWith('image/')
      ? 'Фотография'
      : info.mime?.startsWith('video/')
        ? info.file_name.startsWith('Кружок')
          ? 'Кружок'
          : 'Видео'
        : info.mime?.startsWith('audio/')
          ? 'Голосовое сообщение'
          : `Файл: ${info.file_name}`;
/**
 * Title and text for one recipient. "full": author and text, as in Telegram; "sender": only who
 * wrote; "none": nothing but "New message". In a group the chat is the title and the author
 * leads the text; in a direct chat the author is the title.
 */
/** Message text without formatting marks; spoilers stay hidden. Keep in sync with src/MessageText. */
export const plainText = (text: string) =>
  text
    .replace(
      /\[sticker:([0-9a-f]{2,6}(?:_[0-9a-f]{2,6})*)\]/g,
      (_, code: string) =>
        `${String.fromCodePoint(...code.split('_').map((hex) => parseInt(hex, 16)))} Стикер`,
    )
    .replace(/\[sticker:[^:\]]+:([^\]]+)\]/g, 'Стикер: $1')
    .replace(/\[sticker:[^\]]+\]/g, 'Стикер')
    .replace(/\[gif:[^:\]]+:([^\]]+)\]/g, 'GIF: $1')
    .replace(/\[gif:[^\]]+\]/g, 'GIF')
    .replace(/\|\|(.+?)\|\|/gs, '•••')
    .replace(/\*\*|__|~~|```|`/g, '')
    .replace(/^> /gm, '');
export function previewText(info: MessageInfo | undefined, mode: Preview): NotificationText {
  if (!info || mode === 'none') return generic;
  const group = info.kind === 'group';
  const title = info.kind === 'saved' ? 'Напоминание' : group ? info.title : info.sender;
  if (mode === 'sender')
    return { title, body: group ? `${info.sender}: новое сообщение` : 'Новое сообщение' };
  const content = plainText(info.body).trim() || attachmentWord(info);
  const text = content.length > 180 ? `${content.slice(0, 177)}…` : content;
  return { title, body: group ? `${info.sender}: ${text}` : text };
}
/**
 * SQL: does message `m` (a table alias) mention user `recipient`? @login or an owner's @все,
 * filtered by who the recipient lets mention them. The rule lives in the database (migration 009).
 */
export const mentionsSQL = (m: string, recipient: string) =>
  `mentions_user(${m}.body,${m}.mention_all,${m}.sender_id,${recipient})`;
/** SQL: unread messages for the app icon (chats with sound) and in this chat (the notification). */
const unreadSQL = `(SELECT count(*)::int FROM messages x JOIN members mm ON mm.chat_id=x.chat_id AND mm.user_id=recipient.id
    WHERE NOT mm.muted AND x.created_at>mm.read_at AND x.sender_id IS DISTINCT FROM recipient.id
    AND x.deleted_at IS NULL AND (x.expires_at IS NULL OR x.expires_at>now())) AS badge,
  (SELECT count(*)::int FROM messages x WHERE x.chat_id=m.chat_id AND x.created_at>member.read_at
    AND x.sender_id IS DISTINCT FROM recipient.id AND x.deleted_at IS NULL
    AND (x.expires_at IS NULL OR x.expires_at>now())) AS chat_unread`;
/** SQL: a recipient's quiet hours, or this chat set to no sound: notify without a sound. */
export const quietSQL = `(member.sound='silent' OR in_quiet_hours(recipient.quiet_from,recipient.quiet_to,recipient.time_zone))`;
export const messageInfoSQL = `SELECT m.body,f.name AS file_name,f.mime,c.kind,c.title,COALESCE(u.name,'Неля') AS sender
  FROM messages m JOIN chats c ON c.id=m.chat_id LEFT JOIN users u ON u.id=m.sender_id
  LEFT JOIN files f ON f.id=m.file_id WHERE m.id=$1`;

export function pushPayload(
  tokens: string[],
  chatId: string,
  messageId: string,
  text: NotificationText = generic,
  actions = false,
  quiet = false,
  unread = 0,
): MulticastMessage {
  // Builds that draw their own notification (Reply / Mark as read) get a data-only message:
  // with a `notification` field the system would draw it in the background and skip the app.
  // Older builds keep the notification form. `quiet`: shown without sound or vibration.
  if (actions)
    return {
      tokens,
      data: {
        chatId,
        messageId,
        actions: '1',
        quiet: quiet ? '1' : '0',
        unread: String(unread),
        ...text,
      },
      android: { priority: 'high', ttl: 86400_000 },
    };
  return {
    tokens,
    // What the text says follows the recipient's preview setting; 'private' visibility keeps
    // it off a locked screen.
    notification: text,
    data: { chatId, messageId },
    android: {
      priority: 'high',
      ttl: 86400_000,
      notification: {
        channelId: 'messages',
        icon: 'ic_notification',
        tag: chatId,
        visibility: 'private',
      },
    },
  };
}

export function browserPushPayload(
  chatId: string,
  messageId: string,
  text: NotificationText = generic,
  quiet = false,
  badge?: number,
) {
  return JSON.stringify({
    ...text,
    chatId,
    messageId,
    ...(quiet ? { silent: true } : {}),
    ...(badge !== undefined ? { badge } : {}),
  });
}

export function invalidPushToken(code?: string) {
  return (
    code === 'messaging/registration-token-not-registered' ||
    code === 'messaging/invalid-registration-token'
  );
}

export type PushTransports = {
  android?: (payload: MulticastMessage) => Promise<BatchResponse>;
  browser?: (subscription: PushSubscription, payload: string) => Promise<unknown>;
};

const destination = (value: string) => createHash('sha256').update(value).digest('hex');
async function markDelivered(
  db: PoolClient,
  messageId: string,
  transport: string,
  address: string,
) {
  await db.query(
    'INSERT INTO push_deliveries(message_id,transport,destination) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
    [messageId, transport, destination(address)],
  );
}

async function deliveryTransaction<T>(
  pool: Pool,
  messageId: string,
  send: (db: PoolClient) => Promise<T>,
) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    // A concurrent message/chat deletion can wait on the claimed job. Do not
    // hold the claim indefinitely while waiting for that deletion's chat lock.
    await db.query("SET LOCAL lock_timeout='2s'");
    await db.query(
      'SELECT c.id FROM chats c JOIN messages m ON m.chat_id=c.id WHERE m.id=$1 FOR SHARE OF c',
      [messageId],
    );
    const result = await send(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

// Saved Messages get a job only for a due reminder, which goes to the author themself.
const recipients = (table: 'push_devices' | 'web_push_subscriptions') => `FROM messages m
  JOIN chats chat ON chat.id=m.chat_id
  JOIN members member ON member.chat_id=m.chat_id AND (member.user_id<>m.sender_id OR chat.kind='saved') AND member.read_at<m.created_at
  JOIN ${table} d ON d.user_id=member.user_id
  JOIN users recipient ON recipient.id=d.user_id AND NOT recipient.blocked
  JOIN sessions s ON s.token=d.session_token AND s.user_id=d.user_id AND s.expires_at>now()
  WHERE m.id=$1 AND (
    chat.kind='saved'
    -- A mention gets through a muted chat and "no group notifications".
    OR (chat.kind='group' AND ${mentionsSQL('m', 'recipient.id')})
    OR (NOT member.muted AND CASE chat.kind WHEN 'direct' THEN recipient.notify_direct WHEN 'group' THEN recipient.notify_groups ELSE true END))`;

// Tests replace only the network transports. Each job is claimed by one replica;
// successful destinations are persisted so a retry does not resend the whole batch.
export async function deliverPushJob(pool: Pool, transports: PushTransports) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows: jobs } = await db.query(
      'SELECT * FROM push_jobs WHERE available_at<=now() ORDER BY available_at LIMIT 1 FOR NO KEY UPDATE SKIP LOCKED',
    );
    const job = jobs[0];
    if (!job) {
      await db.query('COMMIT');
      return false;
    }
    const { rows: receipts } = await db.query(
      'SELECT transport,destination FROM push_deliveries WHERE message_id=$1',
      [job.message_id],
    );
    const delivered = new Set(receipts.map((row) => `${row.transport}:${row.destination}`));
    const {
      rows: [info],
    } = await db.query(messageInfoSQL, [job.message_id]);
    let retry = false;
    if (transports.android) {
      const { rows } = await db.query(`SELECT d.token ${recipients('push_devices')}`, [
        job.message_id,
      ]);
      const pending = rows.filter((row) => !delivered.has(`android:${destination(row.token)}`));
      for (let i = 0; i < pending.length; i += 100) {
        await deliveryTransaction(pool, job.message_id, async (recipientDb) => {
          const { rows: devices } = await recipientDb.query(
            `SELECT d.token,d.native_actions,m.chat_id,recipient.notify_preview,${quietSQL} AS quiet,${unreadSQL} ${recipients('push_devices')} AND d.token=ANY($2::text[]) FOR SHARE OF d,recipient,s`,
            [job.message_id, pending.slice(i, i + 100).map((device) => device.token)],
          );
          if (!devices.length) return;
          // One multicast per preview setting, payload form and sound: everyone in it gets the
          // same message.
          const groups = new Map<string, typeof devices>();
          for (const device of devices) {
            const key = `${device.notify_preview ?? 'none'}|${Boolean(device.native_actions)}|${Boolean(device.quiet)}|${device.chat_unread}`;
            groups.set(key, [...(groups.get(key) ?? []), device]);
          }
          for (const group of groups.values()) {
            const mode = (group[0].notify_preview ?? 'none') as 'full' | 'sender' | 'none';
            const actions = Boolean(group[0].native_actions);
            const quiet = Boolean(group[0].quiet);
            // Older builds cannot show a notification without the channel's sound: during quiet
            // hours or in a chat set to no sound they get nothing, rather than a ring.
            if (quiet && !actions) {
              for (const device of group)
                await markDelivered(recipientDb, job.message_id, 'android', device.token);
              continue;
            }
            let result: BatchResponse;
            try {
              result = await transports.android!(
                pushPayload(
                  group.map((device) => device.token),
                  group[0].chat_id,
                  job.message_id,
                  previewText(info, mode),
                  actions,
                  quiet,
                  group[0].chat_unread,
                ),
              );
            } catch {
              retry = true;
              continue;
            }
            for (let n = 0; n < group.length; n++) {
              const response = result.responses[n];
              if (invalidPushToken(response?.error?.code))
                await recipientDb.query('DELETE FROM push_devices WHERE token=$1', [
                  group[n].token,
                ]);
              else if (response?.success)
                await markDelivered(recipientDb, job.message_id, 'android', group[n].token);
              else retry = true;
            }
          }
        });
      }
    }
    if (transports.browser) {
      await db.query('DELETE FROM web_push_subscriptions WHERE expires_at<=now()');
      const { rows } = await db.query(
        `SELECT d.endpoint ${recipients('web_push_subscriptions')} AND (d.expires_at IS NULL OR d.expires_at>now())`,
        [job.message_id],
      );
      const pending = rows.filter((row) => !delivered.has(`browser:${destination(row.endpoint)}`));
      // Only eight network calls/connections at once. Chat/session locks live for
      // one delivery, not for the whole fanout, so queued mutations get a turn.
      for (let i = 0; i < pending.length; i += 8) {
        const results = await Promise.allSettled(
          pending.slice(i, i + 8).map((candidate) =>
            deliveryTransaction(pool, job.message_id, async (recipientDb) => {
              const { rows: subscriptions } = await recipientDb.query(
                `SELECT d.endpoint,d.p256dh,d.auth,m.chat_id,recipient.notify_preview,${quietSQL} AS quiet,${unreadSQL} ${recipients('web_push_subscriptions')}
               AND d.endpoint=$2 AND (d.expires_at IS NULL OR d.expires_at>now()) FOR SHARE OF d,recipient,s`,
                [job.message_id, candidate.endpoint],
              );
              const subscription = subscriptions[0];
              if (!subscription) return;
              // Old/imported rows must not become arbitrary outbound requests.
              const parsed = webPushSubscriptionSchema.safeParse({
                endpoint: subscription.endpoint,
                keys: { p256dh: subscription.p256dh, auth: subscription.auth },
              });
              if (!parsed.success) {
                await recipientDb.query('DELETE FROM web_push_subscriptions WHERE endpoint=$1', [
                  subscription.endpoint,
                ]);
                return;
              }
              try {
                await transports.browser!(
                  parsed.data,
                  browserPushPayload(
                    subscription.chat_id,
                    job.message_id,
                    previewText(info, subscription.notify_preview ?? 'none'),
                    Boolean(subscription.quiet),
                    subscription.badge,
                  ),
                );
              } catch (error) {
                const status = (error as { statusCode?: number })?.statusCode;
                if (status === 404 || status === 410)
                  await recipientDb.query('DELETE FROM web_push_subscriptions WHERE endpoint=$1', [
                    subscription.endpoint,
                  ]);
                else retry = true;
                return;
              }
              await markDelivered(recipientDb, job.message_id, 'browser', subscription.endpoint);
            }),
          ),
        );
        const rejected = results.find((result) => result.status === 'rejected');
        if (rejected?.status === 'rejected') throw rejected.reason;
      }
    }
    if (!retry || job.attempts >= 4) {
      await db.query('DELETE FROM push_jobs WHERE message_id=$1', [job.message_id]);
      if (retry) console.error('Push delivery failed after 5 attempts');
    } else {
      await db.query(
        "UPDATE push_jobs SET attempts=attempts+1,available_at=now()+($2 * interval '1 second') WHERE message_id=$1",
        [job.message_id, 10 * 2 ** job.attempts],
      );
    }
    await db.query('COMMIT');
    return true;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

export function startPushWorker(pool: Pool) {
  if (!anyPushEnabled) return () => {};
  if (pushEnabled && !getApps().length)
    initializeApp({ credential: applicationDefault(), httpAgent: undefined });
  const transports: PushTransports = {
    ...(pushEnabled
      ? { android: (payload: MulticastMessage) => getMessaging().sendEachForMulticast(payload) }
      : {}),
    ...(webPushConfig
      ? {
          browser: (subscription: PushSubscription, payload: string) =>
            webPush.sendNotification(subscription, payload, {
              vapidDetails: webPushConfig,
              TTL: 86400,
              urgency: 'high',
              timeout: 10000,
            }),
        }
      : {}),
  };
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  async function tick() {
    let more = false;
    try {
      // Drain ready jobs promptly without a fixed three-second gap per message.
      for (let n = 0; n < 10 && !stopped; n++) {
        more = await deliverPushJob(pool, transports);
        if (!more) break;
      }
    } catch {
      // Never log endpoint URLs, tokens or push provider responses.
      console.error('Push queue unavailable');
      more = false;
    } finally {
      if (!stopped) {
        timer = setTimeout(() => void tick(), more ? 0 : 3000);
        timer.unref();
      }
    }
  }
  timer = setTimeout(() => void tick(), 0);
  timer.unref();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
