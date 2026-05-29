import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyInitData } from '../auth.mjs';

const BOT = '123456:TEST_TOKEN';

// Build a correctly-signed initData string for a given payload + token.
function signInitData(fields, token = BOT) {
  const params = new URLSearchParams(fields);
  const pairs = [...params.entries()].filter(([k]) => k !== 'hash')
    .map(([k, v]) => `${k}=${v}`).sort();
  const dcs = pairs.join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

test('accepts a validly signed, fresh initData and returns the user', () => {
  const now = Math.floor(Date.now() / 1000);
  const raw = signInitData({ auth_date: String(now), user: JSON.stringify({ id: 42, first_name: 'Nick' }) });
  const { user } = verifyInitData(raw, BOT, 86400);
  assert.equal(user.id, 42);
});

test('rejects a tampered hash', () => {
  const now = Math.floor(Date.now() / 1000);
  let raw = signInitData({ auth_date: String(now), user: JSON.stringify({ id: 42 }) });
  raw = raw.replace(/hash=[0-9a-f]+/, 'hash=deadbeef');
  assert.throws(() => verifyInitData(raw, BOT, 86400), /invalid hash/i);
});

test('rejects a tampered field (hash no longer matches)', () => {
  const now = Math.floor(Date.now() / 1000);
  const raw = signInitData({ auth_date: String(now), user: JSON.stringify({ id: 42, first_name: 'Nick' }) })
    .replace('first_name', 'x'); // mutate payload, keep old hash
  assert.throws(() => verifyInitData(raw, BOT, 86400), /invalid hash/i);
});

test('rejects stale auth_date', () => {
  const old = Math.floor(Date.now() / 1000) - 100000;
  const raw = signInitData({ auth_date: String(old), user: JSON.stringify({ id: 42 }) });
  assert.throws(() => verifyInitData(raw, BOT, 86400), /expired/i);
});

test('rejects missing hash', () => {
  assert.throws(() => verifyInitData('auth_date=1&user=%7B%7D', BOT, 86400), /missing hash/i);
});
