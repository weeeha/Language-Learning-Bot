import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, weightedPick, pickDrill } from '../lib.mjs';
import { chunkMarkdown, contentHash } from '../lib.mjs';
import { cosine, topK } from '../lib.mjs';
import { buildScorePrompt, validateScore, SCORE_SCHEMA } from '../lib.mjs';
import { _requireKey } from '../openai.mjs';

test('mulberry32 is deterministic and in [0,1)', () => {
  assert.equal(mulberry32(1)(), mulberry32(1)());
  const r = mulberry32(5)();
  assert.ok(r >= 0 && r < 1);
});

test('weightedPick favors heavier weights', () => {
  const rng = mulberry32(7);
  const counts = { a: 0, b: 0 };
  for (let i = 0; i < 10000; i++) counts[weightedPick({ a: 90, b: 10 }, rng)]++;
  assert.ok(counts.a > counts.b * 5, JSON.stringify(counts));
});

test('pickDrill returns a known format', () => {
  const settings = { format_weights: { portfolio: 40, behavioral: 25, critique: 15, whiteboard: 10, hiring_manager: 10 } };
  const { format } = pickDrill({ settings, sessions: [], rng: mulberry32(42) });
  assert.ok(Object.keys(settings.format_weights).includes(format));
});

test('pickDrill avoids repeating the immediately previous format when possible', () => {
  const settings = { format_weights: { portfolio: 100, behavioral: 1 } };
  // portfolio is overwhelmingly weighted; with a prior portfolio session, anti-repeat should still allow behavioral sometimes
  const sessions = [{ format: 'portfolio' }];
  const got = new Set();
  for (let s = 0; s < 50; s++) got.add(pickDrill({ settings, sessions, rng: mulberry32(s) }).format);
  assert.ok(got.has('behavioral'), 'anti-repeat should surface the alternative at least once');
});

test('chunkMarkdown splits on headings and keeps heading text', () => {
  const md = '# A\nalpha body\n\n## B\nbeta body';
  const chunks = chunkMarkdown(md);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].heading, 'A');
  assert.match(chunks[0].text, /alpha/);
  assert.equal(chunks[1].heading, 'B');
});

test('chunkMarkdown splits oversized sections on blank lines', () => {
  const big = Array.from({ length: 10 }, (_, i) => `para ${i} ` + 'x'.repeat(300)).join('\n\n');
  const chunks = chunkMarkdown('# Big\n' + big, { maxChars: 800 });
  assert.ok(chunks.length > 1, 'should split a long section');
  assert.ok(chunks.every(c => c.heading === 'Big'));
});

test('contentHash is stable and sensitive', () => {
  assert.equal(contentHash('x'), contentHash('x'));
  assert.notEqual(contentHash('x'), contentHash('y'));
});

test('cosine: identical > orthogonal', () => {
  assert.ok(cosine([1, 0], [1, 0]) > cosine([1, 0], [0, 1]));
  assert.equal(cosine([0, 0], [1, 1]), 0); // zero vector guard
});

test('topK ranks nearest first and strips embeddings', () => {
  const vectors = [
    { id: 'near', embedding: [1, 0, 0], text: 'n' },
    { id: 'far', embedding: [0, 1, 0], text: 'f' }
  ];
  const hits = topK([0.9, 0.1, 0], vectors, 2);
  assert.equal(hits[0].id, 'near');
  assert.equal(hits.length, 2);
  assert.ok('score' in hits[0]);
});

test('SCORE_SCHEMA is a strict json_schema with required fields', () => {
  assert.equal(SCORE_SCHEMA.strict, true);
  assert.deepEqual(SCORE_SCHEMA.schema.required.sort(), ['model_answer', 'rephrases', 'score', 'weak_vocab']);
});

test('buildScorePrompt embeds question/transcript/context; deep flag changes system', () => {
  const m = buildScorePrompt({ question: 'QQ', transcript: 'TT', context: 'CC' });
  assert.equal(m.length, 2);
  assert.equal(m[0].role, 'system');
  assert.match(m[1].content, /QQ/);
  assert.match(m[1].content, /TT/);
  assert.match(m[1].content, /CC/);
  assert.match(buildScorePrompt({ question: 'q', transcript: 't', context: 'c', deep: true })[0].content, /DEEP/);
});

test('validateScore: accepts valid, rejects invalid', () => {
  const good = { score: 4, rephrases: [{ original: 'a', improved: 'b' }], model_answer: 'x', weak_vocab: ['y'] };
  assert.deepEqual(validateScore(good), []);
  const bad = { score: 9, rephrases: 'no', model_answer: '', weak_vocab: 'no' };
  assert.ok(validateScore(bad).length >= 3);
});

// Intentional: save/delete/restore of OPENAI_API_KEY is safe here because these tests run in a single process with no concurrency touching that var.
test('openai wrapper throws a clear error when OPENAI_API_KEY is missing', () => {
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.throws(() => _requireKey(), /OPENAI_API_KEY/);
  } finally {
    if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
  }
});

test('weightedPick throws when no positive weights', () => {
  assert.throws(() => weightedPick({ a: 0, b: 0 }, mulberry32(1)), /no positive-weight/);
});
