# Phase 3 Implementation Plan — Pitch Studio + Vocab SRS

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the last two Mini App tabs — **Vocab** (a real spaced-repetition trainer backed by a structured store) and **Pitch Studio** (manage pitch variants + view score history) — plus a small **coverage** summary, building on the Phase 1 skill and the Phase 2 server/app.

**Architecture:** Two independent tracks.
- **Vocab SRS:** a structured `interview/vocab.json` becomes the source of truth for spaced repetition. A zero-dep `shared/vocab.mjs` holds the Leitner logic, imported by BOTH the Phase 1 skill's vocab CLI (to add weak-vocab cards) and the Phase 2 server (to list due cards + record reviews). A one-time migration seeds it from the existing freeform `vocabulary_log.md`.
- **Pitch Studio:** pitch variants are markdown files in `interview/pitch/`; the server exposes CRUD + a parsed view of Coach's existing `pitch_history.md` for a score sparkline. Drilling stays in the bot (existing `pitch-coach` skill).

**Tech Stack:** Node ESM, `node:test`; Hono server (extends Phase 2); React/Vite SPA (extends Phase 2).

---

## Decisions (made here — veto before execution)

1. **`interview/vocab.json` is the SRS source of truth.** Leitner boxes 1–5 with review intervals **1 / 3 / 7 / 14 days**; box 5 = mastered (not due). Mirrors the existing `vocabulary-trainer` SKILL.md ladder.
2. **Shared logic in `shared/vocab.mjs`** (repo-level, zero-dep, pure functions), imported by both the skill CLI and the server via relative path. Resolves correctly through the runtime symlink (ESM resolves real paths).
3. **Phase 1 skill update:** after a drill, weak vocab is ALSO added as structured cards (`vocab_cli.mjs add`) in addition to the existing `vocabulary_log.md` append. The freeform log stays as legacy history; `vocab.json` drives the SRS UI.
4. **The bot's daily `vocabulary-trainer` drop is unchanged** (out of scope). Only the interview weak-vocab + the Mini App SRS use `vocab.json`.
5. **Pitch Studio = edit + history only.** Variants are `interview/pitch/*.md` (create/edit/delete). "Generate a variant via bot" and "Drill this pitch" are deferred — drilling already works by asking Coach in chat.
6. **Coverage:** a lightweight summary (sessions per format + avg score) computed from `/api/sessions`. The richer "skill-tag coverage from case-study front-matter" stays future (depends on tags existing in `nicks-bio`).
7. **Migration is a one-time runbook step you run** (live data); the plan ships the script + a dry-run.

---

## File Structure

```
$REPO/shared/vocab.mjs                         # NEW: pure Leitner SRS logic (zero-dep)
$REPO/skills/interview-drill/scripts/
  vocab_cli.mjs                                # NEW: add / due / review / all over vocab.json
  vocab_migrate.mjs                            # NEW: vocabulary_log.md -> vocab.json (one-time)
  test/vocab.test.mjs                          # NEW: SRS logic + CLI tests
  SKILL.md                                     # EDIT: weak_vocab also -> vocab_cli add
$REPO/mini-app/server/
  pitch_history.mjs                            # NEW: parse pitch_history.md table -> points
  store.mjs                                    # EDIT: vocab* + pitch* + pitchHistory methods
  server.mjs                                   # EDIT: /api/vocab/*, /api/pitch/*, /api/pitch-history
  test/pitch_history.test.mjs                  # NEW
  test/store.test.mjs                          # EDIT: vocab + pitch method tests
$REPO/mini-app/web/src/
  App.tsx                                      # EDIT: 4 tabs (Sessions | Pitch | Vocab | Workspace)
  api.ts / types.ts                            # EDIT: vocab + pitch
  tabs/Vocab.tsx                               # NEW
  tabs/Pitch.tsx                               # NEW
  tabs/Sessions.tsx                            # EDIT: small coverage summary header
```

Runtime state added under `interview/`: `vocab.json`, `pitch/` (dir of `*.md`).

---

# Track A — Vocab SRS

## Task A1: `shared/vocab.mjs` — Leitner logic (TDD)

