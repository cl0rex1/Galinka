import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, digest, readCookie } from '../server/security.js';
import { nelyaReply } from '../server/nelya.js';
test('password hashing uses independent salts and rejects a wrong password', async () => {
  const a = await hashPassword('a sufficiently long password');
  const b = await hashPassword('a sufficiently long password');
  assert.notEqual(a, b);
  assert.ok(await verifyPassword('a sufficiently long password', a));
  assert.equal(await verifyPassword('wrong password', a), false);
  assert.equal(digest('secret').length, 64);
  assert.equal(readCookie('other=x; galinka=abc123; mode=light'), 'abc123');
});
test('Nelya only handles explicit mentions and validates choices', () => {
  assert.equal(nelyaReply('обычный разговор'), null);
  assert.equal(nelyaReply('@неляшка монетка'), null);
  assert.match(nelyaReply('@Неля помощь')!, /без ИИ/);
  assert.match(nelyaReply('@неля монетка')!, /орёл|решка/);
  assert.match(nelyaReply('@неля выбери только один')!, /пицца/);
  assert.match(nelyaReply('@неля выбери чай | кофе')!, /^Я выбираю: (чай|кофе)$/);
  assert.ok(nelyaReply('@неля идея'));
});
