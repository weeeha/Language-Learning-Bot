# English Interview Coach — Design Spec

**Date:** 2026-05-28
**Status:** Approved (design phase complete; revised after OpenClaw research)
**Owner:** Nick Vyhouski

> **Key decision (revised 2026-05-28):** This is **not** a new standalone agent. It **extends the existing `speaker` agent ("Coach 🗣️")** in `~/.openclaw/workspace-speaker/`, which already runs daily vocabulary drops (with spaced repetition) and reactive pitch coaching. We add a new **`interview-drill` skill** (+ RAG personalization + a later Mini App), reusing Coach's bot (`@Nxspeakingcoachbot`, botId `8781119158`), persona, `vocabulary-trainer` + `pitch-coach` skills, cron, and TTS.

## 1. Purpose

A personal English interview-prep capability for a senior product designer, added to his existing OpenClaw "Coach" agent. Focus on the three things he needs most:

1. **Speaking practice** — the weakest area, the top priority
2. **Interview-specific vocabulary** — already partly served by Coach's `vocabulary-trainer`; we feed it interview gaps
3. **Pitch + skill articulation** — already partly served by Coach's `pitch-coach`; we add personalized, format-varied question drills

Delivered through Coach's existing **Telegram bot** (`@Nxspeakingcoachbot`) for the daily voice loop, plus a **lightweight Telegram Mini App** (later phase) for flashcards, pitch editing, history, and settings.

## 2. Goals & Non-Goals

### Goals
- Sustainable **daily speaking reps** over a 6–12 month horizon (open-ended, not a one-interview cram)
- Practice across **all interview formats**: portfolio walkthrough, behavioral, design critique, whiteboard, hiring-manager screen
- **Personalized from day one** via RAG over Nick's real bio/portfolio (`github.com/weeeha/nicks-bio`)
- **Medium-depth feedback** per answer: transcript, 2–3 rephrases, model answer (text + audio), 1–5 score
- **Reuse, don't duplicate** — build on Coach's working vocab/pitch habit rather than a parallel agent
- Run on hardware Nick already owns (Mac Studio), near-zero new cloud spend

### Non-Goals
- A new/separate agent (explicitly rejected — extend Coach)
- Multi-user, signup, onboarding funnels, growth loops, monetization
- A rigid curriculum / course tree
- Aggressive gamification (no hearts, leagues, shame-based streaks)
- Native iOS app
- Pronunciation scoring in v1 (Coach already has a `pronunciation-coach` skill; deeper scoring deferred to v2)

## 3. Users & Success Criteria

**User:** Nick Vyhouski — senior startup product designer, 14+ years, advanced (non-native) English, preparing for design interviews. Already uses Coach daily.

**Success looks like:**
- Nick answers ≥1 interview question by voice most weekdays
- Average answer score trends up over weeks
- Vocabulary queue grows from real interview gaps and gets reviewed (via existing `vocabulary-trainer`)
- Pitch variants get measurably tighter (pitch-coach score history improves)
- Feels like a calm extension of an existing daily habit, not a new chore

## 4. Architecture (extend Coach inside OpenClaw)

### How OpenClaw actually works (verified findings — research 2026-05-28)
- **Skills are `SKILL.md` instruction files, not code modules.** The agent (LLM) reads the markdown and orchestrates real tools (`exec`, `tts`, `message`, `read`, `write`, `cron`). Deterministic work lives in bundled `scripts/` that the agent runs via `exec`. Skills live in `<workspace>/skills/<name>/SKILL.md`.
- **Inbound voice is auto-transcribed** by OpenClaw's "media understanding" pipeline *before* the agent turn — the transcript is already in the prompt. **Our skill needs no STT code.** (Currently configured to cloud `gpt-4o-mini-transcribe`; a local Whisper CLI path exists if we want fully-local later.)
- **Agent + routing config** lives in `~/.openclaw/openclaw.json`: `agents.list[]` (Coach = `id:"speaker"`), `channels.telegram.accounts.<id>` (bot token), `bindings[]` (account→agent). Coach is already wired to `@Nxspeakingcoachbot`.
- **Cron** is a gateway scheduler: jobs in `~/.openclaw/cron/jobs.json` with `schedule.expr` (cron) + `tz`, `agentId`, `sessionTarget:"isolated"`, and a `payload.message` that instructs the agent. **No catch-up if the Mac was asleep at fire time** — a missed fire is skipped, not replayed.
- **TTS** active provider is **OpenAI** (`gpt-4o-mini-tts`, voice "nova"); the `tts` tool auto-delivers as a Telegram **voice note**. ElevenLabs key exists but isn't the selected provider (switchable later).
- **Inline keyboards** work but must be enabled (`channels.telegram.capabilities.inlineButtons`); button presses return to the agent as text `callback_data: <value>`. **Voice notes can't carry buttons in the same message** — send audio, then a separate text+buttons message.
- **`exec`** runs freely for non-main agents under the current permissive policy; scripts run on the host.

