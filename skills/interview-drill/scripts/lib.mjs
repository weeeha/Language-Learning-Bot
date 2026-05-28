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
