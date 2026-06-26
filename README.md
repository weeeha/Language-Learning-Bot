# Language-Learning-Bot

A language-/interview-practice assistant: a Telegram-driven English design-interview coach. It pairs a runnable skill that delivers a daily interview drill (pick a format, ask a question grounded in retrieved context, score the spoken/typed answer, log the session) with a Telegram Mini App for reviewing past sessions and editing the source documents the drill draws from.

> Note: the GitHub description frames this as a "language-learning chatbot." In the committed code the implemented feature is an **English design-interview drill** (skill `interview-drill`, package names `interview-mini-app-*`, `COACH_BOT_TOKEN`). The two phases below are what actually exists in the repo.

## What's in the repo

### `skills/interview-drill/`
An OpenClaw skill (`SKILL.md`) plus Node scripts (`scripts/`) that run a daily drill:
- `pick_drill.mjs` — choose a format (portfolio / behavioral / critique / whiteboard / hiring_manager) from settings + past sessions.
- `rag_index.mjs` / `rag_query.mjs` — build and query a local vector index (`openai` SDK embeddings) over the user's source notes.
- `score_answer.mjs` — score an answer and return rephrases, a model answer, and weak-vocab items.
- `log_session.mjs` — append the session to `sessions.jsonl`.
- `openai.mjs`, `lib.mjs`, `smoke.mjs` — shared OpenAI client, helpers, and a smoke check.

Scripts read `OPENAI_API_KEY` from the environment and operate on a state directory (`sources/`, `vectors.json`, `sessions.jsonl`, `settings.json`).

### `mini-app/server/`
A [Hono](https://hono.dev) HTTP server (`@hono/node-server`) exposing a JSON API over that same state directory: list sessions, read/update settings, list/read/write `sources/*.md`, and `git` sync/push of the sources. `/api/*` is authenticated by verifying Telegram Mini App `initData` (HMAC-SHA256 per the Telegram WebApp spec, `auth.mjs`). Optionally serves the built web app as a static SPA.

### `mini-app/web/`
A React 18 + Vite + TypeScript Telegram Mini App with two tabs — **Sessions** (review past drills) and **Workspace** (edit source documents) — talking to the server API.

### `docs/`
Design spec and phased implementation plans under `docs/superpowers/` ("English Interview Coach — Design Spec" and Phase 1–3 plans).

## Tech stack

- **Server:** Node.js (ES modules), Hono, `@hono/node-server`
- **Web:** React 18, Vite, TypeScript
- **Skill scripts:** Node.js (ES modules), `openai`
- **Auth:** Telegram Mini App `initData` HMAC verification
- **Tests:** Node's built-in test runner (`node --test`)

## Running

Each package is independent; install and run from its own directory.

### Server (`mini-app/server/`)
```bash
npm install
npm test          # node --test
COACH_BOT_TOKEN=<telegram-bot-token> npm start   # node server.mjs
```
Reads `COACH_BOT_TOKEN` (required), and optionally `INTERVIEW_DIR`, `STATIC_DIR`, and `PORT` (default 8443); binds to `127.0.0.1`.

### Web (`mini-app/web/`)
```bash
npm install
npm run dev       # vite dev server
npm run build     # vite build
npm run preview   # vite preview
```

### Interview-drill scripts (`skills/interview-drill/scripts/`)
```bash
npm install
npm test          # node --test
npm run smoke     # node smoke.mjs
```
Requires `OPENAI_API_KEY` in the environment.

## Repository structure

```
mini-app/
  server/   Hono JSON API + Telegram initData auth (Node)
  web/      React + Vite + TypeScript Telegram Mini App
skills/
  interview-drill/   SKILL.md + Node scripts (drill, RAG, scoring, logging)
docs/
  superpowers/       design spec + phased implementation plans
```