**Files:** Create `$REPO/shared/vocab.mjs`, `$REPO/skills/interview-drill/scripts/test/vocab.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCard, review, isDue, BOX_INTERVAL_DAYS } from '../../../../shared/vocab.mjs';

test('newCard starts in box 1, due in 1 day, with given fields', () => {
  const c = newCard({ term: 'leverage', context: 'we can leverage X', source: 'auto', today: '2026-05-28' });
  assert.equal(c.box, 1);
  assert.equal(c.term, 'leverage');
  assert.equal(c.source, 'auto');
  assert.equal(c.next_review, '2026-05-29');
  assert.ok(c.id);
});

test('review knew -> advances box and pushes next_review by the new interval', () => {
  const c = newCard({ term: 't', context: 'c', today: '2026-05-28' });
  const r = review(c, true, '2026-05-29');
  assert.equal(r.box, 2);
  assert.equal(r.next_review, '2026-06-01'); // +3 days from 05-29
});

test('review missed -> resets to box 1, due in 1 day', () => {
  const c = { ...newCard({ term: 't', context: 'c', today: '2026-05-28' }), box: 4 };
  const r = review(c, false, '2026-06-10');
  assert.equal(r.box, 1);
  assert.equal(r.next_review, '2026-06-11');
});

test('box 5 is mastered (never due)', () => {
  const c = { ...newCard({ term: 't', context: 'c', today: '2026-05-28' }), box: 5, next_review: '2000-01-01' };
  assert.equal(isDue(c, '2026-05-28'), false);
});

test('isDue true when box<5 and next_review <= today', () => {
  const c = newCard({ term: 't', context: 'c', today: '2026-05-28' });
  assert.equal(isDue(c, '2026-05-29'), true);
  assert.equal(isDue(c, '2026-05-28'), false);
  assert.equal(BOX_INTERVAL_DAYS[1], 1);
});
```

- [ ] **Step 2: Run, verify fail** — `cd "skills/interview-drill/scripts" && node --test test/vocab.test.mjs` — FAIL (no module).

- [ ] **Step 3: Implement `shared/vocab.mjs`**

```js
// Pure Leitner spaced-repetition logic. Zero dependencies. Dates are 'YYYY-MM-DD'.
export const BOX_INTERVAL_DAYS = { 1: 1, 2: 3, 3: 7, 4: 14 }; // box 5 = mastered (no interval)
export const MASTERED_BOX = 5;

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const nextReview = (box, today) => addDays(today, BOX_INTERVAL_DAYS[box] ?? BOX_INTERVAL_DAYS[4]);

export function newCard({ term, context = '', source = 'auto', today }) {
  return {
    id: `${today}-${Math.random().toString(36).slice(2, 8)}`,
    term, context, source,
    box: 1, created: today, next_review: addDays(today, 1), last_reviewed: null
  };
}

export function review(card, knew, today) {
  const box = knew ? Math.min(card.box + 1, MASTERED_BOX) : 1;
  const next_review = box >= MASTERED_BOX ? null : nextReview(box, today);
  return { ...card, box, next_review, last_reviewed: today };
}

export function isDue(card, today) {
  return card.box < MASTERED_BOX && !!card.next_review && card.next_review <= today;
}
```

- [ ] **Step 4: Run, verify pass** — PASS (5 tests).

- [ ] **Step 5: commit**

```bash
cd "$REPO" && git add shared/vocab.mjs skills/interview-drill/scripts/test/vocab.test.mjs && git commit -m "feat: shared Leitner SRS logic (vocab.mjs)"
```

---

## Task A2: `vocab_cli.mjs` — add/due/review/all over vocab.json (TDD)

**Files:** Create `$REPO/skills/interview-drill/scripts/vocab_cli.mjs`; append to `test/vocab.test.mjs`

- [ ] **Step 1: Add failing CLI tests** (spawn the CLI against a temp store)

```js
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync as wf, readFileSync as rf, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (args, opts = {}) => execFileSync('node', ['vocab_cli.mjs', ...args], { encoding: 'utf8', ...opts });

test('vocab_cli add creates a card; dedupes by term', () => {
  const store = join(mkdtempSync(join(tmpdir(), 'voc-')), 'vocab.json');
  run(['add', '--store', store, '--term', 'runway', '--context', 'we have 12mo runway', '--today', '2026-05-28']);
  run(['add', '--store', store, '--term', 'runway', '--context', 'dup', '--today', '2026-05-28']); // dedupe
  const cards = JSON.parse(rf(store, 'utf8'));
  assert.equal(cards.length, 1);
  assert.equal(cards[0].term, 'runway');
});

test('vocab_cli due lists only cards due on/before --today', () => {
  const store = join(mkdtempSync(join(tmpdir(), 'voc-')), 'vocab.json');
  run(['add', '--store', store, '--term', 'a', '--context', 'x', '--today', '2026-05-01']);
  const due = JSON.parse(run(['due', '--store', store, '--today', '2026-05-02']));
  assert.equal(due.length, 1);
  const dueNone = JSON.parse(run(['due', '--store', store, '--today', '2026-05-01']));
  assert.equal(dueNone.length, 0);
});

test('vocab_cli review advances the card', () => {
  const store = join(mkdtempSync(join(tmpdir(), 'voc-')), 'vocab.json');
  run(['add', '--store', store, '--term', 'a', '--context', 'x', '--today', '2026-05-01']);
  const id = JSON.parse(rf(store, 'utf8'))[0].id;
  run(['review', '--store', store, '--id', id, '--knew', 'true', '--today', '2026-05-02']);
  assert.equal(JSON.parse(rf(store, 'utf8'))[0].box, 2);
});
```

- [ ] **Step 2: Run, verify fail** — FAIL (no `vocab_cli.mjs`).

- [ ] **Step 3: Implement `vocab_cli.mjs`**

