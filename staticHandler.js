// staticHandler.js — 静的モード（校正の全書き込みをページ単位で表示）。
//  ・📄 静的モードボタンでトグル。各ページに書き込み全部を重ねて表示（音声同期の再生ではなく最終状態）。
//  ・左右（←前 / 次→）でページ移動。
//  ・ページ一覧パネル（ページ画像＋ペン入りサムネ）。タップでそのページへジャンプ。
import { appState } from './appState.js';
import { pdfDoc, paths, pdfScale, renderPage } from './pdfHandler.js';
import { redrawFromStrokes } from './drawingHandler.js';
import { updateButtons } from './UIHandler.js';
import { resetView } from './viewportHandler.js';

let panelEl = null, thumbsEl = null;
const savedDisp = {};   // 静的モード突入前の文字起こし/査読ボタンの表示状態を覚える

// 静的モードボタンのラベルを切り替える（ONのときは「音声再生モードに戻す」）。
function setStaticBtnLabel(on){
  const b = document.getElementById('staticMode');
  if (!b) return;
  b.textContent = on ? '🔊 音声再生モード' : '📄 静的モード';
  b.title = on ? '音声に同期した再生表示に戻す' : '静的モード（全ページの書き込みを一覧）';
}

// 静的モード中は文字起こし・AI査読（ボタンとパネル）を隠す。突入前の状態は savedDisp に退避。
function hidePanelsForStatic(){
  ['genTranscript', 'genReview'].forEach(id => {
    const b = document.getElementById(id);
    if (b) { savedDisp[id] = b.style.display; b.style.display = 'none'; }
  });
  ['transcriptPanel', 'reviewPanel'].forEach(id => {
    const p = document.getElementById(id);
    if (p) p.style.display = 'none';
  });
  document.body.classList.remove('t-open', 'r-open');   // 左右分割レイアウトも解除
}
function restorePanelsAfterStatic(){
  ['genTranscript', 'genReview'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.style.display = (savedDisp[id] ?? '');   // 突入前の状態へ（未ログインは none のまま）
  });
}

export function initStaticUI(){
  panelEl  = document.getElementById('staticPanel');
  thumbsEl = document.getElementById('staticThumbs');
  document.getElementById('staticMode')?.addEventListener('click', toggleStatic);
  document.getElementById('staticClose')?.addEventListener('click', exitStatic);
  // ページ描画のたびにサムネのハイライトを追従（pdfHandler から通知）
  document.addEventListener('pr:pagerendered', (e) => {
    if (appState.staticMode) highlight(Number(e.detail));
  });
}

export function toggleStatic(){ appState.staticMode ? exitStatic() : enterStatic(); }

function enterStatic(){
  if (!pdfDoc) return;
  appState.staticMode = true;
  try { document.getElementById('audioPlayer')?.pause?.(); } catch {}   // 再生と競合させない
  hidePanelsForStatic();    // 文字起こし・AI査読は静的モード中は消す
  setStaticBtnLabel(true);  // ボタンを「音声再生モードに戻す」に
  if (panelEl) panelEl.style.display = '';
  document.body.classList.add('static-open');
  renderStaticPage(appState.currentPageNum || 1);
  buildThumbs();            // 非同期で一覧を作る
  updateButtons();
}

function exitStatic(){
  appState.staticMode = false;
  if (panelEl) panelEl.style.display = 'none';
  document.body.classList.remove('static-open');
  restorePanelsAfterStatic();   // 文字起こし・AI査読ボタンを元に戻す
  setStaticBtnLabel(false);     // ボタンを「静的モード」に戻す
  // 書き込みを消して現在ページだけに戻す（再生に戻ったら timeline が改めて描く）
  renderPage(appState.currentPageNum || 1);
  try { redrawFromStrokes([], pdfScale); } catch {}
  updateButtons();
}

function renderStaticPage(n){
  if (!pdfDoc) return;
  const num = Math.max(1, Math.min(n, pdfDoc.numPages));
  appState.currentPageNum = num;
  renderPage(num);                 // renderPageAsync が staticMode のとき全ink描画
  try { resetView(false); } catch {}
  highlight(num);
}

// サムネ/外部からのページ移動
export function gotoStaticPage(n){ if (appState.staticMode) renderStaticPage(n); }

function highlight(n){
  if (!thumbsEl) return;
  thumbsEl.querySelectorAll('.static-thumb').forEach(el => {
    el.classList.toggle('active', Number(el.dataset.p) === Number(n));
  });
  const cur = thumbsEl.querySelector('.static-thumb.active');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}

async function buildThumbs(){
  if (!pdfDoc || !thumbsEl) return;
  thumbsEl.innerHTML = '<div class="static-loading">ページを読み込み中…</div>';
  const n = pdfDoc.numPages;
  const frag = document.createDocumentFragment();
  const items = [];
  for (let p = 1; p <= n; p++){
    const item = document.createElement('div');
    item.className = 'static-thumb';
    item.dataset.p = String(p);
    const c = document.createElement('canvas');
    const label = document.createElement('div');
    label.className = 'static-thumb-n';
    label.textContent = 'p.' + p;
    item.appendChild(c);
    item.appendChild(label);
    item.addEventListener('click', () => gotoStaticPage(p));
    frag.appendChild(item);
    items.push([c, p]);
  }
  thumbsEl.innerHTML = '';
  thumbsEl.appendChild(frag);
  highlight(appState.currentPageNum || 1);
  // 画像＋ペンを順次描く（重いので逐次・途中で閉じたら中断）
  for (const [c, p] of items){
    if (!appState.staticMode) return;
    await renderThumb(c, p);
  }
}

async function renderThumb(canvas, p){
  try {
    const page = await pdfDoc.getPage(p);
    const base = page.getViewport({ scale: 1 });
    const THUMB_W = 160;
    const ts = THUMB_W / base.width;
    const vp = page.getViewport({ scale: ts });
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    drawInk(ctx, p, ts);
  } catch (e) {
    console.warn('thumb render failed p' + p, e);
  }
}

// ストロークはページ座標(scale=1)で保存されているので ×ts でサムネへ描く
function drawInk(ctx, pageNum, ts){
  const strokes = paths[pageNum] || [];
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(220,0,0,0.9)';
  ctx.lineWidth = Math.max(1, 2.5 * ts);
  for (const s of strokes){
    const pts = s && s.points;
    if (!Array.isArray(pts) || pts.length < 1) continue;
    ctx.beginPath();
    pts.forEach((pt, i) => {
      const x = (pt.x || 0) * ts, y = (pt.y || 0) * ts;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.stroke();
  }
}
