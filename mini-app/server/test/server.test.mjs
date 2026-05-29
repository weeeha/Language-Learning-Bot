import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';

const BOT = '123456:TEST_TOKEN';
function sign(fields) {
  const p = new URLSearchParams(fields);
  const dcs = [...p.entries()].filter(([k]) => k !== 'hash').map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT).digest();
  p.set('hash', createHmac('sha256', secret).update(dcs).digest('hex'));
  return p.toString();
}
function dir() {
  const d = mkdtempSync(join(tmpdir(), 'srv-')); mkdirSync(join(d, 'sources'));
  writeFileSync(join(d, 'sessions.jsonl'), JSON.stringify({ id: 7, format: 'portfolio', score: 5 }) + '\n');
  writeFileSync(join(d, 'settings.json'), JSON.stringify({ per_day_target: 1 }));
  return d;
}

test('GET /api/sessions without auth -> 401', async () => {
  const app = createApp({ interviewDir: dir(), botToken: BOT, staticDir: null });
  const res = await app.request('/api/sessions');
  assert.equal(res.status, 401);
});

test('GET /api/sessions with valid initData -> 200 + data', async () => {
  const app = createApp({ interviewDir: dir(), botToken: BOT, staticDir: null });
  const raw = sign({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 42 }) });
  const res = await app.request('/api/sessions', { headers: { Authorization: `tma ${raw}` } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body[0].id, 7);
});
