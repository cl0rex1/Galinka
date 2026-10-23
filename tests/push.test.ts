import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invalidPushToken, pushPayload } from '../server/push.js';
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
