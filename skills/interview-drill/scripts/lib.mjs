// Seeded RNG (mulberry32) — deterministic for tests.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Weighted random key selection. weights: { key: number }
export function weightedPick(weights, rng) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [k, w] of entries) if ((r -= w) < 0) return k;
  return entries[entries.length - 1][0];
}

// Choose today's interview format. Anti-repeat: if the pick equals the last
// session's format, re-pick among the remaining formats.
export function pickDrill({ settings, sessions, rng }) {
  const weights = settings.format_weights;
  let format = weightedPick(weights, rng);
  const last = sessions.at(-1)?.format;
  if (last && format === last) {
    const rest = Object.fromEntries(Object.entries(weights).filter(([k]) => k !== format));
    if (Object.keys(rest).length) format = weightedPick(rest, rng);
  }
  return { format };
}

import { createHash } from 'node:crypto';

export function contentHash(str) {
  return createHash('sha256').update(str).digest('hex').slice(0, 16);
}

// Split markdown into {heading, text} chunks. New chunk at each ATX heading;
// oversized sections are further split on blank lines to ~maxChars.
export function chunkMarkdown(text, { maxChars = 1500 } = {}) {
  const lines = text.split(/\r?\n/);
  const chunks = [];
  let heading = '';
  let buf = [];
  const flush = () => {
    const body = buf.join('\n').trim();
    if (body) {
      let cur = '';
      for (const para of body.split(/\n{2,}/)) {
        if (cur && (cur + '\n\n' + para).length > maxChars) {
          chunks.push({ heading, text: cur.trim() });
          cur = para;
        } else {
          cur = cur ? cur + '\n\n' + para : para;
        }
      }
      if (cur.trim()) chunks.push({ heading, text: cur.trim() });
    }
    buf = [];
  };
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) { flush(); heading = line.replace(/^#{1,6}\s/, '').trim(); }
    else buf.push(line);
  }
  flush();
  return chunks;
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// Rank vectors by cosine to queryVec, return top-k WITHOUT the embedding field.
export function topK(queryVec, vectors, k) {
  return vectors
    .map(({ embedding, ...rest }) => ({ ...rest, score: cosine(queryVec, embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export const SCORE_SCHEMA = {
  name: 'interview_answer_score',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      score: { type: 'integer', minimum: 1, maximum: 5 },
      rephrases: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { original: { type: 'string' }, improved: { type: 'string' } },
          required: ['original', 'improved']
        }
      },
      model_answer: { type: 'string' },
      weak_vocab: { type: 'array', items: { type: 'string' } }
    },
    required: ['score', 'rephrases', 'model_answer', 'weak_vocab']
  }
};

export function buildScorePrompt({ question, transcript, context, deep = false }) {
  const system = [
    'You are a senior product-design interviewer evaluating a spoken interview answer in English.',
    'The candidate is an advanced non-native English speaker (senior designer). Be precise and kind.',
    deep
      ? 'Provide a DEEP rubric: assess fluency, vocabulary range, structure, and content depth, plus the standard fields.'
      : 'Return a 1-5 score, 2-3 rephrases of the weakest phrasings, a concise native-level model answer, and weak/missed vocabulary.',
    'Rephrases must quote the candidate original phrasing and an improved version.',
    'Ground the model answer in the provided candidate context when relevant.'
  ].join(' ');
  const user = [
    `INTERVIEW QUESTION:\n${question}`,
    `\nCANDIDATE CONTEXT (for grounding the model answer):\n${context || '(none)'}`,
    `\nCANDIDATE SPOKEN ANSWER (transcribed):\n${transcript}`
  ].join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

// Lightweight runtime guard (defense-in-depth on top of strict json_schema).
export function validateScore(obj) {
  const errs = [];
  if (!obj || typeof obj !== 'object') return ['not an object'];
  if (!Number.isInteger(obj.score) || obj.score < 1 || obj.score > 5) errs.push('score must be int 1-5');
  if (!Array.isArray(obj.rephrases)) errs.push('rephrases must be array');
  else obj.rephrases.forEach((r, i) => {
    if (typeof r?.original !== 'string' || typeof r?.improved !== 'string') errs.push(`rephrase ${i} malformed`);
  });
  if (typeof obj.model_answer !== 'string' || !obj.model_answer.trim()) errs.push('model_answer required');
  if (!Array.isArray(obj.weak_vocab)) errs.push('weak_vocab must be array');
  return errs;
}