```js
#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { newCard, review, isDue } from '../../../shared/vocab.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const today = () => new Date().toISOString().slice(0, 10);
const load = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : []);
const save = (p, cards) => writeFileSync(p, JSON.stringify(cards, null, 2));

export function cmdAdd(store, { term, context, source, day }) {
  const cards = load(store);
  if (cards.some((c) => c.term.toLowerCase() === term.toLowerCase())) return cards; // dedupe by term
  cards.push(newCard({ term, context, source: source || 'auto', today: day || today() }));
  save(store, cards);
  return cards;
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const cmd = process.argv[2];
  const store = arg('--store');
  if (!store) { console.error('Usage: vocab_cli.mjs <add|due|review|all> --store <vocab.json> ...'); process.exit(1); }
  const day = arg('--today');
  if (cmd === 'add') {
    const term = arg('--term');
    if (!term) { console.error('add requires --term'); process.exit(1); }
    cmdAdd(store, { term, context: arg('--context', ''), source: arg('--source'), day });
  } else if (cmd === 'due') {
    process.stdout.write(JSON.stringify(load(store).filter((c) => isDue(c, day || today()))));
  } else if (cmd === 'all') {
    process.stdout.write(JSON.stringify(load(store)));
  } else if (cmd === 'review') {
    const id = arg('--id'); const knew = arg('--knew') === 'true';
    const cards = load(store).map((c) => (c.id === id ? review(c, knew, day || today()) : c));
    save(store, cards);
  } else { console.error('unknown command'); process.exit(1); }
}
```

- [ ] **Step 4: Run, verify pass** — `node --test test/vocab.test.mjs` — PASS (8 tests).

- [ ] **Step 5: commit**

```bash
cd "$REPO" && git add skills/interview-drill/scripts/vocab_cli.mjs skills/interview-drill/scripts/test/vocab.test.mjs && git commit -m "feat: vocab_cli (add/due/review/all) over vocab.json"
```

---

## Task A3: `vocab_migrate.mjs` — seed vocab.json from vocabulary_log.md (TDD)

**Files:** Create `$REPO/skills/interview-drill/scripts/vocab_migrate.mjs`; append to `test/vocab.test.mjs`

- [ ] **Step 1: Add failing test**

```js
import { parseVocabLog } from '../vocab_migrate.mjs';

test('parseVocabLog extracts terms from the freeform log', () => {
  const log = [
    'May 9th, 2026 (Saturday)', 'Words Taught:',
    '1. bite the bullet (colloquial)', '2. bottleneck (business)', '', 'Status: introduced'
  ].join('\n');
  const terms = parseVocabLog(log);
  assert.ok(terms.includes('bite the bullet'));
  assert.ok(terms.includes('bottleneck'));
  assert.equal(terms.length, 2);
});
```

- [ ] **Step 2: Run, verify fail** — FAIL.

- [ ] **Step 3: Implement `vocab_migrate.mjs`**

```js
#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { newCard } from '../../../shared/vocab.mjs';

// Best-effort: pull "N. term (category)" lines from the freeform log; strip the trailing "(category)".
export function parseVocabLog(md) {
  const terms = [];
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^\s*\d+\.\s+(.+?)\s*(?:\([^)]*\))?\s*$/);
    if (m) {
      const term = m[1].replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (term && !terms.includes(term)) terms.push(term);
    }
  }
  return terms;
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
  const log = arg('--log'); const store = arg('--store');
  if (!log || !store) { console.error('Usage: vocab_migrate.mjs --log <vocabulary_log.md> --store <vocab.json> [--dry-run]'); process.exit(1); }
  const today = new Date().toISOString().slice(0, 10);
  const existing = existsSync(store) ? JSON.parse(readFileSync(store, 'utf8')) : [];
  const have = new Set(existing.map((c) => c.term.toLowerCase()));
  const added = parseVocabLog(readFileSync(log, 'utf8'))
    .filter((t) => !have.has(t.toLowerCase()))
    .map((term) => newCard({ term, context: '(migrated from vocabulary_log.md)', source: 'auto', today }));
  console.error(`migrate: ${added.length} new cards (${existing.length} existing)`);
  if (process.argv.includes('--dry-run')) { process.stdout.write(JSON.stringify(added.map((c) => c.term))); process.exit(0); }
  writeFileSync(store, JSON.stringify([...existing, ...added], null, 2));
}
```

- [ ] **Step 4: Run, verify pass** — PASS (9 tests in vocab.test.mjs).

- [ ] **Step 5: commit**

```bash
cd "$REPO" && git add skills/interview-drill/scripts/vocab_migrate.mjs skills/interview-drill/scripts/test/vocab.test.mjs && git commit -m "feat: vocab_migrate (seed vocab.json from freeform log)"
```

---

## Task A4: Update the interview-drill SKILL.md to add structured cards

**Files:** Edit `$REPO/skills/interview-drill/SKILL.md`

