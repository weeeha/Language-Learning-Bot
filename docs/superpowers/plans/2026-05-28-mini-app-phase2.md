# Mini App (Phase 2) Implementation Plan — Sessions + Workspace

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A lightweight Telegram Mini App that lets Nick review his interview-drill **Sessions** and edit his bio **Workspace** (sources + settings) from his phone — served by a small standalone server on his Mac, authenticated with Telegram `initData`.

**Architecture:** One self-hosted Node server (Hono) serves BOTH the built React SPA and a JSON API, reading/writing the same `workspace-speaker/interview/` state the Phase 1 skill uses. The server runs **off** the OpenClaw gateway (so it never affects the agent fleet's auth) and is exposed over HTTPS via a tunnel. Auth is Telegram `initData` HMAC-SHA256, verified server-side with the Coach bot token.

**Tech Stack:** Server — Node ESM + Hono + `@hono/node-server`, `node:test`. Frontend — React + Vite + TypeScript, using the official `telegram-web-app.js` global (no SDK dependency). Tunnel — Tailscale Funnel (default) or cloudflared.

---

## Decisions (made here — veto any before execution)

1. **Hosting model: self-hosted single server (option b).** One Hono process serves the static SPA *and* the `/api/*` routes from the same origin (no CORS). Rejected: SPA-on-Vercel + API-tunneled (adds a second deploy + CORS; revisit only if you want the UI up while the Mac is off).
2. **Server framework: Hono on `@hono/node-server`.** Tiny, modern, first-class middleware for the auth check. Plain `node:http` would work but Hono keeps routing/clean.
3. **Tunnel: Tailscale Funnel by default** (you already have Tailscale; gives a stable `https://<machine>.<tailnet>.ts.net` URL, which Telegram needs). cloudflared named-tunnel documented as the alternative. (Note: Tailscale is currently stopped on the Mac — you'll start it at deploy.)
4. **Scope: Sessions + Workspace tabs only** (per spec §11 Phase 2). Pitch Studio + Vocab are Phase 3.
5. **Testing calibration:** TDD with full code for the security-critical + logic parts (auth, store, API). Frontend tasks give real key code (SDK init, API client, both tabs) but not exhaustive styling — UI is verified visually in Telegram. This matches how frontend is actually iterated.
6. **Secrets:** the server reads the bot token from env `COACH_BOT_TOKEN` and the state path from `INTERVIEW_DIR` — never from `openclaw.json`. Consistent with the Phase 1 secrets rule.
7. **Server is read/write to `interview/` files** (sessions read-only; settings + source files read/write; git sync/push for sources). Single-user, so file-race with the agent is acceptable.

---

## File Structure

All in the project repo (`$REPO` = `/Users/nickv/ClaudeCode Projects/Lanuage Learning Bot`, quote it — spaces):

```
$REPO/mini-app/
  server/
    package.json            # hono, @hono/node-server; type:module; test script
    .gitignore              # node_modules
    auth.mjs                # verifyInitData(initDataRaw, botToken, maxAgeSec) -> {user} | throws
    store.mjs               # getSessions / getSettings / putSettings / listSources / readSource / writeSource / syncSources / pushSource
    server.mjs              # Hono app: static SPA + /api/* with auth middleware
    test/
      auth.test.mjs         # HMAC verify: valid / tampered / expired / missing
      store.test.mjs        # sessions parse, settings rw, source rw+traversal guard (temp dirs)
  web/
    package.json            # react, react-dom, @telegram-apps/sdk; vite, typescript (dev)
    .gitignore              # node_modules, dist
    index.html              # loads telegram-web-app.js + mounts #root
    vite.config.ts
    tsconfig.json
    src/
      main.tsx              # SDK init, themeParams -> CSS vars, miniApp.ready()
      telegram.ts           # initDataRaw accessor + theme binding
      api.ts                # fetch client: Authorization: tma <initDataRaw>
      types.ts              # Session, Settings, SourceMeta
      App.tsx               # bottom tab bar: Sessions | Workspace
      tabs/Sessions.tsx     # list + format filter + search + detail
      tabs/Workspace.tsx    # file list + markdown editor + settings + sync/push
      ui.css                # theme-var-based minimal styling
```

Runtime: the server reads `INTERVIEW_DIR` (default `~/.openclaw/workspace-speaker/interview`) and serves `web/dist` (built SPA). No new files in the workspace beyond what Phase 1 created.

---

## Task 1: Server scaffold

**Files:**
- Create: `$REPO/mini-app/server/package.json`
- Create: `$REPO/mini-app/server/.gitignore`

- [ ] **Step 1: package.json**

```json
{
  "name": "interview-mini-app-server",
  "private": true,
  "type": "module",
  "version": "0.1.0",
  "scripts": { "test": "node --test", "start": "node server.mjs" },
  "dependencies": { "hono": "^4.6.3", "@hono/node-server": "^1.13.1" }
}
```

- [ ] **Step 2: .gitignore** → `node_modules/`

- [ ] **Step 3: install** — Run: `cd "$REPO/mini-app/server" && npm install` — Expected: hono + @hono/node-server present.

- [ ] **Step 4: verify runner** — Run: `cd "$REPO/mini-app/server" && node --test` — Expected: exits 0, "tests 0".

- [ ] **Step 5: commit**

```bash
cd "$REPO" && git add mini-app/server/package.json mini-app/server/.gitignore && git commit -m "chore: scaffold mini-app server"
```

---

## Task 2: `auth.mjs` — verify Telegram initData (security-critical, TDD)

**Files:**
- Create: `$REPO/mini-app/server/auth.mjs`
- Create: `$REPO/mini-app/server/test/auth.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyInitData } from '../auth.mjs';

const BOT = '123456:TEST_TOKEN';

// Build a correctly-signed initData string for a given payload + token.
function signInitData(fields, token = BOT) {
  const params = new URLSearchParams(fields);
  const pairs = [...params.entries()].filter(([k]) => k !== 'hash')
    .map(([k, v]) => `${k}=${v}`).sort();
  const dcs = pairs.join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

test('accepts a validly signed, fresh initData and returns the user', () => {
  const now = Math.floor(Date.now() / 1000);
  const raw = signInitData({ auth_date: String(now), user: JSON.stringify({ id: 42, first_name: 'Nick' }) });
  const { user } = verifyInitData(raw, BOT, 86400);
  assert.equal(user.id, 42);
});

test('rejects a tampered hash', () => {
  const now = Math.floor(Date.now() / 1000);
  let raw = signInitData({ auth_date: String(now), user: JSON.stringify({ id: 42 }) });
  raw = raw.replace(/hash=[0-9a-f]+/, 'hash=deadbeef');
  assert.throws(() => verifyInitData(raw, BOT, 86400), /invalid hash/i);
});

test('rejects a tampered field (hash no longer matches)', () => {
  const now = Math.floor(Date.now() / 1000);
  const raw = signInitData({ auth_date: String(now), user: JSON.stringify({ id: 42, first_name: 'Nick' }) })
    .replace('Nick', 'Evil'); // mutate a signed field after signing, keep old hash
  assert.throws(() => verifyInitData(raw, BOT, 86400), /invalid hash/i);
});

test('rejects stale auth_date', () => {
  const old = Math.floor(Date.now() / 1000) - 100000;
  const raw = signInitData({ auth_date: String(old), user: JSON.stringify({ id: 42 }) });
  assert.throws(() => verifyInitData(raw, BOT, 86400), /expired/i);
});

test('rejects missing hash', () => {
  assert.throws(() => verifyInitData('auth_date=1&user=%7B%7D', BOT, 86400), /missing hash/i);
});
```

- [ ] **Step 2: Run, verify fail** — `cd "$REPO/mini-app/server" && node --test` — FAIL (no `../auth.mjs`).

- [ ] **Step 3: Implement `auth.mjs`**

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

// Verify Telegram Mini App initData per the WebApp spec.
// secret_key = HMAC_SHA256(key="WebAppData", msg=botToken)
// expected   = HMAC_SHA256(key=secret_key, msg=data_check_string) (hex)
export function verifyInitData(initDataRaw, botToken, maxAgeSec = 86400) {
  const params = new URLSearchParams(initDataRaw);
  const hash = params.get('hash');
  if (!hash) throw new Error('missing hash');

  const pairs = [...params.entries()]
    .filter(([k]) => k !== 'hash')
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  const dataCheckString = pairs.join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('invalid hash');

  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || (Date.now() / 1000 - authDate) > maxAgeSec) throw new Error('initData expired');

  const userRaw = params.get('user');
  return { user: userRaw ? JSON.parse(userRaw) : null, authDate };
}
```

- [ ] **Step 4: Run, verify pass** — `node --test` — PASS (5 tests).

- [ ] **Step 5: commit**

```bash
cd "$REPO" && git add mini-app/server/auth.mjs mini-app/server/test/auth.test.mjs && git commit -m "feat: Telegram initData HMAC verification"
```

---

## Task 3: `store.mjs` — interview-state access (TDD)

**Files:**
- Create: `$REPO/mini-app/server/store.mjs`
- Create: `$REPO/mini-app/server/test/store.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeStore } from '../store.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'iv-'));
  mkdirSync(join(dir, 'sources'));
  writeFileSync(join(dir, 'sessions.jsonl'),
    JSON.stringify({ id: 1, format: 'portfolio', score: 3 }) + '\n' +
    JSON.stringify({ id: 2, format: 'behavioral', score: 4 }) + '\n');
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ per_day_target: 1 }));
  writeFileSync(join(dir, 'sources', 'a.md'), '# A\nbody');
  return makeStore(dir);
}

