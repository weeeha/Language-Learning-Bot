#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { buildScorePrompt, validateScore, SCORE_SCHEMA } from './lib.mjs';
import { chatJson } from './openai.mjs';

export async function scoreAnswer({ question, transcript, context, deep = false, chatFn }) {
  const messages = buildScorePrompt({ question, transcript, context, deep });
  const result = await chatFn(messages, SCORE_SCHEMA);
  const errs = validateScore(result);
  if (errs.length) throw new Error('invalid score: ' + errs.join('; '));
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
  const rd = (f) => (f ? readFileSync(f, 'utf8') : '');
  // File-based inputs: the agent writes question/transcript/context via the `write`
  // tool, so arbitrary speech text never has to survive shell quoting.
  const out = await scoreAnswer({
    question: rd(arg('--question-file')).trim(),
    transcript: rd(arg('--transcript-file')).trim(),
    context: rd(arg('--context-file')),
    deep: process.argv.includes('--deep'),
    chatFn: chatJson
  });
  process.stdout.write(JSON.stringify(out));
}
