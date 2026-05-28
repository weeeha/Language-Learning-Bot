import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('pick_drill.mjs prints a known format as JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'drill-'));
  const settings = join(dir, 'settings.json');
  const sessions = join(dir, 'sessions.jsonl');
  writeFileSync(settings, JSON.stringify({ format_weights: { portfolio: 40, behavioral: 25, critique: 15, whiteboard: 10, hiring_manager: 10 } }));
  writeFileSync(sessions, '');
  const out = execFileSync('node', ['pick_drill.mjs', '--settings', settings, '--sessions', sessions, '--seed', '42'], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.ok(['portfolio', 'behavioral', 'critique', 'whiteboard', 'hiring_manager'].includes(parsed.format));
});

import { buildIndex } from '../rag_index.mjs';
import { mkdtempSync as mkd2, writeFileSync as wf2 } from 'node:fs';
import { tmpdir as tmp2 } from 'node:os';
import { join as j2 } from 'node:path';

test('buildIndex embeds chunks and reuses unchanged files', async () => {
  const dir = mkd2(j2(tmp2(), 'src-'));
  wf2(j2(dir, 'a.md'), '# A\nalpha');
  wf2(j2(dir, 'b.md'), '# B\nbeta');
  let calls = 0;
  const fakeEmbed = async (texts) => { calls++; return texts.map((t) => [t.length, 1, 0]); };

  const first = await buildIndex({ sourcesDir: dir, embedFn: fakeEmbed });
  assert.equal(first.items.length, 2);
  assert.ok(first.items[0].embedding);
  assert.equal(calls, 1);

  // Re-run with previous index; both files unchanged → no new embed calls.
  const second = await buildIndex({ sourcesDir: dir, prev: first, embedFn: fakeEmbed });
  assert.equal(second.items.length, 2);
  assert.equal(calls, 1, 'unchanged files should not be re-embedded');
});