test('getSessions returns newest-first', () => {
  const s = fixture();
  const out = s.getSessions();
  assert.equal(out[0].id, 2);
  assert.equal(out.length, 2);
});

test('settings round-trip', () => {
  const s = fixture();
  s.putSettings({ per_day_target: 3, nudge_time: '09:00' });
  assert.equal(s.getSettings().per_day_target, 3);
});

test('list + read + write sources', () => {
  const s = fixture();
  assert.deepEqual(s.listSources(), ['a.md']);
  assert.match(s.readSource('a.md'), /body/);
  s.writeSource('a.md', '# A\nedited');
  assert.match(s.readSource('a.md'), /edited/);
});

test('rejects path traversal in source names', () => {
  const s = fixture();
  assert.throws(() => s.readSource('../../etc/passwd'), /invalid source/i);
  assert.throws(() => s.writeSource('../x.md', 'y'), /invalid source/i);
});
```

- [ ] **Step 2: Run, verify fail** — FAIL (no `../store.mjs`).

- [ ] **Step 3: Implement `store.mjs`**

```js
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

export function makeStore(interviewDir) {
  const sourcesDir = join(interviewDir, 'sources');

  // Guard: only a bare *.md filename inside sources/ (no path separators).
  const safe = (name) => {
    if (!name || name !== basename(name) || !name.endsWith('.md')) throw new Error(`invalid source: ${name}`);
    return join(sourcesDir, name);
  };

  return {
    getSessions() {
      let raw = '';
      try { raw = readFileSync(join(interviewDir, 'sessions.jsonl'), 'utf8'); } catch { return []; }
      return raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).reverse();
    },
    getSettings() {
      return JSON.parse(readFileSync(join(interviewDir, 'settings.json'), 'utf8'));
    },
    putSettings(obj) {
      writeFileSync(join(interviewDir, 'settings.json'), JSON.stringify(obj, null, 2));
      return obj;
    },
    listSources() {
      try { return readdirSync(sourcesDir).filter((f) => f.endsWith('.md')).sort(); } catch { return []; }
    },
    readSource(name) { return readFileSync(safe(name), 'utf8'); },
    writeSource(name, content) { writeFileSync(safe(name), content); return true; },
    syncSources() { return execFileSync('git', ['-C', sourcesDir, 'pull', '--ff-only'], { encoding: 'utf8' }); },
    pushSource(name) {
      safe(name);
      execFileSync('git', ['-C', sourcesDir, 'add', name], { encoding: 'utf8' });
      execFileSync('git', ['-C', sourcesDir, 'commit', '-m', `edit ${name} via Mini App`], { encoding: 'utf8' });
      return execFileSync('git', ['-C', sourcesDir, 'push'], { encoding: 'utf8' });
    }
  };
}
```

- [ ] **Step 4: Run, verify pass** — PASS (4 tests; total 9 with auth).

- [ ] **Step 5: commit**

```bash
cd "$REPO" && git add mini-app/server/store.mjs mini-app/server/test/store.test.mjs && git commit -m "feat: interview-state store (sessions/settings/sources + git sync) with traversal guard"
```

---

## Task 4: `server.mjs` — Hono app (static + authed API)

**Files:**
- Create: `$REPO/mini-app/server/server.mjs`
- Modify: `$REPO/mini-app/server/test/auth.test.mjs` is unchanged; add `test/server.test.mjs`

- [ ] **Step 1: Write failing integration test** (exercises the auth middleware + a route via Hono's `app.request`)

Create `test/server.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';

