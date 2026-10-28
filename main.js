import { changePage, loadPdfFile } from './pdfHandler.js';
import { undoLast } from './drawingHandler.js';
import { updateButtons, toggleDrawingMode, initFileInputButton } from './UIHandler.js';
import { extractUUID } from './subModule.js';
import { bindInputModeUI, syncStateFromCheckboxes, loadInputSettings, keydownEvent,
         bindTouchModeUI, loadTouchMode, initDeviceInputUI, attachEdgeSwipeNav } from './inputHandler.js';
import { appState } from './appState.js';
import { loadDataFromServer, importZipFile, deleteReviewFromServer } from './storageHandler.js';
import { startRecordingOnServer, startRecordingOnLocal, stopRecording, togglePauseRecording } from './recordingHandler.js';
import { initViewport, attachViewportGestures } from './viewportHandler.js';
import { loadSkipSetting, bindSkipSilenceUI } from './silenceHandler.js';
import { initTranscriptUI } from './transcriptHandler.js';
import { loadMyHistory, bindHistoryReload } from './historyHandler.js';
import { openShareDialog } from './shareHandler.js';
import { hud, hudEnabled } from './debugHud.js';
import { initRequestUI, loadRequestForCheck, loadInReviewForCheck, loadReviewForRecheck } from './requestHandler.js';

document.addEventListener('keydown', (event) => keydownEvent(event));

// iOS Safari は user-scalable=no を無視するので、ページ全体のピンチズーム(gesture*)を明示的に抑止。
// アプリのPDF拡大はpointerイベント(viewportHandler)で行うため影響なし。
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}
document.getElementById('next-page').addEventListener('click', () => changePage(1));
document.getElementById('prev-page').addEventListener('click', () => changePage(-1));
document.getElementById('undo').addEventListener('click', undoLast);
document.getElementById('drawing-mode').addEventListener('click', toggleDrawingMode);
document.getElementById('importZipBtn')?.addEventListener('click', () => { document.getElementById('importZipInput')?.click(); });
document.getElementById('importZipInput')?.addEventListener('change', importZipFile);
document.getElementById('recordServer')?.addEventListener('click', startRecordingOnServer);
document.getElementById('recordLocal')?.addEventListener('click', startRecordingOnLocal);
document.getElementById('recordStop')?.addEventListener('click', stopRecording);
document.getElementById('recordPause')?.addEventListener('click', togglePauseRecording);
document.getElementById('deleteReview')?.addEventListener('click', () => deleteReviewFromServer(appState.uuid));
document.getElementById('shareReview')?.addEventListener('click', openShareDialog);

// ユーザーアイコン：タップでログアウトを出す小さなポップオーバー。外側タップで閉じる。
const userAvatar = document.getElementById('userAvatar');
const userPopover = document.getElementById('userPopover');
if (userAvatar && userPopover) {
  userAvatar.addEventListener('click', (e) => {
    e.stopPropagation();
    const willShow = userPopover.hasAttribute('hidden');
    userPopover.toggleAttribute('hidden', !willShow);
    userAvatar.setAttribute('aria-expanded', willShow ? 'true' : 'false');
  });
  document.addEventListener('click', (e) => {
    if (!userPopover.hasAttribute('hidden') && !userPopover.contains(e.target) && e.target !== userAvatar) {
      userPopover.setAttribute('hidden', '');
      userAvatar.setAttribute('aria-expanded', 'false');
    }
  });
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
attachEdgeSwipeNav(_pdfSVGEl);   // Pen ON/Touch OFF 時、指の横スワイプでページめくり

// デバッグHUD(?dbg=1)：起動を1行出し、SVGに届く生ポインタイベントを常時記録。
// 描画が壊れている/リスナ未装着でも「イベントがSVGに届いているか」を切り分けられる。
if (hudEnabled()) {
  hud('HUD ready (dbg on). 描けない時のイベントを記録します');
  const raw = (tag) => (e) => hud(`raw ${tag} ${e.pointerType} id=${e.pointerId} p=${(e.pressure||0).toFixed(2)} b=${e.buttons}`);
  _pdfSVGEl.addEventListener('pointerdown', raw('DN'), { capture: true, passive: true });
  _pdfSVGEl.addEventListener('pointerup',   raw('UP'), { capture: true, passive: true });
  _pdfSVGEl.addEventListener('pointercancel', raw('CX'), { capture: true, passive: true });
}

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

// /?req=<uuid>（pr内の依頼）・/?mr=<key>（LabPay作業中）はチェック(録音)モードで開く。
// uuid抽出より先に判定（?req内のuuidをviewer扱いしない）。
const _params = new URLSearchParams(location.search);
const _reqParam = _params.get('req');
const _mrParam = _params.get('mr');
const _recheckParam = _params.get('recheck');
appState.uuid = (_reqParam || _mrParam || _recheckParam) ? null : extractUUID(window.location.href);
if (_recheckParam) {
  appState.isCheckerMode = true;          // 履歴からやり直し＝その原稿をチェックモードで開く（新規保存）
  initFileInputButton();
  await loadReviewForRecheck(_recheckParam);
} else if (_mrParam) {
  appState.isCheckerMode = true;          // LabPay依頼の原稿をチェックモードで開く
  initFileInputButton();
  await loadInReviewForCheck(_mrParam);   // 保存時に result_callback 返却＋inreview_done
} else if (_reqParam) {
  appState.isCheckerMode = true;          // 原稿をチェック(録音)モードで開く
  initFileInputButton();
  await loadRequestForCheck(_reqParam);   // 依頼原稿を読み込み、保存時に request_done で紐づく
} else if (appState.uuid) {
  appState.isCheckerMode = false;
  await loadDataFromServer(appState.uuid);
} else {
  initFileInputButton();
  await maybeLoadFromHandoff();   // LabPay からの原稿受け取り
  loadMyHistory();               // ホーム：依頼/共有/履歴
  bindHistoryReload();           // ホーム：🔄 届いた依頼を再読み込み
  initRequestUI();               // ホーム：原稿チェックを依頼するボタン
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
    const file = new File([blob], title, { type: 'application/pdf' });
    loadPdfFile(file);
    // トークンをアドレスバー/共有に残さない
    history.replaceState({}, '', location.pathname);

    // ログイン中なら「被依頼」としてpr側に自己登録（PDFコピーを保存し、後で📥一覧から再開できるように）。
    // ＝共有シークレット不要。受けた本人として登録するので email 不一致も起きない。
    if (appState.loggedIn && cb && cbt) {
      try {
        const fd = new FormData(); fd.append('file', file);
        const up = await (await fetch('api.php', { method: 'POST', body: fd })).json();
        if (up && up.uuid) {
          // 依頼主名（LabPayが「校閲する」リンクに requester / from を乗せてくれれば📥に表示できる）
          const requester = p.get('requester') || p.get('from') || '';
          const reg = await (await fetch('api.php', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'received_register', source_pdf_uuid: up.uuid, cb, cbt, title, src, requester }),
          })).json();
          if (reg && reg.key) appState.mrKey = reg.key;   // 今チェックして保存したら inreview_done で消える
        }
      } catch (e) { console.warn('received_register failed', e); }
    }
  } catch (e) {
    console.error(e);
    alert('原稿の取得に失敗しました: ' + (e?.message || e));
  }
}