### Components (what we build / change)

**1. New skill: `workspace-speaker/skills/interview-drill/SKILL.md`**
Instructions teaching Coach how to: pick today's format+focus, generate a personalized question, send it, receive the voice answer (transcript auto-provided), score it, format medium feedback, send model-answer TTS, log the session, and enqueue weak vocab into the existing `vocabulary-trainer` flow.

**2. Bundled scripts: `workspace-speaker/skills/interview-drill/scripts/`** (Node ESM, run via `exec`)
- `pick_drill.mjs` — weighted format/focus sampling + anti-repeat (reads session log)
- `rag_index.mjs` — chunk `sources/` markdown, embed via OpenAI `text-embedding-3-small`, cache to `vectors.json` (re-embed only on content-hash change)
- `rag_query.mjs` — embed a query, brute-force cosine over cached vectors, return top-K chunks (no vector DB — corpus is ~10 files)
- `score_answer.mjs` — call OpenAI API directly with `response_format: json_schema` (strict) → `{score, rephrases[], model_answer, weak_vocab[]}`. **Reads the OpenAI key from env, never from logged config.**
- `log_session.mjs` — append a structured session record (written by the agent via the `write` tool) as one line to `sessions.jsonl`

Inputs that contain arbitrary text (the question, the STT transcript, the retrieved context) are passed to scripts as **files** the agent writes via the `write` tool, never as shell arguments — so speech text with quotes/newlines can't break quoting.

**3. State: `workspace-speaker/interview/`**
- `sources/` — git clone of `weeeha/nicks-bio` (single source of truth); `git pull` on a schedule or manual
- `vectors.json` — cached embeddings
- `sessions.jsonl` — append-only structured session log (drives progress + the future Mini App)
- `settings.json` — format weights, nudge time, per-day target, tz
- Weak vocab is appended into Coach's existing `vocabulary_log.md` / word-list flow (reuse, don't fork)

**4. Cron job** — `interview-drill`, `agentId:"speaker"`, `schedule.expr:"30 8 * * 1-5"`, `tz`, `sessionTarget:"isolated"`, `payload.message` instructing Coach to run the drill, `toolsAllow:["exec","tts","message"]`.

**5. Config change** — enable `channels.telegram.capabilities.inlineButtons` (scoped to the Coach account).

**6. Mini App (later phase)** — React + Vite + `@telegram-apps/sdk`. Served by a **small standalone local server** (static bundle + JSON API together), exposed via **Tailscale Funnel** or `cloudflared`, kept **off** the OpenClaw gateway (coupling it would force a password on the whole agent fleet). Auth via Telegram `initData` HMAC-SHA256 using Coach's bot token. Reads/writes the same `workspace-speaker/interview/` state.

### Why extend Coach (vs. new agent)
Coach already nails ~70% of the design — daily vocab with SRS, pitch evaluation for interviews, pronunciation/grammar/writing, a working cron habit, and a bot. A separate agent would duplicate all of that and split daily practice across two bots. Extending reuses the working habit and adds only the genuinely new parts.

## 5. Personalization & RAG

### What's reused vs. new
- **Reused:** `vocabulary-trainer` (daily drops, 1→3→7→14-day SRS, topic word lists, `vocabulary_log.md`, `run_vocab_tts.py`); `pitch-coach` (5-dimension scoring, voice analysis, `pitch_history.md`).
- **New:** RAG over Nick's actual bio/portfolio so questions reference *his* projects (NextHealth, FraudFighter, ProPortals, Flow Builders), not generic prompts.