const BOT = '123456:TEST_TOKEN';
function sign(fields) {
  const p = new URLSearchParams(fields);
  const dcs = [...p.entries()].filter(([k]) => k !== 'hash').map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT).digest();
  p.set('hash', createHmac('sha256', secret).update(dcs).digest('hex'));
  return p.toString();
}
function dir() {
  const d = mkdtempSync(join(tmpdir(), 'srv-')); mkdirSync(join(d, 'sources'));
  writeFileSync(join(d, 'sessions.jsonl'), JSON.stringify({ id: 7, format: 'portfolio', score: 5 }) + '\n');
  writeFileSync(join(d, 'settings.json'), JSON.stringify({ per_day_target: 1 }));
  return d;
}

test('GET /api/sessions without auth -> 401', async () => {
  const app = createApp({ interviewDir: dir(), botToken: BOT, staticDir: null });
  const res = await app.request('/api/sessions');
  assert.equal(res.status, 401);
});

test('GET /api/sessions with valid initData -> 200 + data', async () => {
  const app = createApp({ interviewDir: dir(), botToken: BOT, staticDir: null });
  const raw = sign({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 42 }) });
  const res = await app.request('/api/sessions', { headers: { Authorization: `tma ${raw}` } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body[0].id, 7);
});
```

- [ ] **Step 2: Run, verify fail** — FAIL (no `../server.mjs`).

- [ ] **Step 3: Implement `server.mjs`**

```js
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { serve } from '@hono/node-server';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyInitData } from './auth.mjs';
import { makeStore } from './store.mjs';

