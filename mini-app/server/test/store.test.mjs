import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeStore } from '../store.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'iv-'));
  mkdirSync(join(dir, 'sources'));
  writeFileSync(join(dir, 'sessions.jsonl'),
    JSON.stringify({ id: 1, format: 'portfolio', score: 3 }) + '\n' +
    JSON.stringify({ id: 2, format: 'behavioral', score: 4 }) + '\n');
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ per_day_target: 1 }));
  writeFileSync(join(dir, 'sources', 'a.md'), '# A\nbody');
  return makeStore(dir);
}

test('getSessions returns newest-first', () => {
  const s = fixture();
  const out = s.getSessions();
  assert.equal(out[0].id, 2);
  assert.equal(out.length, 2);
});

test('settings round-trip', () => {
  const s = fixture();
  s.putSettings({ per_day_target: 3, nudge_time: '09:00' });
  assert.equal(s.getSettings().per_day_target, 3);
});

test('list + read + write sources', () => {
  const s = fixture();
  assert.deepEqual(s.listSources(), ['a.md']);
  assert.match(s.readSource('a.md'), /body/);
  s.writeSource('a.md', '# A\nedited');
  assert.match(s.readSource('a.md'), /edited/);
});

test('rejects path traversal in source names', () => {
  const s = fixture();
  assert.throws(() => s.readSource('../../etc/passwd'), /invalid source/i);
  assert.throws(() => s.writeSource('../x.md', 'y'), /invalid source/i);
});
