import { changePage, loadPdfFile } from './pdfHandler.js';
import { undoLast } from './drawingHandler.js';
import { updateButtons, toggleDrawingMode, initFileInputButton } from './UIHandler.js';
import { extractUUID } from './subModule.js';
import { bindInputModeUI, syncStateFromCheckboxes, loadInputSettings, keydownEvent,
         bindTouchModeUI, loadTouchMode, initDeviceInputUI } from './inputHandler.js';
import { appState } from './appState.js';
import { loadDataFromServer, importZipFile, deleteReviewFromServer } from './storageHandler.js';
import { startRecordingOnServer, startRecordingOnLocal, stopRecording } from './recordingHandler.js';
import { initViewport, attachViewportGestures } from './viewportHandler.js';
import { loadSkipSetting, bindSkipSilenceUI } from './silenceHandler.js';
import { initTranscriptUI } from './transcriptHandler.js';

document.addEventListener('keydown', (event) => keydownEvent(event));
document.getElementById('next-page').addEventListener('click', () => changePage(1));
document.getElementById('prev-page').addEventListener('click', () => changePage(-1));
document.getElementById('undo').addEventListener('click', undoLast);
document.getElementById('drawing-mode').addEventListener('click', toggleDrawingMode);
document.getElementById('importZipBtn')?.addEventListener('click', () => { document.getElementById('importZipInput')?.click(); });
document.getElementById('importZipInput')?.addEventListener('change', importZipFile);
document.getElementById('recordServer')?.addEventListener('click', startRecordingOnServer);
document.getElementById('recordLocal')?.addEventListener('click', startRecordingOnLocal);
document.getElementById('recordStop')?.addEventListener('click', stopRecording);
document.getElementById('deleteReview')?.addEventListener('click', () => deleteReviewFromServer(appState.uuid));
document.getElementById('shareReview')?.addEventListener('click', shareReviewLink);

// 校正結果の共有：この閲覧URL(pr.nkmr.io/{uuid})を渡すだけで相手はログイン不要で見られる。
// スマホはネイティブ共有シート、PCはクリップボードへコピー。
async function shareReviewLink(){
  const uuid = appState.uuid;
  if (!uuid) return;
  const url = location.origin + '/' + uuid;
  try {
    if (navigator.share) {
      await navigator.share({ title: '校正結果', text: '校正結果を共有します', url });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;   // ユーザーがシートを閉じただけ
  }
  try {
    await navigator.clipboard.writeText(url);
    alert('共有リンクをコピーしました:\n' + url);
  } catch {
    window.prompt('このURLをコピーして共有してください', url);
  }
}

// nkmr SSO ログイン状態。サーバー録音はログイン時のみ有効。
appState.loggedIn = document.getElementById('bodyContent')?.dataset?.loggedin === '1';
document.getElementById('loginServerBtn')?.addEventListener('click', (e) => {
  const u = e.currentTarget?.dataset?.login;
  if (u) location.href = u;
});

// 使い方カードの「PDFを読み込む」ステップをタップ→PDF読込（PDF読込ボタンと同じ動作）
document.querySelectorAll('.js-load-pdf').forEach((el) => {
  const openPicker = () => document.getElementById('file-select-button')?.click();
  el.addEventListener('click', openPicker);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); }
  });
});

appState.isCheckerMode = document.getElementById('bodyContent')?.dataset?.checker === '1';

// 部分拡大（ピンチ/パン）の初期化。記録側・閲覧側の両方で有効。
const _pdfSVGEl = document.getElementById('pdfSVG');
initViewport(_pdfSVGEl, document.getElementById('pdf-container'));
attachViewportGestures(_pdfSVGEl);

loadInputSettings();
syncStateFromCheckboxes();
bindInputModeUI();

// スマホ用「移動/手書き」切替（PC/iPadでは非表示・無効）
loadTouchMode();
bindTouchModeUI();
initDeviceInputUI();

// 無音スキップ（閲覧ページ）
loadSkipSetting();
bindSkipSilenceUI();

// 文字起こし（研究室ログイン限定・閲覧ページ）
initTranscriptUI();

appState.uuid = extractUUID(window.location.href);
if (appState.uuid) {
  appState.isCheckerMode = false;
  await loadDataFromServer(appState.uuid);
} else {
  initFileInputButton();
  await maybeLoadFromHandoff();   // LabPay からの原稿受け取り
}
updateButtons();

// LabPay の「校閲する」で開かれた場合、?src の原稿(PDF)を取得して校閲モードに載せる。
// src は pay.nkmr.io 限定。校閲結果の返却先(cb/cbt)は appState に保持し、URLからは消す。
async function maybeLoadFromHandoff() {
  const p = new URLSearchParams(location.search);
  const src = p.get('src');
  if (!src) return;

  let u;
  try { u = new URL(src); } catch { return; }
  if (u.protocol !== 'https:' || u.hostname !== 'pay.nkmr.io') {
    alert('不正な転送元です。');
    return;
  }

  const cb = p.get('cb'), cbt = p.get('cbt');
  if (cb && cbt) {
    try { if (new URL(cb).hostname === 'pay.nkmr.io') appState.reviewCb = { cb, cbt }; } catch {}
  }

  try {
    const res = await fetch(src);   // トークン付きURL。cookie不要（CORS許可済）
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const title = p.get('title') || 'document.pdf';
    loadPdfFile(new File([blob], title, { type: 'application/pdf' }));
    // トークンをアドレスバー/共有に残さない
    history.replaceState({}, '', location.pathname);
  } catch (e) {
    console.error(e);
    alert('原稿の取得に失敗しました: ' + (e?.message || e));
  }
}