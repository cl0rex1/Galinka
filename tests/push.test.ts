import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import {
  allowedPushEndpoint,
  browserPushPayload,
  invalidPushToken,
  previewText,
  pushPayload,
  readWebPushConfig,
  webPushSubscriptionSchema,
} from '../server/push.js';
test('Android pushes identify the chat without sending private content', () => {
  const payload = pushPayload(['device'], 'chat-id', 'message-id');
  assert.deepEqual(payload.data, { chatId: 'chat-id', messageId: 'message-id' });
  assert.deepEqual(payload.notification, { title: 'Galinka', body: 'Новое сообщение' });
  assert.equal(payload.android?.notification?.channelId, 'messages');
  assert.equal(payload.android?.notification?.visibility, 'private');
  assert.equal(invalidPushToken('messaging/registration-token-not-registered'), true);
  assert.equal(invalidPushToken('messaging/invalid-registration-token'), true);
  assert.equal(invalidPushToken('messaging/server-unavailable'), false);
});

test('Web Push accepts real provider endpoints and rejects SSRF destinations', () => {
  for (const endpoint of [
    'https://fcm.googleapis.com/fcm/send/a',
    'https://updates.push.services.mozilla.com/wpush/v2/a',
    'https://web.push.apple.com/Qa',
    'https://wns2-db5p.notify.windows.com/w/?token=abc',
  ])
    assert.equal(allowedPushEndpoint(endpoint), true, endpoint);
  for (const endpoint of [
    'http://fcm.googleapis.com/fcm/send/a',
    'https://fcm.googleapis.com:444/send/a',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://169.254.169.254/latest/',
    'https://localhost/',
    'https://example.com/',
    'https://fcm.googleapis.com.evil.test/a',
    'https://fcm.googleapis.com@evil.test/a',
    'https://user:pass@fcm.googleapis.com/a',
    'https://evilpush.apple.com/a',
    'https://web.push.apple.com.evil.test/a',
    'https://fcm.googleapis.com/a#fragment',
    ' https://fcm.googleapis.com/a',
  ])
    assert.equal(allowedPushEndpoint(endpoint), false, endpoint);
});

test('browser subscriptions and VAPID configuration require valid matching curve keys', () => {
  const curve = createECDH('prime256v1');
  curve.generateKeys();
  const publicKey = curve.getPublicKey().toString('base64url');
  const privateKey = curve.getPrivateKey().toString('base64url');
  const subscription = {
    endpoint: 'https://web.push.apple.com/test',
    expirationTime: null,
    keys: { p256dh: publicKey, auth: randomBytes(16).toString('base64url') },
  };
  assert.equal(webPushSubscriptionSchema.safeParse(subscription).success, true);
  assert.equal(
    webPushSubscriptionSchema.safeParse({
      ...subscription,
      keys: { ...subscription.keys, p256dh: Buffer.alloc(65, 4).toString('base64url') },
    }).success,
    false,
  );
  assert.equal(
    webPushSubscriptionSchema.safeParse({
      ...subscription,
      keys: { ...subscription.keys, auth: 'invalid' },
    }).success,
    false,
  );
  const config = {
    WEB_PUSH_PUBLIC_KEY: publicKey,
    WEB_PUSH_PRIVATE_KEY: privateKey,
    WEB_PUSH_SUBJECT: 'https://mess.quiby.me',
  };
  assert.deepEqual(readWebPushConfig(config), {
    publicKey,
    privateKey,
    subject: 'https://mess.quiby.me',
  });
  assert.equal(
    readWebPushConfig({ ...config, WEB_PUSH_PRIVATE_KEY: randomBytes(32).toString('base64url') }),
    null,
  );
  assert.equal(readWebPushConfig({ ...config, WEB_PUSH_SUBJECT: 'http://localhost' }), null);
  assert.equal(readWebPushConfig({}), null);
  assert.deepEqual(JSON.parse(browserPushPayload('chat', 'message')), {
    title: 'Galinka',
    body: 'Новое сообщение',
    chatId: 'chat',
    messageId: 'message',
  });
});

test('notification text follows each recipient: author and text, author only, or nothing', () => {
  const group = {
    body: 'Буду к восьми',
    file_name: null,
    mime: null,
    kind: 'group',
    title: 'Свои люди',
    sender: 'Макс',
  };
  assert.deepEqual(previewText(group, 'full'), { title: 'Свои люди', body: 'Макс: Буду к восьми' });
  assert.deepEqual(previewText(group, 'sender'), {
    title: 'Свои люди',
    body: 'Макс: новое сообщение',
  });
  assert.deepEqual(previewText(group, 'none'), { title: 'Galinka', body: 'Новое сообщение' });
  const photo = { ...group, kind: 'direct', body: '', file_name: 'a.jpg', mime: 'image/jpeg' };
  assert.deepEqual(previewText(photo, 'full'), { title: 'Макс', body: 'Фотография' });
  const long = previewText({ ...group, body: 'я'.repeat(400) }, 'full').body;
  assert.ok(long.length < 200 && long.endsWith('…'));
  assert.deepEqual(previewText(undefined, 'full'), { title: 'Galinka', body: 'Новое сообщение' });
});
