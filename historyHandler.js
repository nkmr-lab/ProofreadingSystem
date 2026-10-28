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
// ISO文字列 → 秒まで（どれが新しい依頼か見分ける用）
function fmtDateTimeSec(iso){
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
// バイト数 → 読みやすいサイズ（同じ原稿か判別する用）
function fmtSize(bytes){
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 2 : 1)} MB`;
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
    // ⋯メニュー（クリックで「録音し直す／削除」を表示）。誤タップで即発火しないようにする。
    bindHistMenuGlobalClose();
    const menu = document.createElement('div');
    menu.className = 'hist-menu';

    const mbtn = document.createElement('button');
    mbtn.type = 'button';
    mbtn.className = 'hist-menu-btn';
    mbtn.title = 'メニュー';
    mbtn.setAttribute('aria-label', 'メニュー');
    mbtn.setAttribute('aria-expanded', 'false');
    mbtn.textContent = '⋯';

    const pop = document.createElement('div');
    pop.className = 'hist-menu-pop';
    pop.hidden = true;

    const redoItem = document.createElement('button');
    redoItem.type = 'button';
    redoItem.className = 'hist-menu-item';
    redoItem.textContent = '🔁 録音し直す';
    redoItem.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      pop.hidden = true;
      mbtn.setAttribute('aria-expanded', 'false');
      if (!confirm(`「${title}」をもう一度チェックします（録音し直し）。よろしいですか？`)) return;
      location.assign('/?recheck=' + encodeURIComponent(it.uuid));
    });

    const delItem = document.createElement('button');
    delItem.type = 'button';
    delItem.className = 'hist-menu-item hist-menu-item--danger';
    delItem.textContent = '🗑 削除';
    delItem.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      pop.hidden = true;
      mbtn.setAttribute('aria-expanded', 'false');
      if (!confirm(`「${title}」を削除します。元に戻せません。よろしいですか？`)) return;
      delItem.disabled = true;
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
        delItem.disabled = false;
        alert(err.message || '削除に失敗しました');
      }
    });

    pop.appendChild(redoItem);
    pop.appendChild(delItem);

    mbtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const willOpen = pop.hidden;
      closeAllHistMenus();
      pop.hidden = !willOpen;
      mbtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });

    menu.appendChild(mbtn);
    menu.appendChild(pop);
    row.appendChild(menu);
  }
  return row;
}

// 開いている履歴メニューを全部閉じる
function closeAllHistMenus(){
  document.querySelectorAll('.hist-menu-pop:not([hidden])').forEach(p => {
    p.hidden = true;
    const b = p.parentElement && p.parentElement.querySelector('.hist-menu-btn');
    if (b) b.setAttribute('aria-expanded', 'false');
  });
}
// 画面のどこかをクリックしたらメニューを閉じる（一度だけ登録）
let histMenuBound = false;
function bindHistMenuGlobalClose(){
  if (histMenuBound) return;
  histMenuBound = true;
  document.addEventListener('click', () => closeAllHistMenus());
}

// api.php への JSON POST（成功以外は例外）
async function apiPost(body){
  const r = await fetch('api.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.status !== 'success') throw new Error(d.message || `失敗しました (${r.status})`);
  return d;
}

// 名前の先頭1文字（絵文字・サロゲートも1文字として安全に取り出す）
function firstChar(s){
  s = (s || '').trim();
  if (!s) return '';
  return Array.from(s)[0] || '';
}

// 「届いた依頼」用の1行（依頼主アイコン＋名前／タイトル＋🗑削除）。削除は本人が明示的に押したときだけ実行。
//  opts: { href, title, requester, requesterFallbackLabel, avatarFallback, list, box, onDelete }
function makeIncomingRow(opts){
  const row = document.createElement('div');
  row.className = 'hist-row';
  const a = document.createElement('a');
  a.className = 'hist-link hist-link--req';
  a.href = opts.href;
  const req = (opts.requester || '').trim();
  const initial = req ? firstChar(req) : (opts.avatarFallback || '👤');
  const who = req ? `依頼主: ${req}` : (opts.requesterFallbackLabel || '');
  // 2行目：依頼日時（秒まで）・ファイルサイズ（どれが新しいか／同じ原稿かを見分ける）
  const subParts = [];
  const dt = fmtDateTimeSec(opts.created);
  if (dt) subParts.push(dt);
  const sz = fmtSize(opts.size);
  if (sz) subParts.push(sz);
  const sub = subParts.join(' ・ ');
  a.innerHTML =
    `<span class="req-avatar${req ? '' : ' req-avatar--unknown'}">${escapeHtml(initial)}</span>` +
    `<span class="req-text">` +
      `<span class="hist-title">${escapeHtml(opts.title)}</span>` +
      (who ? `<span class="hist-meta">${escapeHtml(who)}</span>` : '') +
      (sub ? `<span class="hist-meta hist-sub">${escapeHtml(sub)}</span>` : '') +
    `</span>`;
  row.appendChild(a);
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'hist-del';
  del.title = '削除';
  del.setAttribute('aria-label', '削除');
  del.textContent = '🗑';
  del.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`「${opts.title || '(無題のPDF)'}」を届いた依頼の一覧から削除します。よろしいですか？`)) return;
    del.disabled = true;
    try {
      await opts.onDelete();
      row.remove();
      if (opts.list && opts.box && !opts.list.querySelector('.hist-row')) opts.box.style.display = 'none';
    } catch (err) {
      del.disabled = false;
      alert(err?.message || '削除に失敗しました');
    }
  });
  row.appendChild(del);
  return row;
}

const VISIBLE = 2;   // 既定：これ以下は全部表示。超えたら先頭だけ出して「もっと見る」で畳む。

function fillList(listId, boxId, items, visible = VISIBLE, deletable = false){
  const list = document.getElementById(listId);
  const box = document.getElementById(boxId);
  if (!list || !box) return;
  list.innerHTML = '';                                   // 再読み込みでも重複しないよう毎回クリア
  if (!items || !items.length){ box.style.display = 'none'; return; }   // 空なら箱ごと隠す
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
    const res = await fetch('api.php?action=mine', { cache: 'no-store' });
    if (res.status === 401) return;   // 未ログイン
    const data = await res.json();
    renderInReview(data.inreview || []);                      // LabPay依頼の作業中(Phase2)
    renderRequestsIn(data.requests_in || []);                 // 自分に来た依頼(未対応)
    renderRequestsOut(data.requests_out || []);               // 自分が出した依頼
    fillList('sharedList', 'sharedBox', data.shared || []);       // 自分に共有された(既定2件)
    fillList('historyList', 'historyBox', data.items || [], 5, true);   // 自分のチェック履歴は直近5件＋もっと見る（🗑で削除可）
    // チェック履歴がある人には「システムの使い方」は不要なので隠す（初めての人にだけ出す）
    const desc = document.getElementById('description');
    if (desc && (data.items || []).length > 0) desc.style.display = 'none';
  } catch (e) {
    console.warn('履歴の取得に失敗:', e);
  }
}

// ホームの「🔄 届いた依頼を再読み込み」ボタン。ページ全体をリロードせず、
// 届いた依頼・共有・履歴の一覧だけを最新化する。
export function bindHistoryReload(){
  const btn = document.getElementById('reloadRequests');
  if (!btn) return;
  const base = btn.textContent;
  let busy = false;
  btn.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    btn.textContent = '🔄 更新中…';
    try {
      await loadMyHistory();
      btn.textContent = '✓ 最新にしました';
    } catch {
      btn.textContent = '⚠ 更新に失敗';
    }
    setTimeout(() => { btn.textContent = base; btn.disabled = false; busy = false; }, 1200);
  });
}

// LabPay依頼の「作業中」(Phase2)。タップで /?mr=<key> を開いてチェック。
function renderInReview(items){
  const list = document.getElementById('inreviewList');
  const box = document.getElementById('inreviewBox');
  if (!list || !box) return;
  list.innerHTML = '';
  if (!items || !items.length){ box.style.display = 'none'; return; }
  for (const it of items){
    const title = it.title && it.title.trim() ? it.title : '(無題のPDF)';
    list.appendChild(makeIncomingRow({
      href: '/?mr=' + encodeURIComponent(it.key),
      title,
      requester: it.requester || '',
      requesterFallbackLabel: 'LabPay依頼',
      avatarFallback: '📥',
      created: it.accepted_at || '',
      size: it.size,
      list, box,
      onDelete: () => apiPost({ action: 'inreview_done', key: it.key }),   // 作業中から外す＋受領コピー掃除
    }));
  }
  box.style.display = '';
}

// 自分に来たチェック依頼（未対応のみ）。タップで /?req=<uuid> を開いてチェック。
function renderRequestsIn(items){
  const pend = (items || []).filter(it => it.status !== 'done');
  const list = document.getElementById('requestsInList');
  const box = document.getElementById('requestsInBox');
  if (!list || !box) return;
  list.innerHTML = '';
  if (!pend.length){ box.style.display = 'none'; return; }
  for (const it of pend){
    const title = it.title && it.title.trim() ? it.title : '(無題のPDF)';
    list.appendChild(makeIncomingRow({
      href: '/?req=' + encodeURIComponent(it.uuid),
      title,
      requester: it.requester || '',
      requesterFallbackLabel: '依頼主不明',
      avatarFallback: '👤',
      created: it.created || '',
      size: it.size,
      list, box,
      onDelete: () => apiPost({ action: 'request_dismiss', uuid: it.uuid }),   // 自分の分だけ依頼から外す
    }));
  }
  box.style.display = '';
}

// 自分が出した依頼。相手ごとの状態（⏳/✅＝結果リンク）を並べる。
function renderRequestsOut(items){
  const list = document.getElementById('requestsOutList');
  const box = document.getElementById('requestsOutBox');
  if (!list || !box) return;
  list.innerHTML = '';
  if (!items || !items.length){ box.style.display = 'none'; return; }
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
    const info = document.createElement('div');
    info.className = 'req-out-info';
    info.innerHTML = `<div class="hist-title">${escapeHtml(title)}</div><div class="req-chips">${chips}</div>`;
    row.appendChild(info);
    // 🗑 取り下げ：自分が出した依頼をキャンセル（依頼者のみ）
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'hist-del';
    del.title = '依頼を取り下げる';
    del.setAttribute('aria-label', '依頼を取り下げる');
    del.textContent = '🗑';
    del.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!confirm(`「${title}」の依頼を取り下げます。よろしいですか？`)) return;
      del.disabled = true;
      try {
        await apiPost({ action: 'request_cancel', uuid: it.uuid });
        row.remove();
        if (!list.querySelector('.req-out-row')) box.style.display = 'none';
      } catch (err) {
        del.disabled = false;
        alert(err?.message || '取り下げに失敗しました');
      }
    });
    row.appendChild(del);
    list.appendChild(row);
  }
  box.style.display = '';
}
