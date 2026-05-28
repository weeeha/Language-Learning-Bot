#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { mulberry32, pickDrill } from './lib.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };

const settings = JSON.parse(readFileSync(arg('--settings'), 'utf8'));
let sessions = [];
try {
  sessions = readFileSync(arg('--sessions'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
} catch { /* no/empty session log is fine */ }

const seed = Number(arg('--seed', String(Date.now() % 2147483647)));
process.stdout.write(JSON.stringify(pickDrill({ settings, sessions, rng: mulberry32(seed) })));
