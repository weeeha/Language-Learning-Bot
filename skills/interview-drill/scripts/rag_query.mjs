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
