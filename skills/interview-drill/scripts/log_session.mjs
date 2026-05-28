#!/usr/bin/env node
import { readFileSync, appendFileSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const obj = JSON.parse(readFileSync(arg('--in'), 'utf8'));
if (!obj.id) obj.id = Date.now();
if (!obj.ts) obj.ts = new Date().toISOString();
appendFileSync(arg('--log'), JSON.stringify(obj) + '\n');