- [ ] **Step 1: Extend Section B step 6.** Replace the existing step 6 ("Feed weak vocab…") with:

```markdown
6. Feed weak vocab into BOTH stores:
   - **Structured SRS (for the Mini App):** for each item in `weak_vocab`, run
     `exec`: `node skills/interview-drill/scripts/vocab_cli.mjs add --store interview/vocab.json --term "<item>" --context "<the question or your rephrase>" --source auto`
     (the CLI dedupes by term).
   - **Legacy log:** also append the items to `vocabulary_log.md` per the `vocabulary-trainer` skill (unchanged), so the bot's daily vocab ritual still sees them.
```

- [ ] **Step 2: commit**

```bash
cd "$REPO" && git add skills/interview-drill/SKILL.md && git commit -m "feat: interview-drill also writes structured vocab cards"
```

---

# Track B — Server: vocab + pitch endpoints

## Task B1: `pitch_history.mjs` — parse Coach's pitch_history.md (TDD)

**Files:** Create `$REPO/mini-app/server/pitch_history.mjs`, `$REPO/mini-app/server/test/pitch_history.test.mjs`

- [ ] **Step 1: Write failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePitchHistory } from '../pitch_history.mjs';

test('parsePitchHistory reads dated rows with an overall score, skips header/example', () => {
  const md = [
    '| Date | Context | Format | Clarity | Structure | Word Choice | Persuasion | Grammar | Overall | Key Feedback |',
    '|------|---------|--------|---------|-----------|-------------|------------|---------|---------|--------------|',
    '| _(example)_ | TopTal | voice | 7/10 | 8/10 | 6/10 | 7/10 | 8/10 | 7/10 | filler |',
    '| 2026-05-20 | design system | voice | 7/10 | 8/10 | 7/10 | 8/10 | 9/10 | 8/10 | strong open |',
    '| 2026-05-27 | product lead | text | 8/10 | 8/10 | 8/10 | 8/10 | 9/10 | 9/10 | tighter |'
  ].join('\n');
  const pts = parsePitchHistory(md);
  assert.equal(pts.length, 2);
  assert.deepEqual(pts[0], { date: '2026-05-20', overall: 8 });
  assert.equal(pts[1].overall, 9);
});

test('parsePitchHistory tolerates an empty/missing table', () => {
  assert.deepEqual(parsePitchHistory(''), []);
});
```

- [ ] **Step 2: Run, verify fail** — FAIL.

- [ ] **Step 3: Implement `pitch_history.mjs`**

```js
// Parse Coach's pitch_history.md markdown table into [{date, overall}] sparkline points.
// Only rows whose first cell is an ISO date (YYYY-MM-DD) count; header/example/blank rows are skipped.
export function parsePitchHistory(md) {
  const points = [];
  for (const line of (md || '').split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    // cells[0] is '' (leading pipe); cells[1] = Date column
    const date = cells[1];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const overallCell = cells[9] || '';
    const m = overallCell.match(/(\d+(?:\.\d+)?)/);
    if (!m) continue;
    points.push({ date, overall: Number(m[1]) });
  }
  return points;
}
```

- [ ] **Step 4: Run, verify pass** — PASS.

- [ ] **Step 5: commit**

```bash
cd "$REPO" && git add mini-app/server/pitch_history.mjs mini-app/server/test/pitch_history.test.mjs && git commit -m "feat: pitch_history.md parser for the score sparkline"
```

---

## Task B2: Extend `store.mjs` with vocab + pitch methods (TDD)

**Files:** Edit `$REPO/mini-app/server/store.mjs`; append to `test/store.test.mjs`

- [ ] **Step 1: Add failing tests** (append; reuse the existing `fixture()` helper that builds `makeStore` over a temp dir — no new imports needed).

```js
test('vocab add/due/review/all round-trip through the store', () => {
  const s = fixture(); // from earlier in this file: makeStore over a temp dir
  s.vocabAdd({ term: 'synergy', context: 'cross-team synergy', today: '2026-05-01' });
  assert.equal(s.vocabAll().length, 1);
  assert.equal(s.vocabDue('2026-05-02').length, 1);
  const id = s.vocabAll()[0].id;
  s.vocabReview(id, true, '2026-05-02');
  assert.equal(s.vocabAll()[0].box, 2);
});

