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
