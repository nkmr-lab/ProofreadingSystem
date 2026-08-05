import { startDrawing, stopDrawing, doDrawing, cancelDrawing } from './drawingHandler.js';
import { appState } from './appState.js';
import { changePage } from './pdfHandler.js';
import { panByScreen, commitPanLog } from './viewportHandler.js';

// ===== スマホ判定 =====
// 指だけの狭い画面のときだけ「移動/手書き」切替を有効にする。
// iPad(coarseだが広い)・PC(fine)は対象外＝従来どおり指＝手書き。
const phoneMQ = window.matchMedia('(pointer: coarse) and (max-width: 640px)');
export function isPhone(){ return phoneMQ.matches; }

// おまかせ判定のパラメータ（画面px基準）
const DECIDE_DIST = 18;     // この距離動いたら「手書き/移動」を確定する
const CURVE_RATIO = 0.86;   // 直進度がこれ未満＝曲がっている→手書き（丸で囲む等）
const HORIZ_RATIO = 0.70;   // 直線でも |dy|<=|dx|*0.70(≒水平±35°)なら手書き（下線）

// 開始点→現在点の向きと曲がり具合から意図を判定する。
function classifyGesture(dx, dy, pathLen){
  const netDist = Math.hypot(dx, dy);
  const straightness = netDist / Math.max(pathLen, 1);
  if (straightness < CURVE_RATIO) return 'draw';          // くねくね・丸→手書き
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ay <= ax * HORIZ_RATIO) return 'draw';               // ほぼ水平→手書き（下線）
  return 'pan';                                            // 縦・斜めの直進→移動
}

export function keydownEvent(event){
  switch(event.key) {
    case 'ArrowRight': changePage(1); break;
    case 'ArrowLeft': changePage(-1); break;
  }
}

export function loadInputSettings(){
  const savedInputMode = localStorage.getItem('inputMode');
  if(savedInputMode){
    try{
      const m = JSON.parse(savedInputMode);
      if(!!m.pen === false) document.getElementById('allowPen').classList.toggle('active');
      if(!!m.touch === false) document.getElementById('allowTouch').classList.toggle('active');
      if(!!m.mouse === false) document.getElementById('allowMouse').classList.toggle('active');
    }catch{}
  }
}

// どの入力を通すか
export function isAllowedPointer(e,){
  if (e.pointerType === 'pen') return !!appState.inputMode.pen;
  if (e.pointerType === 'touch') return !!appState.inputMode.touch;
  if (e.pointerType === 'mouse') return !!appState.inputMode.mouse;
  return false; // 未知は拒否
}

// pointer handlers（stateを参照する）
export function attachPointerDrawing(_pdfSVG){
  // ★追加：アクティブなポインタをロック
  let activePointerId = null;
  let activePointerType = null;

  // スマホの1本指ジェスチャ状態（move/auto時のみ使用）。
  // phase: 'pending'(判定待ち) | 'draw'(手書き中) | 'pan'(移動中)
  let phoneGesture = null;

  const endPhoneGesture = (e) => {
    if (e != null) { try { _pdfSVG.releasePointerCapture(e.pointerId); } catch {} }
    phoneGesture = null;
    activePointerId = null;
    activePointerType = null;
  };

  // スマホ move/auto の move 処理
  const handlePhoneMove = (e) => {
    // 2本指ピンチに移行したら、単指の描画/移動は破棄してジェスチャに委ねる
    if (appState.gesturing) {
      if (phoneGesture.phase === 'draw') { try { cancelDrawing(); } catch {} }
      endPhoneGesture(e);
      return;
    }
    e.preventDefault();

    const dxs = e.clientX - phoneGesture.lastX;
    const dys = e.clientY - phoneGesture.lastY;
    phoneGesture.pathLen += Math.hypot(dxs, dys);
    phoneGesture.lastX = e.clientX;
    phoneGesture.lastY = e.clientY;

    if (phoneGesture.phase === 'pan') {
      panByScreen(dxs, dys);
      return;
    }

    if (phoneGesture.phase === 'draw') {
      doDrawing(e);
      return;
    }

    // phase === 'pending'（おまかせの判定待ち）
    phoneGesture.buf.push(e);
    const dx = e.clientX - phoneGesture.startX;
    const dy = e.clientY - phoneGesture.startY;
    if (Math.hypot(dx, dy) < DECIDE_DIST) return;   // まだ判定に足りない

    const decision = classifyGesture(dx, dy, phoneGesture.pathLen);
    if (decision === 'draw') {
      // それまでの軌跡も含めて手書きとして再生
      const buf = phoneGesture.buf;
      phoneGesture.phase = 'draw';
      phoneGesture.buf = null;
      startDrawing(buf[0]);
      for (let i = 1; i < buf.length; i++) doDrawing(buf[i]);
    } else {
      // 移動：ここを起点にパン開始（判定までの微小移動は捨てる）
      phoneGesture.phase = 'pan';
      phoneGesture.buf = null;
    }
  };

  const onDown = (e) => {
    if (!appState.isCheckerMode) return;
    if (appState.isPaused) return;            // 一時停止中は描かない
    if (appState.gesturing) return;           // 2本指ピンチ/パン中は描かない
    if (!isAllowedPointer(e)) return;

    // 既に別pointerで描画中なら無視（混線防止）
    if (activePointerId != null && activePointerId !== e.pointerId) return;

    // スマホの「移動」「おまかせ」：専用ハンドリング（「手書き」は従来どおり下へ）
    if (isPhone() && e.pointerType === 'touch' && appState.touchMode !== 'draw') {
      e.preventDefault();
      activePointerId = e.pointerId;
      activePointerType = e.pointerType;
      try { _pdfSVG.setPointerCapture(e.pointerId); } catch {}
      phoneGesture = {
        phase: (appState.touchMode === 'move') ? 'pan' : 'pending',
        startX: e.clientX, startY: e.clientY,
        lastX: e.clientX, lastY: e.clientY,
        pathLen: 0,
        buf: (appState.touchMode === 'auto') ? [e] : null,
      };
      return;
    }

    e.preventDefault();

    activePointerId = e.pointerId;
    activePointerType = e.pointerType;

    try { _pdfSVG.setPointerCapture(e.pointerId); } catch {}

    startDrawing(e);
  };

  const onMove = (e) => {
    if (!appState.isCheckerMode) return;

    // スマホ move/auto 中
    if (phoneGesture && e.pointerId === activePointerId) { handlePhoneMove(e); return; }

    if (!isAllowedPointer(e)) return;

    // ★核：activePointerId 以外は無視
    if (activePointerId == null) return;
    if (e.pointerId !== activePointerId) return;

    // ★Wacom/Android対策：hover（押してないmove）を混ぜない
    // pointerType pen で pressure=0 の move が混ざる機種がある
    if (activePointerType === 'pen') {
      const pressed = (e.buttons & 1) === 1;
      // pressure が 0 でも buttons=1 の機種があるので buttons優先
      if (!pressed) return;
    }

    e.preventDefault();
    doDrawing(e);
  };

  const finish = (e) => {
    // スマホ move/auto 中の終了
    if (phoneGesture && e.pointerId === activePointerId) {
      e.preventDefault();
      if (phoneGesture.phase === 'draw') stopDrawing(e);
      else if (phoneGesture.phase === 'pan') commitPanLog();
      // pending のまま指を離した＝タップ：何もしない（誤描画しない）
      endPhoneGesture(e);
      return;
    }

    if (!appState.isCheckerMode) return;
    if (!isAllowedPointer(e)) return;

    // ★核：activePointerId 以外のup/cancel/lostは無視
    if (activePointerId == null) return;
    if (e.pointerId !== activePointerId) return;

    e.preventDefault();
    try { _pdfSVG.releasePointerCapture(e.pointerId); } catch {}

    stopDrawing(e);

    // ★リセット
    activePointerId = null;
    activePointerType = null;
  };

  _pdfSVG.addEventListener('pointerdown', onDown, { passive:false });
  _pdfSVG.addEventListener('pointermove', onMove, { passive:false });
  _pdfSVG.addEventListener('pointerup', finish, { passive:false });
  _pdfSVG.addEventListener('pointercancel', finish, { passive:false });
  _pdfSVG.addEventListener('lostpointercapture', finish, { passive:false });

  _pdfSVG.__ptr = { onDown, onMove, onUp: finish };
}

