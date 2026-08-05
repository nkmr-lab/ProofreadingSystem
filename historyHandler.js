// historyHandler.js — ホームで「自分がチェックした校正」を新しい順に一覧（ログイン限定）。
// api.php?action=mine（所有者=自分の meta を走査）から取得し、/{uuid} へのリンクを並べる。

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
// ISO文字列 → ローカルの読みやすい日時
function fmtDate(iso){
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export async function loadMyHistory(){
  const box = document.getElementById('historyBox');
  const list = document.getElementById('historyList');
  if (!box || !list) return;   // 未ログインでは要素自体が無い
  try {
    const res = await fetch('api.php?action=mine');
    if (res.status === 401) return;   // 未ログイン
    const data = await res.json();
    const items = data.items || [];
    if (!items.length) return;        // 履歴なしなら出さない（使い方カードを優先）

    list.innerHTML = '';
    for (const it of items){
      const a = document.createElement('a');
      a.className = 'hist-row';
      a.href = '/' + it.uuid;
      const title = it.title && it.title.trim() ? it.title : '(無題のPDF)';
      a.innerHTML =
        `<span class="hist-title">${escapeHtml(title)}</span>` +
        `<span class="hist-meta">${it.hasAudio ? '🎙️ ' : ''}${escapeHtml(fmtDate(it.created))}</span>`;
      list.appendChild(a);
    }
    box.style.display = '';
  } catch (e) {
    console.warn('履歴の取得に失敗:', e);
  }
}
