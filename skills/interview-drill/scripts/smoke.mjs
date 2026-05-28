#!/usr/bin/env node
// Exercises pick -> retrieve -> score with fakes. Exits non-zero on failure.
import assert from 'node:assert/strict';
import { mulberry32, pickDrill, topK, buildScorePrompt, validateScore } from './lib.mjs';
import { scoreAnswer } from './score_answer.mjs';

const settings = { format_weights: { portfolio: 40, behavioral: 25, critique: 15, whiteboard: 10, hiring_manager: 10 } };
const { format } = pickDrill({ settings, sessions: [], rng: mulberry32(42) });
assert.ok(Object.keys(settings.format_weights).includes(format), 'pick returns a known format');

const vectors = [
  { id: 'ds', text: 'design systems at scale', embedding: [1, 0, 0] },
  { id: 'cook', text: 'weekend cooking', embedding: [0, 1, 0] }
];
const hits = topK([0.9, 0.1, 0], vectors, 1);
assert.equal(hits[0].id, 'ds', 'RAG ranks the design chunk first');

assert.equal(buildScorePrompt({ question: 'Q', transcript: 'A', context: 'C' }).length, 2);

const fakeChat = async () => ({
  score: 4,
  rephrases: [{ original: 'I did the design', improved: 'I led the end-to-end design' }],
  model_answer: 'I led the redesign of the NextHealth biometrics dashboard, improving task completion.',
  weak_vocab: ['information hierarchy']
});
const score = await scoreAnswer({ question: 'Tell me about a project', transcript: 'I did the design', context: hits[0].text, chatFn: fakeChat });
assert.deepEqual(validateScore(score), [], 'score validates');

console.log('SMOKE OK:', { format, topHit: hits[0].id, score: score.score });
