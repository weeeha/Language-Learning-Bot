#!/usr/bin/env node
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { topK } from './lib.mjs';
import { embed } from './openai.mjs';

export async function queryIndex({ vectorsPath, query, k = 6, embedFn }) {
  const index = JSON.parse(readFileSync(vectorsPath, 'utf8'));
  const [qv] = await embedFn([query]);
  return topK(qv, index.items, k);
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
  if (!arg('--vectors') || (!arg('--query') && !arg('--query-file'))) { console.error('Usage: rag_query.mjs --vectors <file> (--query <text> | --query-file <file>) [--k N] [--out <file>]'); process.exit(1); }
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
