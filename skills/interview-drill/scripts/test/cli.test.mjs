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
