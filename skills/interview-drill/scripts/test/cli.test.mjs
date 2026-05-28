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

import { queryIndex } from '../rag_query.mjs';
import { mkdtempSync as mkd3, writeFileSync as wf3 } from 'node:fs';
import { tmpdir as tmp3 } from 'node:os';
import { join as j3 } from 'node:path';

test('queryIndex returns top-K chunks ranked by similarity, no embeddings leaked', async () => {
  const dir = mkd3(j3(tmp3(), 'vec-'));
  const vectors = j3(dir, 'vectors.json');
  wf3(vectors, JSON.stringify({
    items: [
      { id: 'design#0', file: 'd.md', heading: 'Design', text: 'design systems', embedding: [1, 0, 0] },
      { id: 'cook#0', file: 'c.md', heading: 'Cooking', text: 'cooking pasta', embedding: [0, 1, 0] }
    ],
    source_hashes: {}
  }));
  const fakeEmbed = async () => [[0.9, 0.1, 0]];
  const hits = await queryIndex({ vectorsPath: vectors, query: 'design work', k: 1, embedFn: fakeEmbed });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'design#0');
  assert.ok(!('embedding' in hits[0]));
});

import { scoreAnswer } from '../score_answer.mjs';

test('scoreAnswer validates and returns the structured score', async () => {
  const fakeChat = async () => ({
    score: 4,
    rephrases: [{ original: 'I did design', improved: 'I led the end-to-end design' }],
    model_answer: 'I led the NextHealth dashboard redesign...',
    weak_vocab: ['stakeholder alignment']
  });
  const out = await scoreAnswer({ question: 'Q', transcript: 'A', context: 'C', chatFn: fakeChat });
  assert.equal(out.score, 4);
  assert.equal(out.weak_vocab[0], 'stakeholder alignment');
});

test('scoreAnswer throws on a malformed model response', async () => {
  const badChat = async () => ({ score: 99, rephrases: 'no', model_answer: '', weak_vocab: 'no' });
  await assert.rejects(() => scoreAnswer({ question: 'Q', transcript: 'A', context: 'C', chatFn: badChat }), /invalid score/);
});

import { execFileSync as ef4 } from 'node:child_process';
import { mkdtempSync as mkd4, writeFileSync as wf4, readFileSync as rf4 } from 'node:fs';
import { tmpdir as tmp4 } from 'node:os';
import { join as j4 } from 'node:path';

test('log_session.mjs appends one JSON line and fills id/ts when missing', () => {
  const dir = mkd4(j4(tmp4(), 'log-'));
  const session = j4(dir, 'session.json');
  const log = j4(dir, 'sessions.jsonl');
  wf4(session, JSON.stringify({ format: 'portfolio', question_text: 'Q', answer_transcript: 'A', score: 4, weak_vocab: ['x'] }));
  wf4(log, '');
  ef4('node', ['log_session.mjs', '--in', session, '--log', log], { encoding: 'utf8' });
  const lines = rf4(log, 'utf8').trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.format, 'portfolio');
  assert.equal(rec.score, 4);
  assert.ok(rec.id && rec.ts, 'id and ts auto-filled');
});

test('rag_index.mjs CLI guard fires; missing args -> usage error', () => {
  let err;
  try { execFileSync('node', ['rag_index.mjs'], { encoding: 'utf8' }); } catch (e) { err = e; }
  assert.ok(err, 'should exit non-zero');
  assert.match(String(err.stderr), /Usage: rag_index/);
});

test('rag_query.mjs CLI guard fires; missing args -> usage error', () => {
  let err;
  try { execFileSync('node', ['rag_query.mjs'], { encoding: 'utf8' }); } catch (e) { err = e; }
  assert.ok(err, 'should exit non-zero');
  assert.match(String(err.stderr), /Usage: rag_query/);
});

test('score_answer.mjs CLI guard fires; missing args -> usage error', () => {
  let err;
  try { execFileSync('node', ['score_answer.mjs'], { encoding: 'utf8' }); } catch (e) { err = e; }
  assert.ok(err, 'should exit non-zero');
  assert.match(String(err.stderr), /Usage: score_answer/);
});
