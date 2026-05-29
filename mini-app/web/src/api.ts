import { initDataRaw } from './telegram';
import type { Session, Settings } from './types';

async function req(path: string, init: RequestInit = {}) {
  const res = await fetch(`/api${path}`, { ...init, headers: { Authorization: `tma ${initDataRaw()}`, ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res;
}
export const api = {
  sessions: () => req('/sessions').then((r) => r.json() as Promise<Session[]>),
  settings: () => req('/settings').then((r) => r.json() as Promise<Settings>),
  putSettings: (s: Settings) => req('/settings', { method: 'PUT', body: JSON.stringify(s), headers: { 'Content-Type': 'application/json' } }).then((r) => r.json()),
  sources: () => req('/sources').then((r) => r.json() as Promise<string[]>),
  source: (n: string) => req(`/sources/${encodeURIComponent(n)}`).then((r) => r.text()),
  putSource: (n: string, body: string) => req(`/sources/${encodeURIComponent(n)}`, { method: 'PUT', body }).then((r) => r.json()),
  sync: () => req('/sync', { method: 'POST' }).then((r) => r.json()),
  push: (n: string) => req(`/sources/${encodeURIComponent(n)}/push`, { method: 'POST' }).then((r) => r.json())
};