export function createApp({ interviewDir, botToken, staticDir }) {
  const store = makeStore(interviewDir);
  const app = new Hono();

  // Auth middleware for /api/* — expects "Authorization: tma <initDataRaw>".
  app.use('/api/*', async (c, next) => {
    const h = c.req.header('Authorization') || '';
    const raw = h.startsWith('tma ') ? h.slice(4) : '';
    try { c.set('tg', verifyInitData(raw, botToken)); }
    catch (e) { return c.json({ error: String(e.message) }, 401); }
    await next();
  });

  app.get('/api/sessions', (c) => c.json(store.getSessions()));
  app.get('/api/settings', (c) => c.json(store.getSettings()));
  app.put('/api/settings', async (c) => c.json(store.putSettings(await c.req.json())));
  app.get('/api/sources', (c) => c.json(store.listSources()));
  app.get('/api/sources/:name', (c) => c.text(store.readSource(c.req.param('name'))));
  app.put('/api/sources/:name', async (c) => { store.writeSource(c.req.param('name'), await c.req.text()); return c.json({ ok: true }); });
  app.post('/api/sync', (c) => c.json({ ok: true, out: store.syncSources() }));
  app.post('/api/sources/:name/push', (c) => c.json({ ok: true, out: store.pushSource(c.req.param('name')) }));

  // Static SPA (and index.html fallback for client routing) — only if a build dir is given.
  if (staticDir && existsSync(staticDir)) {
    app.use('/*', serveStatic({ root: staticDir }));
    app.notFound((c) => c.html(readFileSync(join(staticDir, 'index.html'), 'utf8')));
  }
  return app;
}

