// debugHud.js — 画面上の簡易デバッグ表示。?dbg=1 で有効（localStorageに記憶）、?dbg=0 で無効。
// ペン/タッチの挙動（なぜ書けないか）を実機で可視化するための軽量ログ。本番動作には影響しない。
let el = null;
let on = null;
const lines = [];

export function hudEnabled(){
  if (on !== null) return on;
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('dbg') === '1') localStorage.setItem('prDbg', '1');
    if (q.get('dbg') === '0') localStorage.removeItem('prDbg');
    on = localStorage.getItem('prDbg') === '1';
  } catch { on = false; }
  return on;
}

export function hud(line){
  if (!hudEnabled()) return;
  try {
    if (!el){
      el = document.createElement('div');
      el.id = 'prDbgHud';
      el.style.cssText = 'position:fixed;left:4px;top:4px;z-index:99999;max-width:66vw;' +
        'background:rgba(0,0,0,.72);color:#0f0;font:10px/1.25 ui-monospace,monospace;' +
        'padding:4px 6px;border-radius:6px;pointer-events:none;white-space:pre;';
      (document.body || document.documentElement).appendChild(el);
    }
    const t = (performance.now() / 1000).toFixed(2);
    lines.push(`${t} ${line}`);
    if (lines.length > 16) lines.shift();
    el.textContent = lines.join('\n');
  } catch {}
}