test('pitch list/read/write/create/delete with traversal guard', () => {
  const s = fixture();
  s.createPitch('default.md', '# Default pitch');
  assert.deepEqual(s.listPitch(), ['default.md']);
  assert.match(s.readPitch('default.md'), /Default pitch/);
  s.writePitch('default.md', '# Edited');
  assert.match(s.readPitch('default.md'), /Edited/);
  assert.throws(() => s.readPitch('../x.md'), /invalid pitch/i);
  s.deletePitch('default.md');
  assert.deepEqual(s.listPitch(), []);
});
```

- [ ] **Step 2: Run, verify fail** — FAIL (methods missing).

- [ ] **Step 3: Implement** — update imports, then add methods.

(a) Replace the `node:fs` import line at the top of `store.mjs` (Phase 2 had `readFileSync, writeFileSync, readdirSync`) with the full set:
```js
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'node:fs';
```
(b) Add two import lines below the existing imports:
```js
import { parsePitchHistory } from './pitch_history.mjs';
import { newCard, review as srsReview, isDue } from '../../shared/vocab.mjs';
```
(c) Inside the object returned by `makeStore` (alongside the existing methods), add:

```js
    // --- vocab SRS (interview/vocab.json) ---
    _vocabPath() { return join(interviewDir, 'vocab.json'); },
    _vocabLoad() { try { return JSON.parse(readFileSync(join(interviewDir, 'vocab.json'), 'utf8')); } catch { return []; } },
    _vocabSave(cards) { writeFileSync(join(interviewDir, 'vocab.json'), JSON.stringify(cards, null, 2)); },
    vocabAll() { return this._vocabLoad(); },
    vocabDue(today = new Date().toISOString().slice(0, 10)) { return this._vocabLoad().filter((c) => isDue(c, today)); },
    vocabAdd({ term, context = '', source = 'manual', today = new Date().toISOString().slice(0, 10) }) {
      const cards = this._vocabLoad();
      if (cards.some((c) => c.term.toLowerCase() === term.toLowerCase())) return cards;
      cards.push(newCard({ term, context, source, today }));
      this._vocabSave(cards); return cards;
    },
    vocabReview(id, knew, today = new Date().toISOString().slice(0, 10)) {
      const cards = this._vocabLoad().map((c) => (c.id === id ? srsReview(c, knew, today) : c));
      this._vocabSave(cards); return cards.find((c) => c.id === id) || null;
    },
    // --- pitch variants (interview/pitch/*.md) ---
    _pitchDir() { const d = join(interviewDir, 'pitch'); if (!existsSync(d)) mkdirSync(d, { recursive: true }); return d; },
    _safePitch(name) {
      if (!name || name.includes('\0') || name !== basename(name) || !name.endsWith('.md'))
        throw Object.assign(new Error(`invalid pitch: ${name}`), { status: 400 });
      return join(this._pitchDir(), name);
    },
    listPitch() { try { return readdirSync(this._pitchDir()).filter((f) => f.endsWith('.md')).sort(); } catch { return []; } },
    readPitch(name) { return readFileSync(this._safePitch(name), 'utf8'); },
    writePitch(name, content) { writeFileSync(this._safePitch(name), content); return true; },
    createPitch(name, content = '') { writeFileSync(this._safePitch(name), content); return true; },
    deletePitch(name) { rmSync(this._safePitch(name)); return true; },
    pitchHistory() {
      try { return parsePitchHistory(readFileSync(join(interviewDir, '..', 'pitch_history.md'), 'utf8')); } catch { return []; }
    },
```
> Note: methods reference `this` — they're called as `store.vocabDue()` so `this` binds correctly. (The existing Phase 2 methods don't use `this`; these new ones do for the private helpers. That's fine since callers use `store.method()`.)

- [ ] **Step 4: Run, verify pass** — `cd "mini-app/server" && node --test` — PASS (Phase 2's 13 + pitch_history 2 + these 2 = 17).

- [ ] **Step 5: commit**

```bash
cd "$REPO" && git add mini-app/server/store.mjs mini-app/server/test/store.test.mjs && git commit -m "feat: store vocab SRS + pitch variant CRUD + pitch history"
```

---

## Task B3: Add routes in `server.mjs` (TDD)

**Files:** Edit `$REPO/mini-app/server/server.mjs`; append to `test/server.test.mjs`

- [ ] **Step 1: Add failing tests** (reuse the `sign()` + `dir()` helpers already in server.test.mjs; add a seeded vocab card via the store path or via the add route)

```js
test('vocab flow: add -> due -> review over the API', async () => {
  const app = createApp({ interviewDir: dir(), botToken: BOT, staticDir: null });
  const auth = { Authorization: `tma ${sign({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 1 }) })}` };
  let res = await app.request('/api/vocab', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ term: 'cadence', context: 'release cadence', today: '2026-05-01' }) });
  assert.equal(res.status, 200);
  res = await app.request('/api/vocab/due?today=2026-05-02', { headers: auth });
  const due = await res.json();
  assert.equal(due.length, 1);
  res = await app.request(`/api/vocab/${due[0].id}/review`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ knew: true, today: '2026-05-02' }) });
  assert.equal((await res.json()).box, 2);
});