// CLI entrypoint (robust guard for spaces/symlinks — see Phase 1 plan rationale).
if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const interviewDir = process.env.INTERVIEW_DIR || join(homedir(), '.openclaw/workspace-speaker/interview');
  const botToken = process.env.COACH_BOT_TOKEN;
  if (!botToken) { console.error('COACH_BOT_TOKEN env var required'); process.exit(1); }
  const staticDir = process.env.STATIC_DIR || join(process.cwd(), '../web/dist');
  const port = Number(process.env.PORT || 8443);
  const app = createApp({ interviewDir, botToken, staticDir });
  serve({ fetch: app.fetch, port, hostname: '127.0.0.1' });
  console.error(`mini-app server on http://127.0.0.1:${port} (state: ${interviewDir})`);
}
```

- [ ] **Step 4: Run, verify pass** — `node --test` — PASS (auth 5 + store 4 + server 2 = 11).

- [ ] **Step 5: commit**

```bash
cd "$REPO" && git add mini-app/server/server.mjs mini-app/server/test/server.test.mjs && git commit -m "feat: Hono server with initData auth middleware + interview API"
```

---

## Task 5: Web app scaffold + Telegram SDK init

**Files:**
- Create: `$REPO/mini-app/web/{package.json,.gitignore,index.html,vite.config.ts,tsconfig.json}`
- Create: `$REPO/mini-app/web/src/{main.tsx,telegram.ts,ui.css}`

- [ ] **Step 1: package.json**

```json
{
  "name": "interview-mini-app-web",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview" },
  "dependencies": { "react": "^18.3.1", "react-dom": "^18.3.1" },
  "devDependencies": { "vite": "^5.4.8", "@vitejs/plugin-react": "^4.3.1", "typescript": "^5.6.2", "@types/react": "^18.3.10", "@types/react-dom": "^18.3.0" }
}
```

> The app uses the official `telegram-web-app.js` global (loaded in `index.html`) via `src/telegram.ts` — no `@telegram-apps/sdk` import is needed, so it isn't a dependency. (If you later want the SDK's typed helpers, add it then.)

- [ ] **Step 2: `.gitignore`** → `node_modules/` and `dist/`

- [ ] **Step 3: `index.html`** (loads Telegram's runtime script before the bundle)

```html
<!doctype html>
<html><head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <title>Interview Coach</title>
</head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>
```

- [ ] **Step 4: `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], base: './', build: { outDir: 'dist' } });
```

- [ ] **Step 5: `tsconfig.json`** (minimal React+Vite)

```json
{ "compilerOptions": { "target": "ES2020", "lib": ["ES2020", "DOM", "DOM.Iterable"], "module": "ESNext", "moduleResolution": "Bundler", "jsx": "react-jsx", "strict": true, "skipLibCheck": true, "noEmit": true }, "include": ["src"] }
```

- [ ] **Step 6: `src/telegram.ts`** (raw initData + theme → CSS vars)

```ts
// Telegram injects window.Telegram.WebApp via the script in index.html.
type TG = { initData: string; themeParams: Record<string, string>; colorScheme: string; ready: () => void; expand: () => void; };
const wa = (): TG | undefined => (window as any).Telegram?.WebApp;

