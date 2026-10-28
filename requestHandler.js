// requestHandler.js — pr 単独の「原稿チェック依頼」。
//  依頼者: PDFをアップロード→相手(複数)を選んで依頼。
//  レビュアー: /?req=<uuid> で原稿をチェック(録音)モードで開き、保存で結果が依頼に紐づく。
import { appState } from './appState.js';
import { loadPdfFile } from './pdfHandler.js';

const GRADE_ORDER = ['教員', 'D3', 'D2', 'D1', 'M2', 'M1', 'B4', 'B3', 'B2', 'B1'];
let rosterCache = null;

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
async function fetchRoster(){
  if (rosterCache) return rosterCache;
  const res = await fetch('api.php?action=roster');
  const data = await res.json();
  rosterCache = (data.users || []).filter(u => u.user && u.user !== 'nkmrlab');
  return rosterCache;
}

// ===== 依頼者側：作成フロー =====
export function initRequestUI(){
  const btn = document.getElementById('requestBtn');
  const input = document.getElementById('requestFileInput');
  if (!btn || !input) return;
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (file.type && file.type !== 'application/pdf') { alert('PDFファイルを選んでください。'); return; }
    const old = btn.textContent;
    btn.disabled = true; btn.textContent = 'アップロード中…';
    try {
      const uuid = await uploadPdf(file);
      await openRequestModal(uuid, file.name);
    } catch (e) {
      alert('アップロードに失敗しました: ' + (e.message || e));
    } finally {
      btn.disabled = false; btn.textContent = old;
    }
  });
}

async function uploadPdf(file){
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('api.php', { method: 'POST', body: form });
  const data = await res.json().catch(() => null);
  if (!data || !data.uuid) throw new Error((data && data.message) || 'PDF upload failed');
  return data.uuid;
}

