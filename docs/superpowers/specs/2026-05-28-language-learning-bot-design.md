# English Interview Coach — Design Spec

**Date:** 2026-05-28
**Status:** Approved (design phase complete)
**Owner:** Nick Vyhouski

## 1. Purpose

A personal English-language interview-prep tool for a senior product designer. It is **not** a Duolingo-style product for an audience — it is a single-user coach tailored to Nick, focused on the three things he needs most:

1. **Speaking practice** — the weakest area, the top priority
2. **Interview-specific vocabulary** — the language used in design interviews
3. **Pitch + skill articulation** — delivering a personal narrative and calling out specific skills fluently

Delivered as a **Telegram bot** (`@Nxspeakingcoachbot`) for the daily voice-practice loop, plus a **lightweight Telegram Mini App** for the things tap beats voice (flashcards, pitch editing, history, settings). Built as a new agent inside the user's existing **OpenClaw** framework — not as standalone cloud infrastructure.

## 2. Goals & Non-Goals

### Goals
- Sustainable **daily speaking reps** over a 6–12 month horizon (open-ended skill-building, not a cram-before-one-interview sprint)
- Practice across **all interview formats**: portfolio walkthrough, behavioral, design critique, whiteboard, hiring-manager screen
- **Personalized from day one** — questions reference Nick's actual portfolio, pitch, and project case studies
- **Medium-depth feedback** per answer: transcript, 2–3 rephrases, model answer (text + audio), 1–5 score
- Run on **hardware Nick already owns** (Mac Studio), reusing OpenClaw's channel/auth/cron/TTS — near-zero new cloud spend

### Non-Goals
- Multi-user support, signup flows, onboarding funnels, growth loops, monetization
- A rigid curriculum / course tree (Nick already knows what design interviews are)
- Aggressive gamification (no hearts, leagues, shame-based streaks)
- Native iOS app (too much effort for a personal tool)
- Pronunciation scoring in v1 (deferred to v2)

## 3. Users & Success Criteria

**User:** Nick Vyhouski — senior startup product designer, 14+ years experience, advanced English (non-native), preparing for design interviews. Comfortable speaking but wants to sharpen fluency, vocabulary, and structured delivery.

**Success looks like:**
- Nick answers ≥1 interview question by voice most weekdays
- Average answer score trends up over weeks
- Vocabulary queue grows from real gaps and gets reviewed
- Pitch variants get measurably tighter (score history per variant improves)
- The tool feels like a calm daily habit, not a chore

## 4. Architecture (OpenClaw-native)

