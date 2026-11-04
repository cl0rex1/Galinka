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

export function pushPayload(tokens: string[], chatId: string, messageId: string): MulticastMessage {
  return {
    tokens,
    // Keep private message text off the lock screen and out of the provider payload.
    notification: { title: 'Galinka', body: 'Новое сообщение' },
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

export function browserPushPayload(chatId: string, messageId: string) {
  return JSON.stringify({ title: 'Galinka', body: 'Новое сообщение', chatId, messageId });
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

const recipients = (table: 'push_devices' | 'web_push_subscriptions') => `FROM messages m
  JOIN members member ON member.chat_id=m.chat_id AND member.user_id<>m.sender_id AND member.read_at<m.created_at AND NOT member.muted
  JOIN ${table} d ON d.user_id=member.user_id
  JOIN users recipient ON recipient.id=d.user_id AND NOT recipient.blocked
  JOIN sessions s ON s.token=d.session_token AND s.user_id=d.user_id AND s.expires_at>now()
  WHERE m.id=$1`;

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
    let retry = false;
    if (transports.android) {
      const { rows } = await db.query(`SELECT d.token ${recipients('push_devices')}`, [
        job.message_id,
      ]);
      const pending = rows.filter((row) => !delivered.has(`android:${destination(row.token)}`));
      for (let i = 0; i < pending.length; i += 100) {
        await deliveryTransaction(pool, job.message_id, async (recipientDb) => {
          const { rows: devices } = await recipientDb.query(
            `SELECT d.token,m.chat_id ${recipients('push_devices')} AND d.token=ANY($2::text[]) FOR SHARE OF d,recipient,s`,
            [job.message_id, pending.slice(i, i + 100).map((device) => device.token)],
          );
          if (!devices.length) return;
          let result: BatchResponse;
          try {
            result = await transports.android!(
              pushPayload(
                devices.map((device) => device.token),
                devices[0].chat_id,
                job.message_id,
              ),
            );
          } catch {
            retry = true;
            return;
          }
          for (let n = 0; n < devices.length; n++) {
            const response = result.responses[n];
            if (invalidPushToken(response?.error?.code))
              await recipientDb.query('DELETE FROM push_devices WHERE token=$1', [
                devices[n].token,
              ]);
            else if (response?.success)
              await markDelivered(recipientDb, job.message_id, 'android', devices[n].token);
            else retry = true;
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
                `SELECT d.endpoint,d.p256dh,d.auth,m.chat_id ${recipients('web_push_subscriptions')}
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
                  browserPushPayload(subscription.chat_id, job.message_id),
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