### Source material (`interview/sources/`, from `nicks-bio`)
The bio repo is already structured usefully: `nick-vyhouski-brief.md`, `case-study-answers.md`, `about-page.md`, `questionnaire.md`, `vibefolio.md`, etc. These supply portfolio overview, pitch material, and project case studies (tagged by skill so questions can target gaps).

### Ingestion & retrieval
1. Clone `nicks-bio` into `sources/`; `git pull` to refresh
2. `rag_index.mjs` chunks at heading boundaries → embeds (`text-embedding-3-small`) → caches `vectors.json` (re-embed on hash change only)
3. At question time: `pick_drill.mjs` chooses format (portfolio 40% / behavioral 25% / critique 15% / whiteboard 10% / hiring-manager 10%, configurable) + focus (project/skill/pitch, recency-weighted), then `rag_query.mjs` returns top-K chunks; Coach generates the question from that context + recent-history anti-repeat.

## 6. Daily Drill Loop

### Morning trigger (default 8:30 local, weekdays; configurable)
1. OpenClaw cron fires an isolated `agentTurn` for `speaker` with a prompt: "Run today's interview drill per `skills/interview-drill/SKILL.md`."
2. Coach runs `pick_drill.mjs` → format + focus; `rag_query.mjs` → context chunks
3. Coach generates one question; sends it via `message` + a `tts` voice note
4. Separate text message with inline buttons: `🎤 Answer by voice` · `📝 Answer by text` · `⏭️ Skip` · `🔄 Different` (voice notes can't carry buttons)

### On voice reply (next turn)
1. **Transcript is already in the prompt** (media-understanding) — no STT step
2. Coach runs `score_answer.mjs` with question + transcript + retrieved context → structured JSON `{score 1–5, rephrases[2–3], model_answer, weak_vocab[]}`
3. Coach replies: your transcript · rephrases · model answer (text) + `tts` voice note · score
4. Separate buttons message: `🔁 Try again` · `📌 Save vocab` · `🎯 Go deeper` · `✅ Done`
5. Append session to `sessions.jsonl`; append `weak_vocab` into Coach's `vocabulary_log.md`/word-list flow

### On-demand
- `🎯 Go deeper` → full rubric (fluency, vocab range, structure, content depth) for that answer (re-invokes scorer in a deeper mode)
- `🔁 Try again` → same question, new attempt; both scores recorded
- `📌 Save vocab` → manual add beyond auto-extracted
- `/more` → another question same day (per-day target adjustable)

### Cadence coexistence with existing vocab drop
Coach already drops daily vocab. The interview question is a separate, complementary nudge. Keep them as two light touches (or let Nick tune timing in settings) — not merged into one wall of text.

### Weekly (Sundays)
Summary DM: questions answered, avg score, vocab queue size, weak formats/skills, suggested focus. Link to Mini App (once it exists).

### Engagement (Babbel-style)
Daily completion = answer ≥1 question fully. Streak counter visible but never weaponized. After 5+ missed days, Coach asks "everything OK? want to pause?" (opt-in).

## 7. Mini App (4 screens) — later phase

Stack: React + Vite + `@telegram-apps/sdk`, theme-aware via `themeParams`. **Hosting:** standalone local server + Tailscale Funnel / `cloudflared`, off the gateway. **Auth:** `initData` HMAC-SHA256 (verify server-side; bot token from config/env, never shipped to client). Frontend sends `initDataRaw` in an `Authorization: tma <raw>` header.

### Tab 1 — Sessions (default landing)
Newest-first list (date, truncated question, score, format pill, focus pill); filter chips by format; tap → detail (question text+voice, your transcript+voice, rephrases, model answer text+TTS, score, weak vocab; actions `🔁 Re-do` · `📌 Pin` · `🎯 Go deeper`); search. Source: `sessions.jsonl`.

### Tab 2 — Pitch Studio
List of pitch variants → full-screen markdown editor (save → reindex); `Drill this pitch` (uses existing pitch-coach); score-history sparkline (from `pitch_history.md`); `Generate a variant`; `+ New variant`.

### Tab 3 — Vocab
SRS queue ("N cards to review today") from the existing `vocabulary-trainer` data; card front = term in original context, back = meaning/alt phrasings/examples/TTS; swipe right=knew/left=missed (drives existing 1→3→7→14 SRS); "All vocab" list + search; `+ Add`. (Pronunciation "🎤 Say it" deferred to v2.)

### Tab 4 — Workspace
File browser over `interview/sources/`; markdown editor with preview; **save = local only**, manual `Push to GitHub` per file; `Sync from GitHub` button; **Skills coverage** viz; **Settings** (nudge time, skip-weekends, format-weight sliders, per-day target 1–5, TTS voice, JSON export).

## 8. Data Model

**`sessions.jsonl`** (one JSON object per line): `id, ts, format, focus_ref, question_text, question_audio_path, answer_mode, answer_transcript, answer_audio_path, score, rephrases[], model_answer_text, model_answer_audio_path, weak_vocab[], pinned, deep_rubric?`

**`settings.json`**: `nudge_time, skip_weekends, format_weights{}, per_day_target, tts_voice, timezone`

**`vectors.json`**: array of `{chunk_id, file, heading, skill_tags[], text, embedding[1536]}` + a top-level `source_hashes{}` for incremental re-embed.

**Reused (existing Coach files):** `vocabulary_log.md`, `word_lists/*.md`, `pitch_history.md`.

## 9. Error Handling & Edge Cases

**Voice input:** transcript empty/garbled (media-understanding returns little) → "couldn't hear that, try again?"; user sends text → no transcript step needed; sticker/image → "I need voice or text."
**Scoring:** OpenAI error → retry once, then ungraded feedback (never block); JSON-schema parse fail → strict-mode retry, else ungraded; long answer → truncate RAG context first.
**Availability:** Mac asleep at cron time → drill **skipped** (no replay) — acceptable for a personal habit; Coach can note "missed yesterday" opportunistically.
**Source repo:** `nicks-bio` clone/pull fails → use last good `vectors.json`, warn; `vectors.json` missing/corrupt → `rag_index.mjs` rebuilds.
**Secrets:** scripts read keys from env only; never `cat`/log `openclaw.json`. (Root-caused from a research incident — five creds were rotated.)
**Data hygiene:** audio TTL 30 days unless pinned; `sessions.jsonl` is the durable log; JSON export from Settings.

## 10. Testing

- **Unit tests** (Node test runner) for the scripts: `rag_query` cosine ranking on fixture vectors; `pick_drill` weighting distribution + anti-repeat; `score_answer` JSON-schema validation + prompt assembly (OpenAI call mocked); `rag_index` chunking + hash-based cache skip.
- **Smoke test:** scripted end-to-end (canned question + canned transcript fixture) exercising `pick → query → score → format` without Telegram.
- **Manual QA:** daily real use surfaces bugs.
- Run unit + smoke before enabling the cron job.

## 11. Phased Rollout

**Phase 1 — `interview-drill` skill in Coach, bot-only (~2 weekends)**
Skill dir + scripts (`pick_drill`, `rag_index`, `rag_query`, `score_answer`) with unit tests; clone + index `nicks-bio`; `SKILL.md`; cron job (8:30 weekdays, isolated); enable inline buttons; smoke test. Voice in via media-understanding, scoring via OpenAI script, feedback + TTS out, sessions logged, weak vocab fed to existing vocab flow. **Ships a working daily interview drill on the existing bot.**

**Phase 2 — Mini App: Sessions + Workspace (~2–3 weekends)**
Standalone server (static + API) + tunnel; `initData` HMAC auth; Tab 1 + Tab 4; settings UI; GitHub sync button. **Review history, edit sources, tune settings from phone.**

**Phase 3 — Pitch Studio + Vocab (~2–3 weekends)**
Tab 2 (pitch editor + drill + sparkline over `pitch_history.md`); Tab 3 (SRS UI over `vocabulary-trainer` data); skills-coverage viz. **Full system.**

## 12. Future (v2)

Deeper pronunciation scoring · weekly-summary refinements · skills-gap-driven question weighting · auto-push to GitHub · mock-interview mode (10–15 min sustained role-play) · per-session JD/role targeting · optional fully-local STT (Whisper CLI) and ElevenLabs TTS switch.