export function initTelegram() {
  const w = wa();
  if (!w) return;
  w.ready(); w.expand();
  applyTheme(w.themeParams);
}
export function applyTheme(theme: Record<string, string>) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme || {})) root.style.setProperty(`--tg-${k.replace(/_/g, '-')}`, v);
}
export function initDataRaw(): string { return wa()?.initData || ''; }
```

- [ ] **Step 7: `src/ui.css`** (theme-var-driven minimal styling)

```css
:root { --tg-bg-color:#fff; --tg-text-color:#000; --tg-hint-color:#888; --tg-button-color:#3390ec; --tg-button-text-color:#fff; --tg-secondary-bg-color:#f1f1f1; }
* { box-sizing: border-box; } body { margin:0; font:15px/1.45 -apple-system,system-ui,sans-serif; background:var(--tg-bg-color); color:var(--tg-text-color); }
.tabbar { position:fixed; bottom:0; left:0; right:0; display:flex; border-top:1px solid var(--tg-secondary-bg-color); background:var(--tg-bg-color); }
.tabbar button { flex:1; padding:12px; border:0; background:none; color:var(--tg-hint-color); font-size:13px; }
.tabbar button[aria-selected="true"] { color:var(--tg-button-color); font-weight:600; }
.screen { padding:12px 12px 64px; } .row { padding:10px; border-bottom:1px solid var(--tg-secondary-bg-color); }
.pill { font-size:11px; padding:2px 8px; border-radius:10px; background:var(--tg-secondary-bg-color); margin-right:6px; }
button.primary { background:var(--tg-button-color); color:var(--tg-button-text-color); border:0; border-radius:8px; padding:10px 14px; }
textarea { width:100%; min-height:40vh; font:13px/1.4 ui-monospace,monospace; }
input,select { font:inherit; padding:6px; }
```

- [ ] **Step 8: `src/main.tsx`**

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { initTelegram } from './telegram';
import App from './App';
import './ui.css';
initTelegram();
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
```

- [ ] **Step 9: install** — Run: `cd "$REPO/mini-app/web" && npm install` — Expected: deps install cleanly. (Typecheck runs in Tasks 8–9 once `App.tsx` and the tabs exist.)

- [ ] **Step 10: commit**

```bash
cd "$REPO" && git add mini-app/web/package.json mini-app/web/.gitignore mini-app/web/index.html mini-app/web/vite.config.ts mini-app/web/tsconfig.json mini-app/web/src/main.tsx mini-app/web/src/telegram.ts mini-app/web/src/ui.css && git commit -m "chore: scaffold Vite+React mini-app with Telegram SDK theme init"
```

---

## Task 6: API client + types

**Files:**
- Create: `$REPO/mini-app/web/src/api.ts`, `$REPO/mini-app/web/src/types.ts`

- [ ] **Step 1: `types.ts`**

```ts
export interface Session { id: number; ts?: string; format: string; question_text?: string; answer_transcript?: string;
  score?: number; rephrases?: { original: string; improved: string }[]; model_answer?: string; weak_vocab?: string[]; }
export interface Settings { nudge_time?: string; skip_weekends?: boolean; timezone?: string; per_day_target?: number;
  tts_voice?: string; format_weights?: Record<string, number>; }
```

- [ ] **Step 2: `api.ts`** (every call carries the signed initData)

```ts
import { initDataRaw } from './telegram';
import type { Session, Settings } from './types';

async function req(path: string, init: RequestInit = {}) {
  const res = await fetch(`/api${path}`, { ...init, headers: { Authorization: `tma ${initDataRaw()}`, ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res;
}
export const api = {
  sessions: () => req('/sessions').then((r) => r.json() as Promise<Session[]>),
  settings: () => req('/settings').then((r) => r.json() as Promise<Settings>),
  putSettings: (s: Settings) => req('/settings', { method: 'PUT', body: JSON.stringify(s) }).then((r) => r.json()),
  sources: () => req('/sources').then((r) => r.json() as Promise<string[]>),
  source: (n: string) => req(`/sources/${encodeURIComponent(n)}`).then((r) => r.text()),
  putSource: (n: string, body: string) => req(`/sources/${encodeURIComponent(n)}`, { method: 'PUT', body }).then((r) => r.json()),
  sync: () => req('/sync', { method: 'POST' }).then((r) => r.json()),
  push: (n: string) => req(`/sources/${encodeURIComponent(n)}/push`, { method: 'POST' }).then((r) => r.json())
};
```

- [ ] **Step 2b: commit**

```bash
cd "$REPO" && git add mini-app/web/src/api.ts mini-app/web/src/types.ts && git commit -m "feat: mini-app API client + types"
```

---

## Task 7: App shell + tab bar

**Files:** Create/replace `$REPO/mini-app/web/src/App.tsx`

- [ ] **Step 1: `App.tsx`**

```tsx
import { useState } from 'react';
import Sessions from './tabs/Sessions';
import Workspace from './tabs/Workspace';

export default function App() {
  const [tab, setTab] = useState<'sessions' | 'workspace'>('sessions');
  return (
    <>
      <div className="screen">{tab === 'sessions' ? <Sessions /> : <Workspace />}</div>
      <nav className="tabbar">
        <button aria-selected={tab === 'sessions'} onClick={() => setTab('sessions')}>Sessions</button>
        <button aria-selected={tab === 'workspace'} onClick={() => setTab('workspace')}>Workspace</button>
      </nav>
    </>
  );
}
```

- [ ] **Step 2: commit** — `cd "$REPO" && git add mini-app/web/src/App.tsx && git commit -m "feat: mini-app tab shell (Sessions | Workspace)"`

---

## Task 8: Sessions tab

**Files:** Create `$REPO/mini-app/web/src/tabs/Sessions.tsx`

- [ ] **Step 1: `Sessions.tsx`** (list + format filter + search + expandable detail)

```tsx
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { Session } from '../types';

const FORMATS = ['all', 'portfolio', 'behavioral', 'critique', 'whiteboard', 'hiring_manager'];

export default function Sessions() {
  const [items, setItems] = useState<Session[]>([]);
  const [err, setErr] = useState('');
  const [fmt, setFmt] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => { api.sessions().then(setItems).catch((e) => setErr(String(e.message))); }, []);

  const shown = useMemo(() => items.filter((s) =>
    (fmt === 'all' || s.format === fmt) &&
    (!q || (s.question_text || '').toLowerCase().includes(q.toLowerCase()))
  ), [items, fmt, q]);

  if (err) return <p style={{ color: 'crimson' }}>Couldn’t load sessions: {err}</p>;
  return (
    <>
      <input placeholder="Search questions…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
      <div style={{ marginBottom: 8 }}>{FORMATS.map((f) => (
        <button key={f} className="pill" style={{ fontWeight: fmt === f ? 700 : 400 }} onClick={() => setFmt(f)}>{f}</button>
      ))}</div>
      {shown.length === 0 && <p style={{ color: 'var(--tg-hint-color)' }}>No sessions yet.</p>}
      {shown.map((s) => (
        <div key={s.id} className="row" onClick={() => setOpen(open === s.id ? null : s.id)}>
          <div><span className="pill">{s.format}</span><b>{s.score ?? '—'}/5</b> <small style={{ color: 'var(--tg-hint-color)' }}>{s.ts?.slice(0, 10)}</small></div>
          <div>{(s.question_text || '').slice(0, 90)}</div>
          {open === s.id && (
            <div style={{ marginTop: 8 }}>
              <p><b>Your answer:</b> {s.answer_transcript}</p>
              {s.rephrases?.length ? <div><b>Rephrases:</b><ul>{s.rephrases.map((r, i) => <li key={i}>{r.original} → <i>{r.improved}</i></li>)}</ul></div> : null}
              <p><b>Model answer:</b> {s.model_answer}</p>
              {s.weak_vocab?.length ? <p><b>Vocab:</b> {s.weak_vocab.join(', ')}</p> : null}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
```

- [ ] **Step 2: typecheck** — `cd "$REPO/mini-app/web" && npx tsc --noEmit` — Expected: passes.
- [ ] **Step 3: commit** — `git add mini-app/web/src/tabs/Sessions.tsx && git commit -m "feat: Sessions tab (filter, search, detail)"`

---

## Task 9: Workspace tab (editor + settings + sync/push)

**Files:** Create `$REPO/mini-app/web/src/tabs/Workspace.tsx`

- [ ] **Step 1: `Workspace.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Settings } from '../types';

export default function Workspace() {
  const [files, setFiles] = useState<string[]>([]);
  const [sel, setSel] = useState('');
  const [body, setBody] = useState('');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => { api.sources().then(setFiles).catch((e) => setMsg(String(e.message))); api.settings().then(setSettings); }, []);
  const openFile = async (f: string) => { setSel(f); setBody(await api.source(f)); };
  const save = async () => { await api.putSource(sel, body); setMsg('saved locally'); };
  const push = async () => { setMsg('pushing…'); try { await api.push(sel); setMsg('pushed to GitHub'); } catch (e) { setMsg(String((e as Error).message)); } };
  const sync = async () => { setMsg('syncing…'); try { await api.sync(); setFiles(await api.sources()); setMsg('synced'); } catch (e) { setMsg(String((e as Error).message)); } };
  const saveSettings = async () => { if (settings) { await api.putSettings(settings); setMsg('settings saved'); } };

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button className="primary" onClick={sync}>Sync from GitHub</button>
        {sel && <><button className="primary" onClick={save}>Save</button><button onClick={push}>Push “{sel}”</button></>}
      </div>
      {msg && <p style={{ color: 'var(--tg-hint-color)' }}>{msg}</p>}
      <div style={{ marginBottom: 8 }}>{files.map((f) => (
        <button key={f} className="pill" style={{ fontWeight: sel === f ? 700 : 400 }} onClick={() => openFile(f)}>{f}</button>
      ))}</div>
      {sel && <textarea value={body} onChange={(e) => setBody(e.target.value)} />}

      {settings && (
        <details style={{ marginTop: 16 }}>
          <summary><b>Settings</b></summary>
          <label>Nudge time <input value={settings.nudge_time || ''} onChange={(e) => setSettings({ ...settings, nudge_time: e.target.value })} /></label>
          <label style={{ display: 'block', margin: '6px 0' }}>
            <input type="checkbox" checked={!!settings.skip_weekends} onChange={(e) => setSettings({ ...settings, skip_weekends: e.target.checked })} /> Skip weekends
          </label>
          <label>Per-day target <input type="number" min={1} max={5} value={settings.per_day_target || 1} onChange={(e) => setSettings({ ...settings, per_day_target: Number(e.target.value) })} /></label>
          <div style={{ marginTop: 8 }}>{Object.entries(settings.format_weights || {}).map(([k, v]) => (
            <div key={k}>{k}: <input type="range" min={0} max={100} value={v} onChange={(e) => setSettings({ ...settings, format_weights: { ...settings.format_weights, [k]: Number(e.target.value) } })} /> {v}</div>
          ))}</div>
          <button className="primary" style={{ marginTop: 8 }} onClick={saveSettings}>Save settings</button>
        </details>
      )}
    </>
  );
}
```

- [ ] **Step 2: typecheck** — `cd "$REPO/mini-app/web" && npx tsc --noEmit` — Expected: passes.
- [ ] **Step 3: build** — `npm run build` — Expected: `dist/` produced, no errors.
- [ ] **Step 4: commit** — `git add mini-app/web/src/tabs/Workspace.tsx && git commit -m "feat: Workspace tab (source editor, settings, sync/push)"`

---

## Task 10: Local end-to-end smoke (server + built SPA, no Telegram)

- [ ] **Step 1: Run the server against the built SPA**

```bash
cd "$REPO/mini-app/server"
COACH_BOT_TOKEN=dummy INTERVIEW_DIR=~/.openclaw/workspace-speaker/interview STATIC_DIR="$REPO/mini-app/web/dist" PORT=8443 node server.mjs &
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8443/            # expect 200 (index.html)
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8443/api/sessions # expect 401 (no auth)
kill %1
```
Expected: `200` for the SPA, `401` for the unauthenticated API call (proves static serving + auth gate both work).

- [ ] **Step 2: commit** (nothing new to commit unless a fix was needed; otherwise skip).

---

## Task 11: Deploy runbook (YOUR live-system steps)

> You run these (consistent with keeping live-system actions in your hands). Do them after Phase 1 is live.

- [ ] **Build the SPA:** `cd "$REPO/mini-app/web" && npm run build`
- [ ] **Start Tailscale** (it's currently stopped): `tailscale up`, ensure MagicDNS + HTTPS are enabled in the tailnet admin.
- [ ] **Run the server** (set the real Coach bot token — same one as `@Nxspeakingcoachbot`; read it from your config, don't paste it into history):

```bash
cd "$REPO/mini-app/server"
COACH_BOT_TOKEN="<coach bot token>" \
INTERVIEW_DIR="$HOME/.openclaw/workspace-speaker/interview" \
STATIC_DIR="$REPO/mini-app/web/dist" PORT=8443 node server.mjs
```
- [ ] **Keep it running** — wrap as a launchd user agent (`~/Library/LaunchAgents/com.nick.interview-miniapp.plist`) or run under pm2. (Sample plist in a follow-up if you want.)
- [ ] **Expose over HTTPS — Tailscale Funnel (default):** `tailscale funnel 8443` → gives a stable `https://<machine>.<tailnet>.ts.net`. (Funnel allows ports 443/8443/10000; 8443 is chosen for that reason.)
  - **Alternative — cloudflared named tunnel:** requires a Cloudflare account + a domain; `cloudflared tunnel route dns <tunnel> miniapp.yourdomain.com` then `cloudflared tunnel run` mapping to `http://127.0.0.1:8443`.
- [ ] **Point the bot at it:** in @BotFather → your Coach bot → configure the Mini App / Menu Button URL to the funnel URL (so `@Nxspeakingcoachbot` opens this app).
- [ ] **Test in Telegram:** open the Mini App from the bot → Sessions lists your drills; Workspace lists `nicks-bio` files, edits save, Sync pulls, Push commits. If you see `401`, the bot token in `COACH_BOT_TOKEN` doesn't match the bot serving the Mini App.

---

## Self-Review (controller, before execution)
- Backend (auth, store, server) is TDD with full code; 11 tests specified.
- Frontend gives real code for SDK init, API client, both tabs; UI verified visually in Telegram (Task 11).
- Auth: same `initData` HMAC algorithm proven in `auth.test.mjs`; server gates every `/api/*`.
- No secrets in repo; server reads `COACH_BOT_TOKEN` + `INTERVIEW_DIR` from env.
- Reuses Phase 1 state (`sessions.jsonl`, `settings.json`, `sources/`) — no schema change.
- **Note (post-execution):** the committed implementation added review-driven hardening beyond the literal code here — initData future-timestamp rejection, `pushSource` 409 on nothing-to-commit, a Hono `onError` JSON error mapper, a null-byte source guard, Workspace API-error surfacing, and two extra auth tests (13 total). The committed code is the source of truth.

## Phase 2 Done — Definition of Done
- `cd mini-app/server && node --test` green (11 tests); local smoke shows `200` (SPA) + `401` (unauthed API).
- `mini-app/web` builds; in Telegram, Sessions + Workspace work end-to-end over the tunnel.

**Out of scope (Phase 3+):** Pitch Studio (tab 2) + Vocab SRS (tab 3); plus two §7 Tab-4 extras deferred to keep Phase 2 lean — **skills-coverage viz** (Phase 3) and **JSON data export** from Settings (add later if wanted; ~a `/api/export` route + button). Each gets its own plan.
