import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, weightedPick, pickDrill } from '../lib.mjs';

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
