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
// deletable=true のときは行末に🗑を出し、その場で削除できる（自分のチェック履歴のみ）。
function makeRow(it, deletable = false){
  const row = document.createElement('div');
  row.className = 'hist-row';
  const a = document.createElement('a');
  a.className = 'hist-link';
  a.href = '/' + it.uuid;
  const title = it.title && it.title.trim() ? it.title : '(無題のPDF)';
  const who = it.owner ? `${escapeHtml(it.owner)}・` : '';
  a.innerHTML =
    `<span class="hist-title">${escapeHtml(title)}</span>` +
    `<span class="hist-meta">${it.hasAudio ? '🎙️ ' : ''}${who}${escapeHtml(fmtDate(it.created))}</span>`;
  row.appendChild(a);
  if (deletable){
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'hist-del';
    del.title = '削除';
    del.setAttribute('aria-label', '削除');
    del.textContent = '🗑';
    del.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!confirm(`「${title}」を削除します。元に戻せません。よろしいですか？`)) return;
      del.disabled = true;
      try {
        const r = await fetch('api.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', uuid: it.uuid }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.status !== 'success') throw new Error(d.message || `削除に失敗しました (${r.status})`);
        row.remove();
      } catch (err) {
        del.disabled = false;
        alert(err.message || '削除に失敗しました');
      }
    });
    row.appendChild(del);
  }
  return row;
}

const VISIBLE = 2;   // 既定：これ以下は全部表示。超えたら先頭だけ出して「もっと見る」で畳む。

function fillList(listId, boxId, items, visible = VISIBLE, deletable = false){
  const list = document.getElementById(listId);
  const box = document.getElementById(boxId);
  if (!list || !box || !items || !items.length) return;
  list.innerHTML = '';
  const rows = items.map(it => makeRow(it, deletable));
  rows.forEach(r => list.appendChild(r));

  if (items.length > visible){
    const hiddenRows = rows.slice(visible);
    hiddenRows.forEach(r => { r.hidden = true; });
    const n = items.length - visible;
    let expanded = false;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'hist-more';
    const setLabel = () => { toggle.textContent = expanded ? '畳む ▲' : `もっと見る（残り${n}件）▼`; };
    setLabel();
    toggle.addEventListener('click', () => {
      expanded = !expanded;
      hiddenRows.forEach(r => { r.hidden = !expanded; });
      setLabel();
    });
    list.appendChild(toggle);
  }
  box.style.display = '';
}

export async function loadMyHistory(){
  if (!document.getElementById('historyBox')) return;   // 未ログインでは要素自体が無い
  try {
    const res = await fetch('api.php?action=mine');
    if (res.status === 401) return;   // 未ログイン
    const data = await res.json();
    renderInReview(data.inreview || []);                      // LabPay依頼の作業中(Phase2)
    renderRequestsIn(data.requests_in || []);                 // 自分に来た依頼(未対応)
    renderRequestsOut(data.requests_out || []);               // 自分が出した依頼
    fillList('sharedList', 'sharedBox', data.shared || []);       // 自分に共有された(既定2件)
    fillList('historyList', 'historyBox', data.items || [], 5, true);   // 自分のチェック履歴は直近5件＋もっと見る（🗑で削除可）
  } catch (e) {
    console.warn('履歴の取得に失敗:', e);
  }
}

// LabPay依頼の「作業中」(Phase2)。タップで /?mr=<key> を開いてチェック。
function renderInReview(items){
  const list = document.getElementById('inreviewList');
  const box = document.getElementById('inreviewBox');
  if (!list || !box || !items || !items.length) return;
  list.innerHTML = '';
  for (const it of items){
    const a = document.createElement('a');
    a.className = 'hist-row';
    a.href = '/?mr=' + encodeURIComponent(it.key);
    const title = it.title && it.title.trim() ? it.title : '(無題のPDF)';
    a.innerHTML =
      `<span class="hist-title">${escapeHtml(title)}</span>` +
      `<span class="hist-meta">${escapeHtml(it.requester || '')}より</span>`;
    list.appendChild(a);
  }
  box.style.display = '';
}

// 自分に来たチェック依頼（未対応のみ）。タップで /?req=<uuid> を開いてチェック。
function renderRequestsIn(items){
  const pend = (items || []).filter(it => it.status !== 'done');
  const list = document.getElementById('requestsInList');
  const box = document.getElementById('requestsInBox');
  if (!list || !box || !pend.length) return;
  list.innerHTML = '';
  for (const it of pend){
    const a = document.createElement('a');
    a.className = 'hist-row';
    a.href = '/?req=' + encodeURIComponent(it.uuid);
    const title = it.title && it.title.trim() ? it.title : '(無題のPDF)';
    a.innerHTML =
      `<span class="hist-title">${escapeHtml(title)}</span>` +
      `<span class="hist-meta">${escapeHtml(it.requester || '')}より</span>`;
    list.appendChild(a);
  }
  box.style.display = '';
}

// 自分が出した依頼。相手ごとの状態（⏳/✅＝結果リンク）を並べる。
function renderRequestsOut(items){
  const list = document.getElementById('requestsOutList');
  const box = document.getElementById('requestsOutBox');
  if (!list || !box || !items || !items.length) return;
  list.innerHTML = '';
  for (const it of items){
    const row = document.createElement('div');
    row.className = 'req-out-row';
    const title = it.title && it.title.trim() ? it.title : '(無題のPDF)';
    const chips = (it.reviewers || []).map(r => {
      if (r.status === 'done' && r.result_uuid){
        return `<a class="req-chip done" href="/${encodeURIComponent(r.result_uuid)}">${escapeHtml(r.name)} ✅</a>`;
      }
      return `<span class="req-chip pending">${escapeHtml(r.name)} ⏳</span>`;
    }).join('');
    row.innerHTML = `<div class="hist-title">${escapeHtml(title)}</div><div class="req-chips">${chips}</div>`;
    list.appendChild(row);
  }
  box.style.display = '';
}
