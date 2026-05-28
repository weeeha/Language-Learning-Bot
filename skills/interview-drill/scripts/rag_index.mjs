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
