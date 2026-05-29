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
