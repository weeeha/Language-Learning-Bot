// Telegram injects window.Telegram.WebApp via the script in index.html.
type TG = { initData: string; themeParams: Record<string, string>; colorScheme: string; ready: () => void; expand: () => void; };
const wa = (): TG | undefined => (window as any).Telegram?.WebApp;

export function initTelegram() {
  const w = wa();
  if (!w) return;
  w.ready(); w.expand();
  applyTheme(w.themeParams);
}
export function applyTheme(theme: Record<string, string>) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme || {})) root.style.setProperty(`--tg-${k.replace(/_/g, '-')}`, v);
}
export function initDataRaw(): string { return wa()?.initData || ''; }
