import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { Session } from '../types';

const FORMATS = ['all', 'portfolio', 'behavioral', 'critique', 'whiteboard', 'hiring_manager'];

export default function Sessions() {
  const [items, setItems] = useState<Session[]>([]);
  const [err, setErr] = useState('');
  const [fmt, setFmt] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => { api.sessions().then(setItems).catch((e) => setErr(String(e.message))); }, []);

  const shown = useMemo(() => items.filter((s) =>
    (fmt === 'all' || s.format === fmt) &&
    (!q || (s.question_text || '').toLowerCase().includes(q.toLowerCase()))
  ), [items, fmt, q]);

  if (err) return <p style={{ color: 'crimson' }}>Couldn't load sessions: {err}</p>;
  return (
    <>
      <input placeholder="Search questions…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
      <div style={{ marginBottom: 8 }}>{FORMATS.map((f) => (
        <button key={f} className="pill" style={{ fontWeight: fmt === f ? 700 : 400 }} onClick={() => setFmt(f)}>{f}</button>
      ))}</div>
      {shown.length === 0 && <p style={{ color: 'var(--tg-hint-color)' }}>No sessions yet.</p>}
      {shown.map((s) => (
        <div key={s.id} className="row" onClick={() => setOpen(open === s.id ? null : s.id)}>
          <div><span className="pill">{s.format}</span><b>{s.score ?? '—'}/5</b> <small style={{ color: 'var(--tg-hint-color)' }}>{s.ts?.slice(0, 10)}</small></div>
          <div>{(s.question_text || '').slice(0, 90)}</div>
          {open === s.id && (
            <div style={{ marginTop: 8 }}>
              <p><b>Your answer:</b> {s.answer_transcript}</p>
              {s.rephrases?.length ? <div><b>Rephrases:</b><ul>{s.rephrases.map((r, i) => <li key={i}>{r.original} → <i>{r.improved}</i></li>)}</ul></div> : null}
              <p><b>Model answer:</b> {s.model_answer}</p>
              {s.weak_vocab?.length ? <p><b>Vocab:</b> {s.weak_vocab.join(', ')}</p> : null}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
