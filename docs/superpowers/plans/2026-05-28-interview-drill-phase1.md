# Interview-Drill (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `interview-drill` skill to the existing OpenClaw "Coach" agent (`workspace-speaker`) that DMs Nick one personalized design-interview question per weekday on `@Nxspeakingcoachbot`, scores his spoken answer (transcript → rephrases → model answer + TTS → 1–5 score), logs the session, and feeds weak vocab into Coach's existing vocabulary flow.

**Architecture:** OpenClaw skills are `SKILL.md` instruction files; the agent (LLM) orchestrates and runs bundled Node scripts via the `exec` tool. Deterministic work (format sampling, RAG over Nick's bio, structured scoring) lives in tested `.mjs` scripts. Inbound voice is auto-transcribed by OpenClaw before the agent turn, so no STT code is needed. RAG is in-memory cosine over ~10 markdown files (no vector DB). Structured scoring is a direct OpenAI `json_schema` call.

**Tech Stack:** Node ESM, `node:test` (built-in test runner), the `openai` npm package, OpenClaw cron + tts + message tools, git.

**Prerequisites (verify before Task 1):**
- `OPENAI_API_KEY` is present in the environment OpenClaw `exec` runs under (Task 13 verifies; if absent, pass it inline in the cron command's env — never commit it).
- Node ≥ 20 on PATH (`node --version`).
- The repo lives at `/Users/nickv/ClaudeCode Projects/Lanuage Learning Bot` (paths below use `$REPO` for this; quote it — it contains spaces).
- Coach agent id is `speaker`; its workspace is `/Users/nickv/.openclaw/workspace-speaker` (referred to as `$WS`).

**Security rule (applies to every task):** Never `cat`, `echo`, or log `~/.openclaw/openclaw.json` or any API key. Scripts read `process.env.OPENAI_API_KEY` only.

---

## File Structure

Developed in the project repo, symlinked into the Coach workspace so git tracks it and OpenClaw loads it:

```
$REPO/skills/interview-drill/
  SKILL.md                      # agent instructions
  scripts/
    package.json                # type:module, openai dep, test script
    .gitignore                  # node_modules
    lib.mjs                     # pure functions (sampling, chunking, cosine, scoring schema)
    openai.mjs                  # embed() + chatJson() — the only network module
    pick_drill.mjs              # CLI: choose today's format
    rag_index.mjs               # CLI + buildIndex(): embed sources → vectors.json
    rag_query.mjs               # CLI + queryIndex(): top-K chunks for a query
    score_answer.mjs            # CLI + scoreAnswer(): structured 1–5 score
    smoke.mjs                   # end-to-end smoke (fakes, no network)
    test/
      lib.test.mjs              # unit tests for lib.mjs
      cli.test.mjs              # unit tests for buildIndex/queryIndex/scoreAnswer (injected fakes)

# Runtime state (NOT in repo — lives in the workspace):
$WS/interview/
  sources/        # git clone of github.com/weeeha/nicks-bio
  settings.json   # format weights, nudge time, tz
  sessions.jsonl  # append-only session log
  vectors.json    # generated embedding cache
$WS/skills/interview-drill -> $REPO/skills/interview-drill   # symlink
```

---

## Task 1: Scaffold the skill + script project

**Files:**
- Create: `$REPO/skills/interview-drill/scripts/package.json`
- Create: `$REPO/skills/interview-drill/scripts/.gitignore`

- [ ] **Step 1: Create the package.json**

```json
{
  "name": "interview-drill-scripts",
  "private": true,
  "type": "module",
  "version": "0.1.0",
  "scripts": {
    "test": "node --test",
    "smoke": "node smoke.mjs"
  },
  "dependencies": {
    "openai": "^4.67.3"
  }
}
```

- [ ] **Step 2: Create .gitignore**

```
node_modules/
```

- [ ] **Step 3: Install deps**

Run: `cd "$REPO/skills/interview-drill/scripts" && npm install`
Expected: `node_modules/` created, `openai` present, no errors.

- [ ] **Step 4: Verify the test runner works (0 tests)**

Run: `cd "$REPO/skills/interview-drill/scripts" && node --test`
Expected: exits 0 with "tests 0" (no test files yet).

- [ ] **Step 5: Commit**

```bash
cd "$REPO" && git add skills/interview-drill/scripts/package.json skills/interview-drill/scripts/.gitignore && git commit -m "chore: scaffold interview-drill script project"
```

---

## Task 2: Pure sampling functions (`lib.mjs`)

**Files:**
- Create: `$REPO/skills/interview-drill/scripts/lib.mjs`
- Create: `$REPO/skills/interview-drill/scripts/test/lib.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `test/lib.test.mjs`:

```js
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd "$REPO/skills/interview-drill/scripts" && node --test`
Expected: FAIL — `Cannot find module '../lib.mjs'`.

- [ ] **Step 3: Implement the sampling functions**

Create `lib.mjs`:

```js
// Seeded RNG (mulberry32) — deterministic for tests.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Weighted random key selection. weights: { key: number }
export function weightedPick(weights, rng) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [k, w] of entries) if ((r -= w) < 0) return k;
  return entries[entries.length - 1][0];
}

