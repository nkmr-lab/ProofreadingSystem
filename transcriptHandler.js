// transcriptHandler.js — OpenAI Whisper の文字起こしを同期字幕として表示（研究室ログイン限定）。
// 行クリックでその時刻へジャンプ、再生中は現在行をハイライト＆自動スクロール。
import { appState } from './appState.js';

let segments = [];
let audioEl = null;
let listEl = null;
let panelEl = null;
let btnEl = null;
let curIdx = -1;
let synced = false;

function fmt(t){
  const s = Math.max(0, Math.floor(t));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export function initTranscriptUI(){
  panelEl = document.getElementById('transcriptPanel');
  listEl  = document.getElementById('transcriptList');
  btnEl   = document.getElementById('genTranscript');
  if (btnEl) btnEl.addEventListener('click', onButton);
  const closeBtn = document.getElementById('transcriptClose');
  if (closeBtn) closeBtn.addEventListener('click', () => showPanel(false));
  const regenBtn = document.getElementById('transcriptRegen');
  if (regenBtn) regenBtn.addEventListener('click', () => {
    if (confirm('文字起こしをやり直します（APIを再度呼びます）。よろしいですか？')) generate(true);
  });
}

// 閲覧ページ読み込み時。未ログインは transcribe.php が401→静かに終了（UIも出さない）。
export async function loadTranscript(uuid){
  if (!uuid || !btnEl) return;
  try {
    const res = await fetch('transcribe.php?uuid=' + encodeURIComponent(uuid));
    if (res.status === 401) return;   // 未ログイン：文字起こしUIは出さない
    const data = await res.json();
    btnEl.style.display = '';          // ログイン済みならボタンを出す
    if (data.has && Array.isArray(data.segments) && data.segments.length){
      segments = data.segments;
      renderCaptions();
      btnEl.textContent = '📝 文字起こし';
      showPanel(true);                 // 既定で字幕を表示（音声なしでも読める。✕で閉じられる）
    } else {
      btnEl.textContent = '📝 文字起こし';   // 未生成：押すと生成
    }
  } catch (e) {
    console.warn('文字起こしの取得に失敗:', e);
  }
}

async function onButton(){
  if (segments.length){ togglePanel(); return; }   // 生成済み→表示切替
  await generate();                                 // 未生成→生成
}

async function generate(force = false){
  const uuid = appState.uuid;
  if (!uuid) return;
  const old = btnEl.textContent;
  btnEl.disabled = true;
  btnEl.textContent = '⏳ 文字起こし中…';
  try {
    const body = 'uuid=' + encodeURIComponent(uuid) + (force ? '&force=1' : '');
    const res = await fetch('transcribe.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await res.json();
    if (data.status === 'error') throw new Error(data.message || '失敗しました');
    segments = data.segments || [];
    renderCaptions();
    btnEl.textContent = '📝 文字起こし';
    showPanel(true);
  } catch (e) {
    alert('文字起こしに失敗: ' + (e.message || e));
    btnEl.textContent = old;
  } finally {
    btnEl.disabled = false;
  }
}

function renderCaptions(){
  audioEl = document.getElementById('audioPlayer');
  if (!listEl) return;
  listEl.innerHTML = '';
  segments.forEach((seg, i) => {
    const row = document.createElement('div');
    row.className = 'cap-row';
    row.dataset.i = i;
    row.innerHTML = `<span class="cap-t">${fmt(seg.start)}</span><span class="cap-x">${escapeHtml(seg.text)}</span>`;
    row.addEventListener('click', () => {
      if (audioEl){ audioEl.currentTime = seg.start; audioEl.play?.().catch(()=>{}); }
    });
    listEl.appendChild(row);
  });
  if (audioEl && !synced){
    audioEl.addEventListener('timeupdate', highlight);
    synced = true;
  }
}

function highlight(){
  if (!segments.length || !audioEl || !listEl) return;
  const t = audioEl.currentTime;
  let idx = -1;
  for (let i = 0; i < segments.length; i++){
    if (t >= segments[i].start && t < segments[i].end){ idx = i; break; }
    if (t < segments[i].start) break;
  }
  if (idx === curIdx) return;
  const rows = listEl.children;
  if (curIdx >= 0 && rows[curIdx]) rows[curIdx].classList.remove('active');
  curIdx = idx;
  if (idx >= 0 && rows[idx]){
    rows[idx].classList.add('active');
    rows[idx].scrollIntoView({ block: 'nearest' });
  }
}

function showPanel(v){ if (panelEl) panelEl.style.display = v ? '' : 'none'; }
function togglePanel(){ if (panelEl) showPanel(panelEl.style.display === 'none'); }
