// reviewHandler.js — AI査読パネル（研究室ログイン限定）。
// 原稿PDFをサーバで pdftotext→gpt-4o に通し、構造化レビュー(要約/良い点/改善点/チェックリスト/総評/判定)を
// 文字起こしの隣に表示する。api.php の ai_review(GET=キャッシュ取得 / POST=生成) を使う。
import { appState } from './appState.js';
import { escapeHtml, makePanel } from './subModule.js';

let panelEl = null, bodyEl = null, btnEl = null, panel = null;
let reviewData = null, loaded = false;

function nl2br(s){ return escapeHtml(s).replace(/\n/g, '<br>'); }

export function initReviewUI(){
  panelEl = document.getElementById('reviewPanel');
  panel   = makePanel(panelEl, 'r-open');
  bodyEl  = document.getElementById('reviewBody');
  btnEl   = document.getElementById('genReview');
  if (btnEl) btnEl.addEventListener('click', onButton);
  document.getElementById('reviewClose')?.addEventListener('click', () => panel.show(false));
  document.getElementById('reviewRegen')?.addEventListener('click', () => {
    if (confirm('AI査読をやり直します（APIを再度呼びます）。よろしいですか？')) generate(true);
  });
}

// 閲覧ページ読み込み時。未ログインは api.php が401→静かに終了（UIも出さない）。
export async function loadReview(uuid){
  if (!uuid || !btnEl) return;
  try {
    const res = await fetch('api.php?action=ai_review&uuid=' + encodeURIComponent(uuid));
    if (res.status === 401) return;   // 未ログイン：査読UIは出さない
    const d = await res.json();
    btnEl.style.display = '';          // ログイン済みならボタンを出す
    if (d.has && d.review){ reviewData = d.review; loaded = true; render(); }   // 生成済みは描画（開くのは明示的に）
  } catch (e) {
    console.warn('査読の取得に失敗:', e);
  }
}

async function onButton(){
  if (loaded){ panel.toggle(); return; }   // 生成済み→表示切替
  await generate();                        // 未生成→生成
}

async function generate(force = false){
  const uuid = appState.uuid;
  if (!uuid) return;
  const old = btnEl.textContent;
  btnEl.disabled = true;
  btnEl.textContent = '🧐 査読生成中…';
  try {
    const res = await fetch('api.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ai_review', uuid, force: force ? 1 : 0 }),
    });
    const d = await res.json();
    if (d.status !== 'success' || !d.review) throw new Error(d.message || '失敗しました');
    reviewData = d.review; loaded = true;
    render();
    panel.show(true);
    btnEl.textContent = '🧐 AI査読';
  } catch (e) {
    alert('AI査読に失敗: ' + (e.message || e));
    btnEl.textContent = old;
  } finally {
    btnEl.disabled = false;
  }
}

function render(){
  if (!bodyEl || !reviewData) return;
  const r = reviewData;
  const judge = (r.judgment || '').trim();
  const cls = { '採録':'ok', '条件付き採録':'warn', '再査読':'warn', '不採録':'bad' }[judge] || 'warn';
  let h = '';
  if (judge) h += `<div class="rv-judge rv-${cls}">判定：${escapeHtml(judge)}</div>`;
  if (r.summary) h += `<div class="rv-sec"><h4>要約</h4><div class="rv-text">${nl2br(r.summary)}</div></div>`;
  if (Array.isArray(r.strengths) && r.strengths.length)
    h += `<div class="rv-sec"><h4>👍 良い点</h4><ul>${r.strengths.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul></div>`;
  if (Array.isArray(r.weaknesses) && r.weaknesses.length)
    h += `<div class="rv-sec"><h4>🔧 改善点</h4><ul>${r.weaknesses.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul></div>`;
  if (Array.isArray(r.checklist) && r.checklist.length)
    h += `<div class="rv-sec"><h4>🔍 チェックリスト</h4>${r.checklist.map(c => `<div class="rv-chk"><b>${escapeHtml(c.item || '')}</b>：${escapeHtml(c.comment || '')}</div>`).join('')}</div>`;
  if (r.overall) h += `<div class="rv-sec"><h4>総評</h4><div class="rv-text">${nl2br(r.overall)}</div></div>`;
  h += `<div class="rv-meta">⚠️ AIによる自動査読です。参考情報として確認してください。</div>`;
  bodyEl.innerHTML = h;
}