// Choose today's interview format. Anti-repeat: if the pick equals the last
// session's format, re-pick among the remaining formats.
export function pickDrill({ settings, sessions, rng }) {
  const weights = settings.format_weights;
  let format = weightedPick(weights, rng);
  const last = sessions.at(-1)?.format;
  if (last && format === last) {
    const rest = Object.fromEntries(Object.entries(weights).filter(([k]) => k !== format));
    if (Object.keys(rest).length) format = weightedPick(rest, rng);
  }
  return { format };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd "$REPO/skills/interview-drill/scripts" && node --test`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd "$REPO" && git add skills/interview-drill/scripts/lib.mjs skills/interview-drill/scripts/test/lib.test.mjs && git commit -m "feat: seeded weighted format sampling with anti-repeat"
```

---

## Task 3: Markdown chunking + content hashing

**Files:**
- Modify: `$REPO/skills/interview-drill/scripts/lib.mjs` (append)
- Modify: `$REPO/skills/interview-drill/scripts/test/lib.test.mjs` (append)

- [ ] **Step 1: Add failing tests** (append to `test/lib.test.mjs`)

```js
import { chunkMarkdown, contentHash } from '../lib.mjs';

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
```

- [ ] **Step 2: Run tests, verify fail**

Run: `cd "$REPO/skills/interview-drill/scripts" && node --test`
Expected: FAIL — `chunkMarkdown`/`contentHash` not exported.

- [ ] **Step 3: Implement** (append to `lib.mjs`)

```js
import { createHash } from 'node:crypto';

export function contentHash(str) {
  return createHash('sha256').update(str).digest('hex').slice(0, 16);
}

// Split markdown into {heading, text} chunks. New chunk at each ATX heading;
// oversized sections are further split on blank lines to ~maxChars.
export function chunkMarkdown(text, { maxChars = 1500 } = {}) {
  const lines = text.split(/\r?\n/);
  const chunks = [];
  let heading = '';
  let buf = [];
  const flush = () => {
    const body = buf.join('\n').trim();
    if (body) {
      let cur = '';
      for (const para of body.split(/\n{2,}/)) {
        if (cur && (cur + '\n\n' + para).length > maxChars) {
          chunks.push({ heading, text: cur.trim() });
          cur = para;
        } else {
          cur = cur ? cur + '\n\n' + para : para;
        }
      }
      if (cur.trim()) chunks.push({ heading, text: cur.trim() });
    }
    buf = [];
  };
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) { flush(); heading = line.replace(/^#{1,6}\s/, '').trim(); }
    else buf.push(line);
  }
  flush();
  return chunks;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd "$REPO/skills/interview-drill/scripts" && node --test`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
cd "$REPO" && git add skills/interview-drill/scripts/lib.mjs skills/interview-drill/scripts/test/lib.test.mjs && git commit -m "feat: markdown chunking + content hashing for RAG indexing"
```

---

## Task 4: Cosine similarity + top-K

**Files:**
- Modify: `$REPO/skills/interview-drill/scripts/lib.mjs` (append)
- Modify: `$REPO/skills/interview-drill/scripts/test/lib.test.mjs` (append)

- [ ] **Step 1: Add failing tests**

```js
import { cosine, topK } from '../lib.mjs';

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
```

- [ ] **Step 2: Run tests, verify fail**

Run: `cd "$REPO/skills/interview-drill/scripts" && node --test`
Expected: FAIL — `cosine`/`topK` not exported.

- [ ] **Step 3: Implement** (append to `lib.mjs`)

```js
export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// Rank vectors by cosine to queryVec, return top-k WITHOUT the embedding field.
export function topK(queryVec, vectors, k) {
  return vectors
    .map(({ embedding, ...rest }) => ({ ...rest, score: cosine(queryVec, embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd "$REPO/skills/interview-drill/scripts" && node --test`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
cd "$REPO" && git add skills/interview-drill/scripts/lib.mjs skills/interview-drill/scripts/test/lib.test.mjs && git commit -m "feat: cosine similarity + top-K retrieval"
```

---

## Task 5: Scoring schema, prompt, and validation

**Files:**
- Modify: `$REPO/skills/interview-drill/scripts/lib.mjs` (append)
- Modify: `$REPO/skills/interview-drill/scripts/test/lib.test.mjs` (append)

- [ ] **Step 1: Add failing tests**

```js
import { buildScorePrompt, validateScore, SCORE_SCHEMA } from '../lib.mjs';

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
```

- [ ] **Step 2: Run tests, verify fail**

Run: `cd "$REPO/skills/interview-drill/scripts" && node --test`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement** (append to `lib.mjs`)

```js
export const SCORE_SCHEMA = {
  name: 'interview_answer_score',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      score: { type: 'integer', minimum: 1, maximum: 5 },
      rephrases: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { original: { type: 'string' }, improved: { type: 'string' } },
          required: ['original', 'improved']
        }
      },
      model_answer: { type: 'string' },
      weak_vocab: { type: 'array', items: { type: 'string' } }
    },
    required: ['score', 'rephrases', 'model_answer', 'weak_vocab']
  }
};

export function buildScorePrompt({ question, transcript, context, deep = false }) {
  const system = [
    'You are a senior product-design interviewer evaluating a spoken interview answer in English.',
    'The candidate is an advanced non-native English speaker (senior designer). Be precise and kind.',
    deep
      ? 'Provide a DEEP rubric: assess fluency, vocabulary range, structure, and content depth, plus the standard fields.'
      : 'Return a 1-5 score, 2-3 rephrases of the weakest phrasings, a concise native-level model answer, and weak/missed vocabulary.',
    'Rephrases must quote the candidate original phrasing and an improved version.',
    'Ground the model answer in the provided candidate context when relevant.'
  ].join(' ');
  const user = [
    `INTERVIEW QUESTION:\n${question}`,
    `\nCANDIDATE CONTEXT (for grounding the model answer):\n${context || '(none)'}`,
    `\nCANDIDATE SPOKEN ANSWER (transcribed):\n${transcript}`
  ].join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

// Lightweight runtime guard (defense-in-depth on top of strict json_schema).
export function validateScore(obj) {
  const errs = [];
  if (!obj || typeof obj !== 'object') return ['not an object'];
  if (!Number.isInteger(obj.score) || obj.score < 1 || obj.score > 5) errs.push('score must be int 1-5');
  if (!Array.isArray(obj.rephrases)) errs.push('rephrases must be array');
  else obj.rephrases.forEach((r, i) => {
    if (typeof r?.original !== 'string' || typeof r?.improved !== 'string') errs.push(`rephrase ${i} malformed`);
  });
  if (typeof obj.model_answer !== 'string' || !obj.model_answer.trim()) errs.push('model_answer required');
  if (!Array.isArray(obj.weak_vocab)) errs.push('weak_vocab must be array');
  return errs;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd "$REPO/skills/interview-drill/scripts" && node --test`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
cd "$REPO" && git add skills/interview-drill/scripts/lib.mjs skills/interview-drill/scripts/test/lib.test.mjs && git commit -m "feat: scoring json_schema, prompt builder, and validator"
```

---

## Task 6: OpenAI client wrapper (`openai.mjs`)

**Files:**
- Create: `$REPO/skills/interview-drill/scripts/openai.mjs`
- Modify: `$REPO/skills/interview-drill/scripts/test/lib.test.mjs` (append)

- [ ] **Step 1: Add failing test** (no network — only the missing-key guard)

```js
import { _requireKey } from '../openai.mjs';

test('openai wrapper throws a clear error when OPENAI_API_KEY is missing', () => {
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.throws(() => _requireKey(), /OPENAI_API_KEY/);
  } finally {
    if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
  }
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `cd "$REPO/skills/interview-drill/scripts" && node --test`
Expected: FAIL — cannot find `../openai.mjs`.

- [ ] **Step 3: Implement `openai.mjs`**

```js
import OpenAI from 'openai';

// Exported for testing the missing-key path without constructing a client.
export function _requireKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not set in environment');
  return key;
}

function client() {
  return new OpenAI({ apiKey: _requireKey() });
}

export async function embed(texts, model = process.env.INTERVIEW_EMBED_MODEL || 'text-embedding-3-small') {
  const res = await client().embeddings.create({ model, input: texts });
  return res.data.map((d) => d.embedding);
}

export async function chatJson(messages, schema, model = process.env.INTERVIEW_SCORE_MODEL || 'gpt-4o-2024-08-06') {
  const res = await client().chat.completions.create({
    model,
    messages,
    response_format: { type: 'json_schema', json_schema: schema }
  });
  return JSON.parse(res.choices[0].message.content);
}
```

> Note: `INTERVIEW_SCORE_MODEL` defaults to `gpt-4o-2024-08-06` (known to support strict `json_schema`). Set the env var to `gpt-5.4` (or the exact current model id on Nick's account) in Task 13 once confirmed.

- [ ] **Step 4: Run tests, verify pass**

Run: `cd "$REPO/skills/interview-drill/scripts" && node --test`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
cd "$REPO" && git add skills/interview-drill/scripts/openai.mjs skills/interview-drill/scripts/test/lib.test.mjs && git commit -m "feat: OpenAI embed + json_schema chat wrapper (env-keyed)"
```

---

## Task 7: `pick_drill.mjs` CLI

**Files:**
- Create: `$REPO/skills/interview-drill/scripts/pick_drill.mjs`
- Create: `$REPO/skills/interview-drill/scripts/test/cli.test.mjs`

- [ ] **Step 1: Write failing test** (spawns the CLI against fixtures)

Create `test/cli.test.mjs`:

```js
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
```

- [ ] **Step 2: Run tests, verify fail**

Run: `cd "$REPO/skills/interview-drill/scripts" && node --test`
Expected: FAIL — `pick_drill.mjs` does not exist.

- [ ] **Step 3: Implement `pick_drill.mjs`**

```js
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { mulberry32, pickDrill } from './lib.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };

const settings = JSON.parse(readFileSync(arg('--settings'), 'utf8'));
let sessions = [];
try {
  sessions = readFileSync(arg('--sessions'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
} catch { /* no/empty session log is fine */ }

const seed = Number(arg('--seed', String(Date.now() % 2147483647)));
process.stdout.write(JSON.stringify(pickDrill({ settings, sessions, rng: mulberry32(seed) })));
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd "$REPO/skills/interview-drill/scripts" && node --test`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
cd "$REPO" && git add skills/interview-drill/scripts/pick_drill.mjs skills/interview-drill/scripts/test/cli.test.mjs && git commit -m "feat: pick_drill CLI"
```

---

## Task 8: `rag_index.mjs` (buildIndex + CLI)

**Files:**
- Create: `$REPO/skills/interview-drill/scripts/rag_index.mjs`
- Modify: `$REPO/skills/interview-drill/scripts/test/cli.test.mjs` (append)

- [ ] **Step 1: Add failing test** (injects a fake embed; checks structure + hash-skip reuse)

```js
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
```

- [ ] **Step 2: Run tests, verify fail**

Run: `cd "$REPO/skills/interview-drill/scripts" && node --test`
Expected: FAIL — cannot find `../rag_index.mjs`.

- [ ] **Step 3: Implement `rag_index.mjs`**

```js
#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { chunkMarkdown, contentHash } from './lib.mjs';
import { embed } from './openai.mjs';

// Pure-ish: embedFn is injectable for tests. Reuses chunks for unchanged files.
export async function buildIndex({ sourcesDir, prev = { items: [], source_hashes: {} }, embedFn }) {
  const files = readdirSync(sourcesDir).filter((f) => f.endsWith('.md'));
  const source_hashes = {};
  const items = [];
  const toEmbed = [];
  for (const file of files) {
    const text = readFileSync(join(sourcesDir, file), 'utf8');
    const hash = contentHash(text);
    source_hashes[file] = hash;
    if (prev.source_hashes[file] === hash) {
      items.push(...prev.items.filter((it) => it.file === file));
      continue;
    }
    chunkMarkdown(text).forEach((c, i) => toEmbed.push({ id: `${file}#${i}`, file, heading: c.heading, text: c.text }));
  }
  if (toEmbed.length) {
    const vecs = await embedFn(toEmbed.map((c) => c.text));
    toEmbed.forEach((c, i) => items.push({ ...c, embedding: vecs[i] }));
  }
  return { items, source_hashes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
  const sourcesDir = arg('--sources');
  const out = arg('--out');
  const prev = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : undefined;
  const index = await buildIndex({ sourcesDir, prev, embedFn: embed });
  writeFileSync(out, JSON.stringify(index));
  console.error(`indexed ${index.items.length} chunks from ${Object.keys(index.source_hashes).length} files`);
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd "$REPO/skills/interview-drill/scripts" && node --test`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
cd "$REPO" && git add skills/interview-drill/scripts/rag_index.mjs skills/interview-drill/scripts/test/cli.test.mjs && git commit -m "feat: rag_index with incremental hash-based embedding"
```

---

## Task 9: `rag_query.mjs` (queryIndex + CLI)

**Files:**
- Create: `$REPO/skills/interview-drill/scripts/rag_query.mjs`
- Modify: `$REPO/skills/interview-drill/scripts/test/cli.test.mjs` (append)

- [ ] **Step 1: Add failing test** (injected fake embed + fixture vectors file)

```js
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
```

- [ ] **Step 2: Run tests, verify fail**

Run: `cd "$REPO/skills/interview-drill/scripts" && node --test`
Expected: FAIL — cannot find `../rag_query.mjs`.

- [ ] **Step 3: Implement `rag_query.mjs`**

```js
#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { topK } from './lib.mjs';
import { embed } from './openai.mjs';

export async function queryIndex({ vectorsPath, query, k = 6, embedFn }) {
  const index = JSON.parse(readFileSync(vectorsPath, 'utf8'));
  const [qv] = await embedFn([query]);
  return topK(qv, index.items, k);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
  const query = arg('--query-file') ? readFileSync(arg('--query-file'), 'utf8').trim() : arg('--query');
  const hits = await queryIndex({
    vectorsPath: arg('--vectors'),
    query,
    k: Number(arg('--k', '6')),
    embedFn: embed
  });
  const json = JSON.stringify(hits);
  if (arg('--out')) writeFileSync(arg('--out'), json);
  else process.stdout.write(json);
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd "$REPO/skills/interview-drill/scripts" && node --test`
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
cd "$REPO" && git add skills/interview-drill/scripts/rag_query.mjs skills/interview-drill/scripts/test/cli.test.mjs && git commit -m "feat: rag_query top-K retrieval CLI"
```

---

## Task 10: `score_answer.mjs` (scoreAnswer + CLI)

**Files:**
- Create: `$REPO/skills/interview-drill/scripts/score_answer.mjs`
- Modify: `$REPO/skills/interview-drill/scripts/test/cli.test.mjs` (append)

- [ ] **Step 1: Add failing test** (injected fake chat; asserts validation + passthrough, and that a bad model response throws)

```js
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
```

- [ ] **Step 2: Run tests, verify fail**

Run: `cd "$REPO/skills/interview-drill/scripts" && node --test`
Expected: FAIL — cannot find `../score_answer.mjs`.

- [ ] **Step 3: Implement `score_answer.mjs`**

```js
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { buildScorePrompt, validateScore, SCORE_SCHEMA } from './lib.mjs';
import { chatJson } from './openai.mjs';

export async function scoreAnswer({ question, transcript, context, deep = false, chatFn }) {
  const messages = buildScorePrompt({ question, transcript, context, deep });
  const result = await chatFn(messages, SCORE_SCHEMA);
  const errs = validateScore(result);
  if (errs.length) throw new Error('invalid score: ' + errs.join('; '));
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
  const rd = (f) => (f ? readFileSync(f, 'utf8') : '');
  // File-based inputs: the agent writes question/transcript/context via the `write`
  // tool, so arbitrary speech text never has to survive shell quoting.
  const out = await scoreAnswer({
    question: rd(arg('--question-file')).trim(),
    transcript: rd(arg('--transcript-file')).trim(),
    context: rd(arg('--context-file')),
    deep: process.argv.includes('--deep'),
    chatFn: chatJson
  });
  process.stdout.write(JSON.stringify(out));
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd "$REPO/skills/interview-drill/scripts" && node --test`
Expected: PASS (18 tests).

- [ ] **Step 5: Commit**

```bash
cd "$REPO" && git add skills/interview-drill/scripts/score_answer.mjs skills/interview-drill/scripts/test/cli.test.mjs && git commit -m "feat: score_answer CLI with validation guard"
```

---

## Task 10b: `log_session.mjs` (append a session record)

The agent writes a full session object to a JSON file via the `write` tool; this script appends it as one line to `sessions.jsonl` (avoids shell-quoting transcripts and lets the agent include the full field set the Phase 2 Mini App will read).

**Files:**
- Create: `$REPO/skills/interview-drill/scripts/log_session.mjs`
- Modify: `$REPO/skills/interview-drill/scripts/test/cli.test.mjs` (append)

- [ ] **Step 1: Add failing test**

```js
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
```

- [ ] **Step 2: Run tests, verify fail**

Run: `cd "$REPO/skills/interview-drill/scripts" && node --test`
Expected: FAIL — `log_session.mjs` does not exist.

- [ ] **Step 3: Implement `log_session.mjs`**

```js
#!/usr/bin/env node
import { readFileSync, appendFileSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const obj = JSON.parse(readFileSync(arg('--in'), 'utf8'));
if (!obj.id) obj.id = Date.now();
if (!obj.ts) obj.ts = new Date().toISOString();
appendFileSync(arg('--log'), JSON.stringify(obj) + '\n');
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd "$REPO/skills/interview-drill/scripts" && node --test`
Expected: PASS (19 tests).

- [ ] **Step 5: Commit**

```bash
cd "$REPO" && git add skills/interview-drill/scripts/log_session.mjs skills/interview-drill/scripts/test/cli.test.mjs && git commit -m "feat: log_session appends a structured session record"
```

---

## Task 11: End-to-end smoke test (`smoke.mjs`)

**Files:**
- Create: `$REPO/skills/interview-drill/scripts/smoke.mjs`

- [ ] **Step 1: Implement the smoke runner** (fakes only — no network, no Telegram)

```js
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
```

- [ ] **Step 2: Run the smoke test**

Run: `cd "$REPO/skills/interview-drill/scripts" && node smoke.mjs`
Expected: prints `SMOKE OK: { format: '<one of 5>', topHit: 'ds', score: 4 }`, exits 0.

- [ ] **Step 3: Run the full unit suite once more**

Run: `cd "$REPO/skills/interview-drill/scripts" && node --test`
Expected: PASS (19 tests).

- [ ] **Step 4: Commit**

```bash
cd "$REPO" && git add skills/interview-drill/scripts/smoke.mjs && git commit -m "test: end-to-end smoke for pick/retrieve/score pipeline"
```

---

## Task 12: Write `SKILL.md`

**Files:**
- Create: `$REPO/skills/interview-drill/SKILL.md`

- [ ] **Step 1: Write the skill instructions**

```markdown
---
name: interview-drill
description: Run Nick's daily English design-interview drill — pick a format, ask a personalized question about his real work, score his spoken answer, and log it. Use when the daily cron fires, or when Nick says "interview practice" / "/more".
metadata:
  openclaw:
    requires:
      bins: [node]
---

# Interview Drill

You are running Nick's daily design-interview practice. Nick is a senior product designer (advanced non-native English) prepping across portfolio, behavioral, design-critique, whiteboard, and hiring-manager formats.

Run all `exec` commands with `workdir` = this workspace root (`/Users/nickv/.openclaw/workspace-speaker`). Paths:
- Scripts: `skills/interview-drill/scripts/`
- State: `interview/` (`sources/`, `vectors.json`, `sessions.jsonl`, `settings.json`)

## A. Send the daily question (cron trigger or "/more")

1. Pick the format:
   `exec`: `node skills/interview-drill/scripts/pick_drill.mjs --settings interview/settings.json --sessions interview/sessions.jsonl`
   → `{"format":"<one of: portfolio|behavioral|critique|whiteboard|hiring_manager>"}`

2. Build a short retrieval query for that format (e.g. portfolio → "Nick's strongest project, his role and impact"; behavioral → "a time Nick led through conflict or ambiguity"; critique → "a design decision Nick can defend"). Then:
   `exec`: `node skills/interview-drill/scripts/rag_query.mjs --vectors interview/vectors.json --query "<query>" --k 6`
   → JSON array of `{id,file,heading,text,score}`.

3. Write ONE focused interview question in that format, grounded in the retrieved context (reference his real projects — NextHealth, FraudFighter, ProPortals, Flow Builders — when relevant). 1–3 sentences, like a real interviewer. Keep the exact question text; you need it for scoring.

4. Deliver:
   - `message`: the question text.
   - `tts`: a voice note of the question (listening practice).
   - `message` (SEPARATE — voice notes can't carry buttons) with inline buttons:
     `[[{"text":"🎤 Voice","callback_data":"drill_voice"},{"text":"📝 Text","callback_data":"drill_text"}],[{"text":"🔄 Different","callback_data":"drill_diff"},{"text":"⏭️ Skip","callback_data":"drill_skip"}]]`

   If a later turn delivers `callback_data: drill_diff`, restart at step 1. If `drill_skip`, acknowledge warmly and stop.

## B. Score Nick's answer (next turn)

Voice answers arrive ALREADY TRANSCRIBED in the incoming message (OpenClaw transcribes inbound audio before your turn). Use that text as the transcript. If Nick typed, use the typed text.

To avoid shell-quoting problems with arbitrary speech text, write inputs to files with the `write` tool, then pass file paths to the scorer.

1. Retrieve context for the question (reuse the Section A query or refine it):
   `exec`: `node skills/interview-drill/scripts/rag_query.mjs --vectors interview/vectors.json --query "<query>" --k 6`
2. Using the `write` tool, save three files under `interview/`:
   - `.q.txt` — the exact question text you asked
   - `.a.txt` — Nick's transcript (verbatim)
   - `.ctx.txt` — the `text` fields of the retrieved chunks, joined by blank lines
3. Score:
   `exec`: `node skills/interview-drill/scripts/score_answer.mjs --question-file interview/.q.txt --transcript-file interview/.a.txt --context-file interview/.ctx.txt`
   (If Nick tapped "🎯 Go deeper", append `--deep`.)
   → `{score, rephrases:[{original,improved}], model_answer, weak_vocab:[...]}`
4. Reply to Nick:
   - **Your answer:** the transcript
   - **Rephrases:** each `original` → `improved`
   - **Model answer:** the `model_answer` text, then a `tts` voice note of it
   - **Score:** `score`/5
   - SEPARATE `message` with buttons:
     `[[{"text":"🔁 Try again","callback_data":"drill_retry"},{"text":"🎯 Go deeper","callback_data":"drill_deep"}],[{"text":"📌 Save vocab","callback_data":"drill_savevocab"},{"text":"✅ Done","callback_data":"drill_done"}]]`
5. Log the session: with the `write` tool, save `interview/.session.json` containing
   `{ "format", "question_text", "answer_transcript", "answer_mode": "voice"|"text", "score", "rephrases", "model_answer_text", "weak_vocab" }` (omit `id`/`ts` — the script fills them), then:
   `exec`: `node skills/interview-drill/scripts/log_session.mjs --in interview/.session.json --log interview/sessions.jsonl`
6. Feed weak vocab into the existing vocab flow: per the `vocabulary-trainer` skill, append the `weak_vocab` items to `vocabulary_log.md` and the most relevant `word_lists/*.md` so they enter spaced repetition.

If `drill_retry`: re-ask the same question and score the new answer (record both). If `drill_savevocab`: also add any words Nick names. If `drill_done`: close warmly.

## Rules
- NEVER print or log API keys or `~/.openclaw/openclaw.json`. Scripts read `OPENAI_API_KEY` from the environment.
- Coach persona: warm, precise, specific. Celebrate progress; don't let errors slide.
- One question per drill. On "/more", run section A again.
- If a script errors (e.g. OpenAI unavailable), tell Nick plainly and offer to retry; never hard-block on a failed score.
```

- [ ] **Step 2: Commit**

```bash
cd "$REPO" && git add skills/interview-drill/SKILL.md && git commit -m "feat: interview-drill SKILL.md (agent orchestration instructions)"
```

---

## Task 13: Provision workspace state, sources, symlink, and real index

**Files (created on disk, not in the repo):**
- Create: `$WS/interview/settings.json`, `$WS/interview/sessions.jsonl`
- Create: `$WS/interview/sources/` (git clone)
- Create symlink: `$WS/skills/interview-drill` → `$REPO/skills/interview-drill`

- [ ] **Step 1: Create state dir + default settings**

```bash
mkdir -p "/Users/nickv/.openclaw/workspace-speaker/interview"
cat > "/Users/nickv/.openclaw/workspace-speaker/interview/settings.json" <<'JSON'
{
  "nudge_time": "08:30",
  "skip_weekends": true,
  "timezone": "America/Toronto",
  "per_day_target": 1,
  "tts_voice": "nova",
  "format_weights": { "portfolio": 40, "behavioral": 25, "critique": 15, "whiteboard": 10, "hiring_manager": 10 }
}
JSON
: > "/Users/nickv/.openclaw/workspace-speaker/interview/sessions.jsonl"
```

- [ ] **Step 2: Clone Nick's bio into sources/**

```bash
git clone https://github.com/weeeha/nicks-bio.git "/Users/nickv/.openclaw/workspace-speaker/interview/sources"
ls "/Users/nickv/.openclaw/workspace-speaker/interview/sources"/*.md
```
Expected: lists `case-study-answers.md`, `nick-vyhouski-brief.md`, etc.

- [ ] **Step 3: Symlink the skill into the Coach workspace**

```bash
ln -s "/Users/nickv/ClaudeCode Projects/Lanuage Learning Bot/skills/interview-drill" "/Users/nickv/.openclaw/workspace-speaker/skills/interview-drill"
ls -l "/Users/nickv/.openclaw/workspace-speaker/skills/interview-drill"
```
Expected: symlink resolves to the repo path.

- [ ] **Step 4: Confirm `OPENAI_API_KEY` is available, then build the real index**

```bash
cd "/Users/nickv/.openclaw/workspace-speaker"
test -n "$OPENAI_API_KEY" && echo "key present" || echo "KEY MISSING — export it for this shell before indexing"
node "skills/interview-drill/scripts/rag_index.mjs" --sources interview/sources --out interview/vectors.json
```
Expected: stderr `indexed N chunks from M files`; `interview/vectors.json` created. (If the key is missing here but present in the gateway env, run indexing from a shell that has it, or trigger it once via the agent's `exec`.)

- [ ] **Step 5: Verify OpenClaw loads the skill**

```bash
openclaw skills list 2>/dev/null | grep -i interview-drill || echo "not listed — run: openclaw gateway restart, then retry"
```
Expected: `interview-drill` appears. If not, `openclaw gateway restart` and retry (symlinked skills may need a reload).

- [ ] **Step 6: Set the scoring model env (optional, once confirmed)**

Confirm the exact OpenAI model id for Nick's account and, if different from the default, ensure `INTERVIEW_SCORE_MODEL` is exported in the gateway env (e.g. `gpt-5.4`). Leave unset to use the safe default `gpt-4o-2024-08-06`. No secrets are involved here.

(No repo commit — this task only creates runtime state on disk.)

---

## Task 14: Schedule the daily cron job

- [ ] **Step 1: Add the cron job**

```bash
openclaw cron add --name "interview-drill" --cron "30 8 * * 1-5" --tz "America/Toronto" \
  --session isolated --agent speaker \
  --message "Run today's interview drill: read skills/interview-drill/SKILL.md and perform Section A (send one personalized question with voice + buttons)." \
  --tools exec,tts,message
```
Expected: confirmation that a job named `interview-drill` was created.

- [ ] **Step 2: Verify the job persisted (no secrets in this file)**

```bash
grep -o '"name":"interview-drill"[^}]*' "/Users/nickv/.openclaw/cron/jobs.json" | head -1
```
Expected: shows the job entry with the cron expression.

- [ ] **Step 3: Note the asleep caveat**

Document for Nick: if the Mac is asleep at 08:30, the fire is **skipped, not replayed** (verified OpenClaw cron behavior). Acceptable for a personal habit. (No commit — runtime config.)

---

## Task 15: Enable Telegram inline buttons (config edit — handle with care)

> ⚠️ This edits `~/.openclaw/openclaw.json`, which holds the whole agent fleet's secrets. Back up first, edit only the one key, never print the file, validate, and restart.

- [ ] **Step 1: Back up the config**

```bash
cp "/Users/nickv/.openclaw/openclaw.json" "/Users/nickv/.openclaw/openclaw.json.bak-preinline-$(date +%Y%m%d-%H%M%S)"
```

- [ ] **Step 2: Set `channels.telegram.capabilities.inlineButtons` in place (no secrets printed)**

```bash
node -e '
const fs=require("fs"); const p=process.env.HOME+"/.openclaw/openclaw.json";
const j=JSON.parse(fs.readFileSync(p,"utf8"));
j.channels=j.channels||{}; j.channels.telegram=j.channels.telegram||{};
j.channels.telegram.capabilities=j.channels.telegram.capabilities||{};
j.channels.telegram.capabilities.inlineButtons="all";
fs.writeFileSync(p, JSON.stringify(j,null,2));
console.log("inlineButtons =", j.channels.telegram.capabilities.inlineButtons);
'
```
Expected: prints `inlineButtons = all` only. (If this errors because the file is JSONC/has comments, STOP and edit the single key by hand instead — do not force-parse.)

- [ ] **Step 3: Validate + restart the gateway**

```bash
openclaw doctor --non-interactive 2>&1 | tail -20
openclaw gateway restart
openclaw gateway status
```
Expected: doctor reports no new errors; gateway restarts and reports running. (Restart briefly affects all agents — expected on a personal box.)

(No repo commit — runtime config.)

---

## Task 16: Manual end-to-end verification

- [ ] **Step 1: Trigger the drill manually**

```bash
# Most reliable: DM the bot on Telegram from your phone:  interview practice
# (Coach will load the skill and run Section A.)
# To also verify the SCHEDULED path fires correctly, list jobs and run the one by id:
openclaw cron list 2>/dev/null | grep -i interview-drill
# then, if your CLI supports manual fire (check `openclaw cron --help`):  openclaw cron run <job-id>
```
Expected: within ~1 min, `@Nxspeakingcoachbot` DMs a question (text + voice note + a buttons message).

- [ ] **Step 2: Answer by voice in Telegram**

Send a voice message answering the question. Expected reply: your transcript, 2–3 rephrases, a model answer (text + voice note), and `Score: N/5`, followed by a buttons message.

- [ ] **Step 3: Confirm the session logged**

```bash
tail -1 "/Users/nickv/.openclaw/workspace-speaker/interview/sessions.jsonl"
```
Expected: one JSON line with `format`, `question_text`, `answer_transcript`, `score`, `weak_vocab`.

- [ ] **Step 4: Confirm weak vocab fed the vocab flow**

```bash
tail -5 "/Users/nickv/.openclaw/workspace-speaker/vocabulary_log.md"
```
Expected: the new weak-vocab terms appear (entering the existing SRS).

- [ ] **Step 5: Tag the Phase 1 completion**

```bash
cd "$REPO" && git tag phase1-interview-drill && git log --oneline | head -12
```

---

## Phase 1 Done — Definition of Done
- `node --test` passes (19 tests); `node smoke.mjs` prints `SMOKE OK`.
- Weekday 08:30 cron DMs a personalized, format-varied question on `@Nxspeakingcoachbot`.
- Voice answer → transcript + rephrases + model answer (text+TTS) + 1–5 score.
- Sessions append to `sessions.jsonl`; weak vocab flows into Coach's existing vocab SRS.
- No secrets are printed or committed; scripts read `OPENAI_API_KEY` from env.

**Out of scope (later plans):** Phase 2 (Mini App: Sessions + Workspace, standalone server + tunnel, `initData` auth) and Phase 3 (Pitch Studio + Vocab UI). Each gets its own plan.