export function syncStateFromCheckboxes(){
  const pen = document.getElementById('allowPen');
  const touch = document.getElementById('allowTouch');
  const mouse = document.getElementById('allowMouse');

  // 要素が無いなら false 扱い（勝手にtrueにしない）
  appState.inputMode.pen = !!pen?.classList.contains('active');
  appState.inputMode.touch = !!touch?.classList.contains('active');
  appState.inputMode.mouse = !!mouse?.classList.contains('active');
}

export function bindInputModeUI(){
  ['allowPen','allowTouch','allowMouse'].forEach(id=>{
    document.getElementById(id)?.addEventListener('click', ()=>{
      document.getElementById(id).classList.toggle('active');
      syncStateFromCheckboxes();
      console.log(appState.inputMode);
      localStorage.setItem('inputMode', JSON.stringify(appState.inputMode));
    });
  });
}

// ===== スマホ用「移動/手書き」切替UI =====
function reflectTouchModeUI(){
  const map = { draw:'touchModeDraw', move:'touchModeMove', auto:'touchModeAuto' };
  for (const [mode, id] of Object.entries(map)){
    document.getElementById(id)?.classList.toggle('active', appState.touchMode === mode);
  }
}

export function loadTouchMode(){
  const saved = localStorage.getItem('touchMode');
  if (saved === 'draw' || saved === 'move' || saved === 'auto') appState.touchMode = saved;
  reflectTouchModeUI();
}

export function bindTouchModeUI(){
  const set = (mode) => {
    appState.touchMode = mode;
    localStorage.setItem('touchMode', mode);
    reflectTouchModeUI();
  };
  document.getElementById('touchModeDraw')?.addEventListener('click', () => set('draw'));
  document.getElementById('touchModeAuto')?.addEventListener('click', () => set('auto'));
  document.getElementById('touchModeMove')?.addEventListener('click', () => set('move'));
}

// スマホなら Pen/Touch/Mouse を隠して「移動/手書き」切替を出す。
// PC/iPad は従来どおり（指＝手書き）。body.is-phone を CSS で使って表示を切替える。
export function updateInputUIForDevice(){
  const phone = isPhone();
  document.body.classList.toggle('is-phone', phone);
  if (phone) appState.inputMode.touch = true;   // スマホは指を常に通す（用途は touchMode で分岐）
}

export function initDeviceInputUI(){
  updateInputUIForDevice();
  // 端末回転や画面幅変化に追従
  if (phoneMQ.addEventListener) phoneMQ.addEventListener('change', updateInputUIForDevice);
  else if (phoneMQ.addListener) phoneMQ.addListener(updateInputUIForDevice); // 旧Safari
}

// （旧・1本指スワイプでのページ送りは未使用のため削除。
//  ページ送りは ＜前/次＞ ボタンとキーボード矢印で行う。
//  1本指はスマホでは手書き、2本指は viewportHandler の拡大/移動に使う。）