test('pitch CRUD over the API', async () => {
  const app = createApp({ interviewDir: dir(), botToken: BOT, staticDir: null });
  const auth = { Authorization: `tma ${sign({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 1 }) })}` };
  await app.request('/api/pitch/default.md', { method: 'PUT', headers: auth, body: '# Pitch' });
  const list = await (await app.request('/api/pitch', { headers: auth })).json();
  assert.deepEqual(list, ['default.md']);
});
```

- [ ] **Step 2: Run, verify fail** — FAIL (routes missing).

- [ ] **Step 3: Implement** — add these routes inside `createApp`, after the existing `/api/sources*` routes and before `app.onError`:

```js
  app.get('/api/vocab/due', (c) => c.json(store.vocabDue(c.req.query('today') || undefined)));
  app.get('/api/vocab/all', (c) => c.json(store.vocabAll()));
  app.post('/api/vocab', async (c) => c.json(store.vocabAdd(await c.req.json())));
  app.post('/api/vocab/:id/review', async (c) => { const { knew, today } = await c.req.json(); return c.json(store.vocabReview(c.req.param('id'), !!knew, today)); });
  app.get('/api/pitch', (c) => c.json(store.listPitch()));
  app.get('/api/pitch/:name', (c) => c.text(store.readPitch(c.req.param('name'))));
  app.put('/api/pitch/:name', async (c) => { store.writePitch(c.req.param('name'), await c.req.text()); return c.json({ ok: true }); });
  app.delete('/api/pitch/:name', (c) => { store.deletePitch(c.req.param('name')); return c.json({ ok: true }); });
  app.get('/api/pitch-history', (c) => c.json(store.pitchHistory()));
```

- [ ] **Step 4: Run, verify pass** — PASS (19 total).

- [ ] **Step 5: commit**

```bash
cd "$REPO" && git add mini-app/server/server.mjs mini-app/server/test/server.test.mjs && git commit -m "feat: vocab + pitch + pitch-history API routes"
```

---

# Track C — Web app: Vocab + Pitch tabs

## Task C1: Extend `api.ts` + `types.ts`

**Files:** Edit `$REPO/mini-app/web/src/api.ts`, `types.ts`

- [ ] **Step 1: `types.ts` add**

```ts
export interface VocabCard { id: string; term: string; context: string; box: number; next_review: string | null; source: string; meaning?: string; examples?: string[]; }
export interface PitchPoint { date: string; overall: number; }
```

- [ ] **Step 2: `api.ts` add to the `api` object**

```ts
  vocabDue: () => req('/vocab/due').then((r) => r.json() as Promise<VocabCard[]>),
  vocabAll: () => req('/vocab/all').then((r) => r.json() as Promise<VocabCard[]>),
  vocabAdd: (term: string, context: string) => req('/vocab', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ term, context }) }).then((r) => r.json()),
  vocabReview: (id: string, knew: boolean) => req(`/vocab/${encodeURIComponent(id)}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ knew }) }).then((r) => r.json() as Promise<VocabCard>),
  pitchList: () => req('/pitch').then((r) => r.json() as Promise<string[]>),
  pitchGet: (n: string) => req(`/pitch/${encodeURIComponent(n)}`).then((r) => r.text()),
  pitchPut: (n: string, body: string) => req(`/pitch/${encodeURIComponent(n)}`, { method: 'PUT', body }).then((r) => r.json()),
  pitchDelete: (n: string) => req(`/pitch/${encodeURIComponent(n)}`, { method: 'DELETE' }).then((r) => r.json()),
  pitchHistory: () => req('/pitch-history').then((r) => r.json() as Promise<PitchPoint[]>)
```
Add `import type { VocabCard, PitchPoint } from './types';` to the existing type import line.

- [ ] **Step 3: commit** — `git add mini-app/web/src/api.ts mini-app/web/src/types.ts && git commit -m "feat: web api/types for vocab + pitch"`

---

## Task C2: `Vocab.tsx` (due queue + swipe + all list + add)

**Files:** Create `$REPO/mini-app/web/src/tabs/Vocab.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { VocabCard } from '../types';

export default function Vocab() {
  const [due, setDue] = useState<VocabCard[]>([]);
  const [i, setI] = useState(0);
  const [reveal, setReveal] = useState(false);
  const [all, setAll] = useState<VocabCard[]>([]);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');

  const loadAll = () => api.vocabAll().then(setAll).catch((e) => setMsg(String(e.message)));
  useEffect(() => { api.vocabDue().then(setDue).catch((e) => setMsg(String(e.message))); loadAll(); }, []);

  const card = due[i];
  const grade = async (knew: boolean) => {
    if (!card) return;
    try { await api.vocabReview(card.id, knew); setReveal(false); setI(i + 1); loadAll(); }
    catch (e) { setMsg(String((e as Error).message)); }
  };
  const add = async () => {
    const term = prompt('Term?'); if (!term) return;
    const context = prompt('Context sentence?') || '';
    try { await api.vocabAdd(term, context); loadAll(); } catch (e) { setMsg(String((e as Error).message)); }
  };

  return (
    <>
      <h3>Review {due.length ? `(${Math.min(i + 1, due.length)}/${due.length})` : ''}</h3>
      {msg && <p style={{ color: 'var(--tg-hint-color)' }}>{msg}</p>}
      {card ? (
        <div className="row" style={{ textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: 13, color: 'var(--tg-hint-color)' }}>{card.context}</div>
          <div style={{ fontSize: 22, margin: '12px 0' }}><b>{card.term}</b></div>
          {reveal
            ? <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button onClick={() => grade(false)}>❌ Missed</button>
                <button className="primary" onClick={() => grade(true)}>✅ Knew it</button>
              </div>
            : <button className="primary" onClick={() => setReveal(true)}>Reveal</button>}
        </div>
      ) : <p style={{ color: 'var(--tg-hint-color)' }}>No cards due. 🎉</p>}

      <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between' }}>
        <b>All vocab ({all.length})</b><button onClick={add}>+ Add</button>
      </div>
      <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', margin: '6px 0' }} />
      {all.filter((c) => c.term.toLowerCase().includes(q.toLowerCase())).map((c) => (
        <div key={c.id} className="row"><span className="pill">box {c.box}</span> <b>{c.term}</b> <small style={{ color: 'var(--tg-hint-color)' }}>{c.context}</small></div>
      ))}
    </>
  );
}
```

- [ ] **Step 2: typecheck** — (after App.tsx wiring in C4) — defer to C4.
- [ ] **Step 3: commit** — `git add mini-app/web/src/tabs/Vocab.tsx && git commit -m "feat: Vocab tab (SRS review + all-vocab list + add)"`

---

## Task C3: `Pitch.tsx` (variants editor + history sparkline)

**Files:** Create `$REPO/mini-app/web/src/tabs/Pitch.tsx`

- [ ] **Step 1: Implement** (editor mirrors the existing Workspace tab's pattern; sparkline is an inline SVG)

```tsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { PitchPoint } from '../types';

function Sparkline({ pts }: { pts: PitchPoint[] }) {
  if (pts.length < 2) return <small style={{ color: 'var(--tg-hint-color)' }}>Not enough history yet.</small>;
  const w = 220, h = 40, max = 10, min = 0;
  const step = w / (pts.length - 1);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(h - ((p.overall - min) / (max - min)) * h).toFixed(1)}`).join(' ');
  return <svg width={w} height={h} style={{ display: 'block' }}><path d={d} fill="none" stroke="var(--tg-button-color)" strokeWidth="2" /></svg>;
}

