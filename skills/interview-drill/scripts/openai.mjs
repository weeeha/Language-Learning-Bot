import OpenAI from 'openai';

// Exported for testing the missing-key path without constructing a client.
export function _requireKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not set in environment');
  return key;
}

function client() {
  return new OpenAI({ apiKey: _requireKey() });
}

export async function embed(texts, model = process.env.INTERVIEW_EMBED_MODEL || 'text-embedding-3-small') {
  const res = await client().embeddings.create({ model, input: texts });
  return res.data.map((d) => d.embedding);
}

export async function chatJson(messages, schema, model = process.env.INTERVIEW_SCORE_MODEL || 'gpt-4o-2024-08-06') {
  const res = await client().chat.completions.create({
    model,
    messages,
    response_format: { type: 'json_schema', json_schema: schema }
  });
  return JSON.parse(res.choices[0].message.content);
}
