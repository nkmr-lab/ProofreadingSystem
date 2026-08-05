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

// 1件分の行DOMを作る。owner を渡すと「共有された」一覧用に共有者名も出す。
function makeRow(it){
  const a = document.createElement('a');
  a.className = 'hist-row';
  a.href = '/' + it.uuid;
  const title = it.title && it.title.trim() ? it.title : '(無題のPDF)';
  const who = it.owner ? `${escapeHtml(it.owner)}・` : '';
  a.innerHTML =
    `<span class="hist-title">${escapeHtml(title)}</span>` +
    `<span class="hist-meta">${it.hasAudio ? '🎙️ ' : ''}${who}${escapeHtml(fmtDate(it.created))}</span>`;
  return a;
}

function fillList(listId, boxId, items){
  const list = document.getElementById(listId);
  const box = document.getElementById(boxId);
  if (!list || !box || !items || !items.length) return;
  list.innerHTML = '';
  for (const it of items) list.appendChild(makeRow(it));
  box.style.display = '';
}

export async function loadMyHistory(){
  if (!document.getElementById('historyBox')) return;   // 未ログインでは要素自体が無い
  try {
    const res = await fetch('api.php?action=mine');
    if (res.status === 401) return;   // 未ログイン
    const data = await res.json();
    fillList('sharedList', 'sharedBox', data.shared || []);   // 自分に共有された
    fillList('historyList', 'historyBox', data.items || []);  // 自分が作った
  } catch (e) {
    console.warn('履歴の取得に失敗:', e);
  }
}