export default function Pitch() {
  const [files, setFiles] = useState<string[]>([]);
  const [sel, setSel] = useState(''); const [body, setBody] = useState('');
  const [hist, setHist] = useState<PitchPoint[]>([]); const [msg, setMsg] = useState('');

  const loadList = () => api.pitchList().then(setFiles).catch((e) => setMsg(String(e.message)));
  useEffect(() => { loadList(); api.pitchHistory().then(setHist).catch(() => {}); }, []);

  const open = async (f: string) => { try { const t = await api.pitchGet(f); setSel(f); setBody(t); } catch (e) { setMsg(String((e as Error).message)); } };
  const save = async () => { try { await api.pitchPut(sel, body); setMsg('saved'); } catch (e) { setMsg(String((e as Error).message)); } };
  const create = async () => { const n = prompt('New variant filename (e.g. design-system.md)?'); if (!n) return; try { await api.pitchPut(n.endsWith('.md') ? n : n + '.md', '# New pitch\n'); await loadList(); } catch (e) { setMsg(String((e as Error).message)); } };
  const del = async () => { if (!sel || !confirm(`Delete ${sel}?`)) return; try { await api.pitchDelete(sel); setSel(''); setBody(''); await loadList(); } catch (e) { setMsg(String((e as Error).message)); } };

  return (
    <>
      <h3>Score history</h3><Sparkline pts={hist} />
      {msg && <p style={{ color: 'var(--tg-hint-color)' }}>{msg}</p>}
      <div style={{ margin: '12px 0', display: 'flex', gap: 8 }}>
        <b style={{ flex: 1 }}>Variants</b><button onClick={create}>+ New</button>
        {sel && <><button className="primary" onClick={save}>Save</button><button onClick={del}>Delete</button></>}
      </div>
      <div>{files.map((f) => <button key={f} className="pill" style={{ fontWeight: sel === f ? 700 : 400 }} onClick={() => open(f)}>{f}</button>)}</div>
      {sel && <textarea value={body} onChange={(e) => setBody(e.target.value)} />}
      <p style={{ color: 'var(--tg-hint-color)', marginTop: 12 }}>To drill a pitch, ask Coach in the chat (e.g. "drill my {sel || 'default'} pitch").</p>
    </>
  );
}
```

- [ ] **Step 2: commit** — `git add mini-app/web/src/tabs/Pitch.tsx && git commit -m "feat: Pitch Studio tab (variants editor + score sparkline)"`

---

## Task C4: Wire 4 tabs + coverage summary; typecheck + build

**Files:** Edit `$REPO/mini-app/web/src/App.tsx`, `tabs/Sessions.tsx`

- [ ] **Step 1: `App.tsx` — 4 tabs**

```tsx
import { useState } from 'react';
import Sessions from './tabs/Sessions';
import Pitch from './tabs/Pitch';
import Vocab from './tabs/Vocab';
import Workspace from './tabs/Workspace';