The system is a new agent inside OpenClaw (the user's personal-AI framework running on the Mac Studio). OpenClaw provides the Telegram channel, multi-agent routing, cron, TTS (ElevenLabs), skills system, and an OpenAI model profile with failover.

### Components

**1. Agent: `english-coach`**
- Workspace: `workspace-english-coach/`
- Bound to its own BotFather bot `@Nxspeakingcoachbot` via OpenClaw multi-agent routing
- Tools enabled: `cron`, `read`, `write`, `exec`, `tts`, `memory_*`, plus the Telegram channel send/receive

**2. Skill bundle: `interview-drill`** (packaged via OpenClaw's skills system)
- `dailyQuestion()` — sample format + focus, RAG against sources, generate question, DM via bot
- `scoreAnswer()` — STT → GPT scoring → format feedback → TTS model answer
- `extractVocab()` — pull weak words/phrases from rephrases into the SRS queue
- `drillPitch()` — load a pitch variant and run targeted Q&A
- `reindexSources()` — chunk + embed source files into the vector store

**3. Voice pipeline**
- **STT:** local `faster-whisper-base` on the Mac (free; `parakeet-tdt-0.6b-v3` as a higher-quality option)
- **Reasoning/scoring/question-gen:** OpenAI `gpt-4o` via OpenClaw's OpenAI profile, with model failover (local Gemma 31B as degraded fallback for question generation)
- **TTS:** ElevenLabs (existing key) for model-answer audio

**4. Mini App**
- React + Vite + `@telegram-apps/sdk`, theme-aware via `themeParams`
- Served by OpenClaw's web surface / the agent, exposed over HTTPS via **Cloudflare Tunnel** or **Tailscale Funnel** (Telegram requires HTTPS)
- Same origin as the agent's API → no CORS
- Auth via Telegram `initData` + server-side HMAC-SHA256 verification

**5. Storage (all local to the workspace)**
- `sources/` — git clone of `github.com/weeeha/nicks-bio` (single source of truth), optionally augmented with scraped `vyhouski.com` project content
- `state.db` — SQLite: sessions, vocab queue (Leitner boxes), scores, pitch-variant metadata, settings
- `vectors.db` — embeddings (SQLite + `sqlite-vss`; pgvector acceptable if local Postgres preferred)
- `audio/` — voice-in + TTS-out files (30-day TTL unless pinned)

### Why OpenClaw-native (vs. Vercel/Neon)
- Zero new cloud spend; data stays on Nick's Mac
- Reuses channel, auth, cron, TTS, model failover — much less to build
- Local Whisper = free STT vs. ~$0.006/min API
- Failover and daemon lifecycle already handled by OpenClaw

### Assumptions to verify during planning
The architecture above infers OpenClaw capabilities from its README and infrastructure notes. Before/while writing the implementation plan, verify against OpenClaw's actual docs and source:
- **Skill API** — how a workspace/managed skill is authored (language, entry points, how it receives messages and calls tools); whether a skill can register cron callbacks and inline-keyboard handlers
- **Multi-agent routing** — how a specific Telegram bot account (`@Nxspeakingcoachbot`) is bound to a specific agent + workspace
- **Web surface hosting** — whether OpenClaw can serve the Mini App's static bundle + API on a stable HTTPS origin (web surface vs. agent-served vs. external static host + tunnel), and how `initData` verification fits
- **`exec` tool** — running `faster-whisper` as a subprocess from a skill; sandbox implications for a non-`main` agent
- **TTS tool** — invoking ElevenLabs for arbitrary text and getting back an audio file to attach to a Telegram voice message
- **Cron tool** — timezone handling, skip-weekends, and behavior when the daemon was asleep at fire time
- **Telegram media** — receiving voice messages and sending voice/audio replies through OpenClaw's Telegram channel abstraction

These are planning-phase research targets, not open design questions — the design holds regardless of the answers; only the *implementation mechanics* depend on them.

## 5. Personalization & RAG

### Source material (in `sources/`, from `nicks-bio`)
The bio repo is already structured usefully: `nick-vyhouski-brief.md`, `case-study-answers.md`, `about-page.md`, `questionnaire.md`, `vibefolio.md`, etc. These map to:
- **Portfolio overview** — who Nick is professionally, design philosophy, goals
- **Pitch script(s)** — the 60–90s "tell me about yourself," with variants per audience (design-system role, IC vs. lead, etc.)
- **Project case studies** — context, role, problem, process, decisions, outcomes, lessons; tagged with skills (research, design-system, prototyping, leadership) so questions can target gaps

### Ingestion flow
1. Agent clones `nicks-bio` into `sources/` at boot; `git pull` on schedule (or manual "Sync from GitHub")
2. `reindexSources()` chunks at heading boundaries → embeds via `text-embedding-3-small` → stores in `vectors.db`
3. Sidecar metadata: chunk → file → section heading → skill tags

### Retrieval at question time
1. Sample interview format (weighted: portfolio 40% / behavioral 25% / critique 15% / whiteboard 10% / hiring-manager 10% — configurable)
2. Sample focus (a project, a skill, or a pitch variant; weighted by recency to emphasize least-practiced)
3. Retrieve top-K chunks from relevant sources
4. Build prompt: system rules + retrieved context + recent session history (anti-repeat) + generate question

### Not in RAG (lives in `state.db`)
Past sessions, vocab queue, settings, pitch-variant score history.

## 6. Daily Drill Loop

### Morning trigger (default 8:30 local, skip weekends, configurable)
1. OpenClaw cron → `interview-drill.dailyQuestion()`
2. Sample format + focus (per §5 weighting)
3. Retrieve RAG chunks + recent history (anti-repeat)
4. Generate question via GPT-4o
5. Bot DMs via `@Nxspeakingcoachbot`: voice (TTS) + text + inline keyboard:
   - `🎤 Answer by voice` · `📝 Answer by text` · `⏭️ Skip` · `🔄 Different`

### On voice reply
1. Download voice file from Telegram
2. Local `faster-whisper` STT → transcript
3. GPT-4o scoring → structured JSON: `score` (1–5), `rephrases` (2–3), `model_answer` (text), `weak_vocab` (list)
4. Bot replies: your transcript · rephrases · model answer (text + TTS audio) · score · inline keyboard:
   - `🔁 Try again` · `📌 Save vocab` · `🎯 Go deeper` · `✅ Done`
5. Background: `weak_vocab` enqueued in SRS; session logged in `state.db`

### On-demand
- `🎯 Go deeper` → full rubric (fluency, vocab range, structure, content depth) for that answer
- `🔁 Try again` → same question, new attempt; both scores recorded
- `📌 Save vocab` → manual addition beyond auto-extracted
- `/more` → request another question the same day (per-day target adjustable in settings)

### Weekly (Sundays)
Summary DM: questions answered, avg score, vocab queue size, weak areas (low-scoring formats/skills), suggested focus. Link to Mini App.

### Engagement (Babbel-style, not Duolingo-style)
- Daily completion = answer ≥1 question fully
- Streak counter visible but never weaponized (no shame, no paywalled freeze)
- Missed days delay next prompt by half a day; after 5+ missed in a row, bot asks "everything OK? want to pause for a week?" (opt-in re-engagement)

## 7. Mini App (4 screens)

Bottom tab bar, 4 tabs.

### Tab 1 — Sessions (default landing)
- Newest-first list; each row: date, truncated question, score, format pill, focus pill
- Filter chips: All / Portfolio / Behavioral / Critique / Whiteboard / Hiring Manager
- Tap → detail: question (text + play voice), your answer (transcript + play voice), rephrases, model answer (text + play TTS), score, weak vocab; actions `🔁 Re-do` · `📌 Pin` · `🎯 Go deeper`
- Search by question text or project

### Tab 2 — Pitch Studio
- List of pitch variants
- Tap → full-screen markdown editor (save → auto-reindex)
- `Drill this pitch` → bot starts focused Q&A on this variant
- Score-history sparkline per variant
- `Generate a variant` → bot helps create a variant for a different role/audience
- `+ New variant`

### Tab 3 — Vocab
- SRS queue front-and-center: "N cards to review today"
- Card front: word/phrase in original sentence context; back: meaning, alternative phrasings, examples, TTS audio
- Swipe right = knew it (advance Leitner box) · swipe left = missed (reset to box 1)
- "All vocab" list: filter by source (auto vs. manual), search; `+ Add` manual entry
- (Pronunciation "🎤 Say it" deferred to v2)

### Tab 4 — Workspace
- File browser mirroring `sources/`
- Tap file → markdown editor with preview toggle; **save = local only**, with a manual `Push to GitHub` button per file (bot does not silently own the bio repo)
- `Sync from GitHub` button (manual `git pull`)
- **Skills coverage** viz — which skills the projects cover, which are underrepresented
- **Settings:** daily nudge time, skip-weekends toggle, format-weight sliders, per-day target (1–5), TTS voice selection, full JSON data export

## 8. Data Model (`state.db`)

- **sessions** — id, ts, format, focus_ref, question_text, question_audio_path, answer_mode (voice/text), answer_transcript, answer_audio_path, score, rephrases (json), model_answer_text, model_answer_audio_path, weak_vocab (json), pinned (bool), deep_rubric (json, nullable)
- **vocab** — id, term, context_sentence, meaning, alt_phrasings (json), examples (json), source (auto/manual), leitner_box (1–6), next_review_ts, created_ts
- **pitch_variants** — id, slug, title, audience, file_path, last_drilled_ts, score_history (json)
- **settings** — singleton row: nudge_time, skip_weekends, format_weights (json), per_day_target, tts_voice_id, timezone
- **sync_state** — last_git_sha, last_reindex_ts, last_good_index (bool)

`vectors.db` — chunk_id, file, heading, skill_tags (json), embedding (vector), text.

## 9. Error Handling & Edge Cases

**Voice input:** >5 min → truncate + warn; silent/unintelligible (Whisper confidence < threshold) → "couldn't hear that, try again?"; text sent instead → skip STT; sticker/image/file → "I need voice or text for this question."

**GPT scoring:** OpenAI down → OpenClaw model failover (local Gemma for question gen; lighter scoring prompt); JSON parse fail → one retry with stricter schema, else ungraded feedback (never block user); token overflow → truncate RAG context first.

**Availability:** Mac asleep at cron time → missed nudge queues, fires on wake with "missed yesterday" note; tunnel down → Mini App unreachable but bot keeps working; bot webhook fail → OpenClaw retries/queues.

**Source repo:** `nicks-bio` broken/empty → use last good index, DM warning; `vectors.db` corrupted → rebuild from `sources/` on next boot.

**Data hygiene:** audio TTL 30 days unless pinned; `state.db` nightly backup (last 7 days); full JSON export from Settings.

## 10. Testing

Personal tool → minimal but real:
- **Unit tests** — scoring prompt → valid JSON schema; Leitner SRS box transitions; weighted format/focus sampling distribution
- **Smoke test** — scripted end-to-end run (canned question + canned voice file) to catch pipe breakage after refactors
- **Manual QA** — daily real-world use surfaces bugs immediately

No product-grade suite. Run smoke + units before each deploy.

## 11. Phased Rollout

**Phase 1 — Daily drill loop, bot only (~2 weekends)**
Agent + bot routing; `dailyQuestion()` + `scoreAnswer()`; sources cloned + indexed once (manual reindex); cron 8:30 skip-weekends; voice → Whisper → GPT-4o → feedback + TTS; `state.db` collecting sessions + vocab (not yet reviewable); settings hardcoded. **Ships a working daily habit with no Mini App.**

**Phase 2 — Mini App: Sessions + Workspace (~2–3 weekends)**
React/Vite scaffold + SDK; tunnel HTTPS; `initData` HMAC auth; Tab 1 + Tab 4; settings UI; "Sync from GitHub" replaces clone-on-boot. **Review history, edit sources, tune settings from phone.**

**Phase 3 — Pitch Studio + Vocab (~2–3 weekends)**
Tab 2 (pitch editor, drill mode, score sparkline); Tab 3 (SRS UI, swipe cards, all-vocab browser); vocab clustering/dedupe; skills-coverage viz. **Full system.**

## 12. Future (v2, after ~1 month of daily use)

Pronunciation practice on vocab cards · weekly summary refinements · skills-gap-driven question weighting · auto-push to GitHub from Workspace · mock-interview mode (10–15 min sustained role-play) · per-session JD/role targeting ("today I'm interviewing at Stripe for the design-system role").