async function openRequestModal(uuid, filename){
  closeRequestModal();
  const backdrop = document.createElement('div');
  backdrop.className = 'share-backdrop';
  backdrop.id = 'reqBackdrop';
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeRequestModal(); });
  backdrop.innerHTML = `
    <div class="share-modal" role="dialog" aria-modal="true">
      <div class="share-head">
        <span>📨 チェックを依頼</span>
        <button id="reqClose" class="btn btn--icon" title="閉じる">✕</button>
      </div>
      <div class="req-file">原稿：${escapeHtml(filename)}</div>
      <div class="share-label">チェックしてもらう人（複数可）</div>
      <div id="reqMembers" class="share-members"><div class="share-loading">読み込み中…</div></div>
      <textarea id="reqMessage" class="req-message" placeholder="ひとこと（任意）"></textarea>
      <div class="share-foot">
        <span id="reqStatus" class="share-status"></span>
        <button id="reqSend" class="btn btn--primary">依頼する</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  document.getElementById('reqClose').addEventListener('click', closeRequestModal);
  document.getElementById('reqSend').addEventListener('click', () => sendRequest(uuid));

  const membersEl = document.getElementById('reqMembers');
  try {
    const users = await fetchRoster();
    membersEl.innerHTML = renderMembers(users);
  } catch {
    membersEl.innerHTML = '<div class="share-loading">メンバー一覧を取得できませんでした</div>';
  }
}
function closeRequestModal(){ document.getElementById('reqBackdrop')?.remove(); }

// チェックを依頼できる相手の学年（OB・B2以下は候補に出さない）
const REVIEWER_GRADES = new Set(['教員', 'D3', 'D2', 'D1', 'M2', 'M1', 'B4', 'B3']);

function renderMembers(users){
  const byGrade = {};
  for (const u of users){ if (!REVIEWER_GRADES.has(u.grade)) continue; (byGrade[u.grade] ||= []).push(u); }
  const grades = Object.keys(byGrade).sort((a,b)=>{
    const ia = GRADE_ORDER.indexOf(a), ib = GRADE_ORDER.indexOf(b);
    return (ia<0?99:ia) - (ib<0?99:ib);
  });
  let html = '';
  for (const g of grades){
    html += `<div class="share-grade">${escapeHtml(g || 'その他')}</div><div class="share-grade-list">`;
    for (const u of byGrade[g]){
      html += `<label class="share-member"><input type="checkbox" value="${escapeHtml(u.user)}" data-name="${escapeHtml(u.name || u.user)}"> ${escapeHtml(u.name || u.user)}</label>`;
    }
    html += '</div>';
  }
  return html;
}

async function sendRequest(uuid){
  const checked = Array.from(document.querySelectorAll('#reqMembers input[type="checkbox"]:checked'));
  if (checked.length === 0){ setStatus('相手を1人以上選んでください', true); return; }
  const reviewers = checked.map(c => ({ user: c.value, name: c.dataset.name || c.value }));
  const message = document.getElementById('reqMessage')?.value || '';
  const btn = document.getElementById('reqSend');
  btn.disabled = true; setStatus('送信中…', false);
  try {
    const res = await fetch('api.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'request_create', uuid, reviewers, message }),
    });
    const data = await res.json();
    if (data.status !== 'success') throw new Error(data.message || '失敗しました');
    closeRequestModal();
    alert(`${data.count}人にチェックを依頼しました。`);
    location.assign('/');   // ホームへ（依頼一覧に出る）
  } catch (e) {
    setStatus(e.message || String(e), true);
    btn.disabled = false;
  }
}
function setStatus(msg, isErr){
  const el = document.getElementById('reqStatus');
  if (el){ el.textContent = msg; el.style.color = isErr ? 'var(--danger)' : 'var(--muted)'; }
}

// ===== レビュアー側：依頼の原稿をチェックモードで開く（/?req=<uuid>） =====
export async function loadRequestForCheck(reqUuid){
  try {
    const res = await fetch('api.php?action=request_get&uuid=' + encodeURIComponent(reqUuid));
    const data = await res.json();
    if (data.status !== 'success'){ alert(data.message || '依頼を開けませんでした'); location.assign('/'); return; }

    const pres = await fetch(data.pdf);
    if (!pres.ok) throw new Error('PDF ' + pres.status);
    const blob = await pres.blob();
    const title = (data.title && data.title.trim()) ? data.title : 'document.pdf';
    loadPdfFile(new File([blob], title.endsWith('.pdf') ? title : title + '.pdf', { type: 'application/pdf' }));

    appState.reqUuid = reqUuid;
    // 「〜さんからの依頼」上部バナーは出さない（依頼主・日時・サイズはホーム一覧に表示）。
  } catch (e) {
    console.error(e);
    alert('依頼原稿の取得に失敗しました: ' + (e.message || e));
    location.assign('/');
  }
}

// ===== 履歴からのやり直し：/?recheck=<uuid> で、その原稿をもう一度チェックモードで開く =====
// 保存時は新規の校正として作られる（元の履歴は残る。不要なら履歴の🗑で消す）。
export async function loadReviewForRecheck(uuid){
  try {
    const pres = await fetch('files/' + encodeURIComponent(uuid) + '.pdf');
    if (!pres.ok) throw new Error('PDF ' + pres.status);
    const blob = await pres.blob();
    loadPdfFile(new File([blob], 'document.pdf', { type: 'application/pdf' }));
    // req/mr の紐付けはしない（単独の再チェック）。appState.uuid=null のまま＝保存時に新UUIDで作成。
  } catch (e) {
    console.error(e);
    alert('原稿の取得に失敗しました: ' + (e.message || e));
    location.assign('/');
  }
}

// ===== LabPay作業中タスク(Phase2)：/?mr=<key> で原稿をチェックモードで開く =====
export async function loadInReviewForCheck(key){
  try {
    const res = await fetch('api.php?action=inreview_get&key=' + encodeURIComponent(key));
    const data = await res.json();
    if (data.status !== 'success'){ alert(data.message || '作業中タスクを開けませんでした'); location.assign('/'); return; }

    // pr側に保存したコピーがあればそれを使う（pull_urlの15分TTL切れでも開ける）。無ければpull_url。
    const pdfSrc = data.source_pdf_uuid ? ('files/' + data.source_pdf_uuid + '.pdf') : data.pull_url;
    const pres = await fetch(pdfSrc);
    if (!pres.ok) throw new Error('pull ' + pres.status);
    const blob = await pres.blob();
    const title = (data.title && data.title.trim()) ? data.title : 'document.pdf';
    loadPdfFile(new File([blob], title.endsWith('.pdf') ? title : title + '.pdf', { type: 'application/pdf' }));

    // 保存時に結果を LabPay の result_callback へ返す（postReviewResult が叩く）。cbt が無いと返せない。
    if (data.result_callback && data.cbt) appState.reviewCb = { cb: data.result_callback, cbt: data.cbt };
    appState.mrKey = key;

    // 「〜さんからの依頼」上部バナーは出さない（依頼主・日時・サイズはホーム一覧に表示）。
    // ただし自動返却トークンが無いときだけは、保存してもLabPayへ戻らない重要警告を出す。
    const el = document.getElementById('reqBanner');
    if (el && !data.cbt){
      el.innerHTML = '<div class="req-banner-hint">※結果の自動返却トークンが無いため、保存してもLabPayへは自動で戻りません。保存後に表示されるURLを手動で共有してください。</div>';
      el.style.display = '';
    }
  } catch (e) {
    console.error(e);
    alert('原稿の取得に失敗しました（リンク期限切れの可能性）。LabPayから開き直してください: ' + (e.message || e));
    location.assign('/');
  }
}