type Tab = 'sessions' | 'pitch' | 'vocab' | 'workspace';
export default function App() {
  const [tab, setTab] = useState<Tab>('sessions');
  const tabs: [Tab, string][] = [['sessions', 'Sessions'], ['pitch', 'Pitch'], ['vocab', 'Vocab'], ['workspace', 'Workspace']];
  return (
    <>
      <div className="screen">
        {tab === 'sessions' && <Sessions />}{tab === 'pitch' && <Pitch />}
        {tab === 'vocab' && <Vocab />}{tab === 'workspace' && <Workspace />}
      </div>
      <nav className="tabbar" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
    </>
  );
}
```

- [ ] **Step 2: `Sessions.tsx` — add a tiny coverage summary** above the search input (counts per format from the loaded `items`):

```tsx
// Insert just before the <input> in the returned JSX:
{items.length > 0 && (
  <div style={{ fontSize: 12, color: 'var(--tg-hint-color)', marginBottom: 8 }}>
    {Object.entries(items.reduce((a, s) => { a[s.format] = (a[s.format] || 0) + 1; return a; }, {} as Record<string, number>))
      .map(([f, n]) => `${f}: ${n}`).join(' · ')}
  </div>
)}
```

- [ ] **Step 3: typecheck + build** — `cd "mini-app/web" && npx tsc --noEmit && npm run build` — Expected: clean; `dist/` rebuilt.

- [ ] **Step 4: commit** — `git add mini-app/web/src/App.tsx mini-app/web/src/tabs/Sessions.tsx && git commit -m "feat: 4-tab nav (add Pitch + Vocab) and coverage summary"`

---

## Task D: Local smoke + Phase 3 runbook additions

- [ ] **Step 1: Full server test suite** — `cd "mini-app/server" && node --test` — expect all green (~19). `cd "skills/interview-drill/scripts" && node --test` — expect all green (Phase 1 + vocab tests).
- [ ] **Step 2: Build SPA** — `cd "mini-app/web" && npm run build`.
- [ ] **Step 3: Local smoke** (server serves the new routes; auth still gates):
```bash
cd "$REPO/mini-app/server"
COACH_BOT_TOKEN=dummy INTERVIEW_DIR=/tmp/iv3 STATIC_DIR="$REPO/mini-app/web/dist" PORT=8445 node server.mjs & SRV=$!; sleep 1
curl -s -o /dev/null -w "/ %{http_code}\n" http://127.0.0.1:8445/
curl -s -o /dev/null -w "/api/vocab/due %{http_code}\n" http://127.0.0.1:8445/api/vocab/due   # expect 401 (no auth)
kill $SRV
```
Expected: `/ 200`, `/api/vocab/due 401`.

### YOUR live runbook additions (run after Phase 1 + 2 are live)
- [ ] **Migrate vocab once** (dry-run first):
```bash
node "$REPO/skills/interview-drill/scripts/vocab_migrate.mjs" --log "$HOME/.openclaw/workspace-speaker/vocabulary_log.md" --store "$HOME/.openclaw/workspace-speaker/interview/vocab.json" --dry-run
# then for real (drop --dry-run):
node "$REPO/skills/interview-drill/scripts/vocab_migrate.mjs" --log "$HOME/.openclaw/workspace-speaker/vocabulary_log.md" --store "$HOME/.openclaw/workspace-speaker/interview/vocab.json"
```
- [ ] **Seed a pitch variant** (optional): create `$HOME/.openclaw/workspace-speaker/interview/pitch/default.md` (or do it in the Pitch tab).
- [ ] **Restart the Mini App server** (Phase 2's process) so it picks up the new routes; rebuild the SPA (`npm run build`) so the new tabs ship. The OpenClaw gateway does NOT need restarting for vocab cards (the skill's `vocab_cli` runs via `exec`).

---

## Self-Review (controller, before execution)
- Vocab SRS logic is one shared module (`shared/vocab.mjs`), TDD'd, imported by both the skill CLI and the server — no duplicated Leitner math.
- Migration is non-destructive (merges, dedupes) and has a `--dry-run`.
- Pitch Studio is edit+history only (matches the decision); drilling stays in chat.
- New server routes are auth-gated (they sit behind the existing `/api/*` middleware) and tested.
- Frontend: real code for both tabs; verified by typecheck + build + visual QA in Telegram.

## Phase 3 Done — Definition of Done
- `skills/interview-drill/scripts` + `mini-app/server` test suites green; web typechecks + builds.
- Local smoke: SPA 200, unauthed vocab route 401.
- After the live runbook: Vocab tab shows due cards and advances them on review; Pitch tab lists/edits variants and shows the score sparkline; weak vocab from new drills appears as structured cards.

**Project complete after Phase 3** — all three spec phases planned (1 + 2 built; 3 ready). Future ideas live in spec §12 (v2).
