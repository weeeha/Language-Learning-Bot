import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Settings } from '../types';

export default function Workspace() {
  const [files, setFiles] = useState<string[]>([]);
  const [sel, setSel] = useState('');
  const [body, setBody] = useState('');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => { api.sources().then(setFiles).catch((e) => setMsg(String(e.message))); api.settings().then(setSettings); }, []);
  const openFile = async (f: string) => { setSel(f); setBody(await api.source(f)); };
  const save = async () => { await api.putSource(sel, body); setMsg('saved locally'); };
  const push = async () => { setMsg('pushing…'); try { await api.push(sel); setMsg('pushed to GitHub'); } catch (e) { setMsg(String((e as Error).message)); } };
  const sync = async () => { setMsg('syncing…'); try { await api.sync(); setFiles(await api.sources()); setMsg('synced'); } catch (e) { setMsg(String((e as Error).message)); } };
  const saveSettings = async () => { if (settings) { await api.putSettings(settings); setMsg('settings saved'); } };

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button className="primary" onClick={sync}>Sync from GitHub</button>
        {sel && <><button className="primary" onClick={save}>Save</button><button onClick={push}>Push "{sel}"</button></>}
      </div>
      {msg && <p style={{ color: 'var(--tg-hint-color)' }}>{msg}</p>}
      <div style={{ marginBottom: 8 }}>{files.map((f) => (
        <button key={f} className="pill" style={{ fontWeight: sel === f ? 700 : 400 }} onClick={() => openFile(f)}>{f}</button>
      ))}</div>
      {sel && <textarea value={body} onChange={(e) => setBody(e.target.value)} />}

      {settings && (
        <details style={{ marginTop: 16 }}>
          <summary><b>Settings</b></summary>
          <label>Nudge time <input value={settings.nudge_time || ''} onChange={(e) => setSettings({ ...settings, nudge_time: e.target.value })} /></label>
          <label style={{ display: 'block', margin: '6px 0' }}>
            <input type="checkbox" checked={!!settings.skip_weekends} onChange={(e) => setSettings({ ...settings, skip_weekends: e.target.checked })} /> Skip weekends
          </label>
          <label>Per-day target <input type="number" min={1} max={5} value={settings.per_day_target || 1} onChange={(e) => setSettings({ ...settings, per_day_target: Number(e.target.value) })} /></label>
          <div style={{ marginTop: 8 }}>{Object.entries(settings.format_weights || {}).map(([k, v]) => (
            <div key={k}>{k}: <input type="range" min={0} max={100} value={v} onChange={(e) => setSettings({ ...settings, format_weights: { ...settings.format_weights, [k]: Number(e.target.value) } })} /> {v}</div>
          ))}</div>
          <button className="primary" style={{ marginTop: 8 }} onClick={saveSettings}>Save settings</button>
        </details>
      )}
    </>
  );
}
