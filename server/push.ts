import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getMessaging, type MulticastMessage } from 'firebase-admin/messaging';
import type { Pool } from 'pg';

export const pushEnabled = process.env.PUSH_ENABLED === 'true';
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
export function invalidPushToken(code?: string) {
  return (
    code === 'messaging/registration-token-not-registered' ||
    code === 'messaging/invalid-registration-token'
  );
}
export function startPushWorker(pool: Pool) {
  if (!pushEnabled) return () => {};
  if (!getApps().length) initializeApp({ credential: applicationDefault(), httpAgent: undefined });
  let running = false;
  async function deliver() {
    if (running) return;
    running = true;
    const db = await pool.connect().catch(() => null);
    if (!db) {
      running = false;
      return;
    }
    try {
      await db.query('BEGIN');
      const { rows: jobs } = await db.query(
        'SELECT * FROM push_jobs WHERE available_at<=now() ORDER BY available_at LIMIT 1 FOR UPDATE SKIP LOCKED',
      );
      const job = jobs[0];
      if (!job) {
        await db.query('COMMIT');
        return;
      }
      try {
        const { rows } = await db.query(
          `SELECT DISTINCT d.token, m.chat_id FROM messages m
          JOIN members member ON member.chat_id=m.chat_id AND member.user_id<>m.sender_id AND member.read_at<m.created_at
          JOIN push_devices d ON d.user_id=member.user_id
          JOIN sessions s ON s.token=d.session_token AND s.expires_at>now()
          WHERE m.id=$1`,
          [job.message_id],
        );
        for (let i = 0; i < rows.length; i += 500) {
          const devices = rows.slice(i, i + 500);
          const result = await getMessaging().sendEachForMulticast(
            pushPayload(
              devices.map((d) => d.token),
              devices[0].chat_id,
              job.message_id,
            ),
          );
          let retry = false;
          for (let n = 0; n < result.responses.length; n++) {
            const response = result.responses[n];
            if (invalidPushToken(response.error?.code))
              await db.query('DELETE FROM push_devices WHERE token=$1', [devices[n].token]);
            else if (!response.success) retry = true;
          }
          if (retry) throw Error('FCM delivery incomplete');
        }
        await db.query('DELETE FROM push_jobs WHERE message_id=$1', [job.message_id]);
      } catch {
        // ponytail: at-least-once batches can repeat after a transient failure; Android tag groups by chat.
        if (job.attempts >= 4) {
          await db.query('DELETE FROM push_jobs WHERE message_id=$1', [job.message_id]);
          console.error('Push delivery failed after 5 attempts');
        } else
          await db.query(
            "UPDATE push_jobs SET attempts=attempts+1, available_at=now()+($2 * interval '1 second') WHERE message_id=$1",
            [job.message_id, 10 * 2 ** job.attempts],
          );
      }
      await db.query('COMMIT');
    } catch {
      await db.query('ROLLBACK').catch(() => {});
      console.error('Push queue unavailable');
    } finally {
      db.release();
      running = false;
    }
  }
  const interval = setInterval(() => {
    void deliver();
  }, 3000);
  interval.unref();
  return () => clearInterval(interval);
}
