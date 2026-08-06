// shareHandler.js — 校正結果の共有ダイアログ。
//  - 誰でも: 共有リンクのコピー/ネイティブ共有
//  - 作成者のみ: 「みんなに公開」か「指定した人だけ」を選び、研究室メンバーから相手を選択
// 相手は username（roster）で保持。api.php {action:'recipients'} に保存し、閲覧は api.php GET が制御。
import { appState } from './appState.js';

const GRADE_ORDER = ['教員', 'D3', 'D2', 'D1', 'M2', 'M1', 'B4', 'B3', 'B2', 'B1'];
let rosterCache = null;

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function shareUrl(){ return location.origin + '/' + appState.uuid; }

async function fetchRoster(){
  if (rosterCache) return rosterCache;
  const res = await fetch('api.php?action=roster');
  const data = await res.json();
  const users = (data.users || []).filter(u => u.user && u.user !== 'nkmrlab');
  rosterCache = users;
  return users;
}

export async function openShareDialog(){
  if (!appState.uuid) return;
  closeShareDialog();

  const backdrop = document.createElement('div');
  backdrop.className = 'share-backdrop';
  backdrop.id = 'shareBackdrop';
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeShareDialog(); });

  const ownerSection = appState.isOwner ? `
    <div class="share-access">
      <div class="share-label">共有のしかた</div>
      <label class="share-opt"><input type="radio" name="vis" value="public"> リンクを知っている人みんな</label>
      <label class="share-opt"><input type="radio" name="vis" value="restricted"> 指定した人だけ（限定公開）</label>
      <label class="share-opt"><input type="radio" name="vis" value="open"> 指定した人に届ける＋他の人も見られる</label>
      <div id="shareMembers" class="share-members"><div class="share-loading">読み込み中…</div></div>
      <div class="share-foot">
        <span id="shareStatus" class="share-status"></span>
        <button id="shareSave" class="btn btn--primary">保存</button>
      </div>
    </div>` : '';

  backdrop.innerHTML = `
    <div class="share-modal" role="dialog" aria-modal="true">
      <div class="share-head">
        <span>🔗 共有</span>
        <button id="shareClose" class="btn btn--icon" title="閉じる">✕</button>
      </div>
      <div class="share-link">
        <input id="shareUrl" type="text" readonly value="${escapeHtml(shareUrl())}">
        <button id="shareCopy" class="btn btn--primary">${navigator.share ? '共有' : 'コピー'}</button>
      </div>
      ${ownerSection}
    </div>`;

  document.body.appendChild(backdrop);
  document.getElementById('shareClose').addEventListener('click', closeShareDialog);
  document.getElementById('shareCopy').addEventListener('click', copyOrShare);

  if (appState.isOwner) initOwnerControls();
}

export function closeShareDialog(){
  document.getElementById('shareBackdrop')?.remove();
}

async function copyOrShare(){
  const url = shareUrl();
  try {
    if (navigator.share) { await navigator.share({ title: '校正結果', url }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try {
    await navigator.clipboard.writeText(url);
    const btn = document.getElementById('shareCopy');
    if (btn) { const o = btn.textContent; btn.textContent = 'コピーしました'; setTimeout(()=>{ btn.textContent = o; }, 1500); }
  } catch {
    window.prompt('このURLをコピーして共有してください', url);
  }
}

async function initOwnerControls(){
  // 現在のモードを判定: 相手なし=public / 相手あり&restricted=restricted / 相手あり&公開=open
  let mode = 'public';
  if (appState.recipients.length > 0) mode = appState.restricted ? 'restricted' : 'open';
  for (const r of document.querySelectorAll('input[name="vis"]')){
    r.checked = (r.value === mode);
    r.addEventListener('change', reflectVis);
  }
  document.getElementById('shareSave').addEventListener('click', saveRecipients);

  const membersEl = document.getElementById('shareMembers');
  try {
    const users = await fetchRoster();
    membersEl.innerHTML = renderMembers(users, appState.recipients);
  } catch (e) {
    membersEl.innerHTML = '<div class="share-loading">メンバー一覧を取得できませんでした</div>';
  }
  reflectVis();
}

function reflectVis(){
  const vis = document.querySelector('input[name="vis"]:checked')?.value;
  const m = document.getElementById('shareMembers');
  // public 以外(相手を指定するモード)ではメンバー選択を出す
  if (m) m.style.display = (vis === 'public') ? 'none' : '';
}

function renderMembers(users, selected){
  const sel = new Set(selected);
  const byGrade = {};
  for (const u of users){ (byGrade[u.grade] ||= []).push(u); }
  const grades = Object.keys(byGrade).sort((a,b)=>{
    const ia = GRADE_ORDER.indexOf(a), ib = GRADE_ORDER.indexOf(b);
    return (ia<0?99:ia) - (ib<0?99:ib);
  });
  let html = '';
  for (const g of grades){
    html += `<div class="share-grade">${escapeHtml(g || 'その他')}</div><div class="share-grade-list">`;
    for (const u of byGrade[g]){
      const checked = sel.has(u.user) ? ' checked' : '';
      html += `<label class="share-member"><input type="checkbox" value="${escapeHtml(u.user)}"${checked}> ${escapeHtml(u.name || u.user)}</label>`;
    }
    html += '</div>';
  }
  return html;
}

async function saveRecipients(){
  const vis = document.querySelector('input[name="vis"]:checked')?.value;
  let recipients = [];
  let restricted = false;
  if (vis !== 'public'){
    recipients = Array.from(document.querySelectorAll('#shareMembers input[type="checkbox"]:checked')).map(c => c.value);
    if (recipients.length === 0){ setStatus('相手を1人以上選んでください', true); return; }
    restricted = (vis === 'restricted');   // open は公開のまま届ける
  }
  const btn = document.getElementById('shareSave');
  btn.disabled = true; setStatus('保存中…', false);
  try {
    const res = await fetch('api.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'recipients', uuid: appState.uuid, recipients, restricted }),
    });
    const data = await res.json();
    if (data.status !== 'success') throw new Error(data.message || '保存に失敗しました');
    appState.recipients = data.recipients || [];
    appState.restricted = !!data.restricted;
    let msg;
    if (!appState.recipients.length) msg = 'みんなに公開にしました';
    else if (appState.restricted) msg = `${appState.recipients.length}人だけに限定しました`;
    else msg = `${appState.recipients.length}人に届けました（公開のまま）`;
    setStatus(msg, false);
  } catch (e) {
    setStatus(e.message || String(e), true);
  } finally {
    btn.disabled = false;
  }
}

function setStatus(msg, isErr){
  const el = document.getElementById('shareStatus');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isErr ? 'var(--danger)' : 'var(--muted)';
}
