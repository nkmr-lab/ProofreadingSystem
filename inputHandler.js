import { startDrawing, stopDrawing, doDrawing } from './drawingHandler.js';
import { appState } from './appState.js';
import { changePage } from './pdfHandler.js';

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

  const onDown = (e) => {
    if (!appState.isCheckerMode) return;
    if (appState.gesturing) return;           // 2本指ピンチ/パン中は描かない
    if (!isAllowedPointer(e)) return;

    // 既に別pointerで描画中なら無視（混線防止）
    if (activePointerId != null && activePointerId !== e.pointerId) return;

    e.preventDefault();

    activePointerId = e.pointerId;
    activePointerType = e.pointerType;

    try { _pdfSVG.setPointerCapture(e.pointerId); } catch {}

    startDrawing(e);
  };

  const onMove = (e) => {
    if (!appState.isCheckerMode) return;
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

// （旧・1本指スワイプでのページ送りは未使用のため削除。
//  ページ送りは ＜前/次＞ ボタンとキーボード矢印で行う。
//  1本指はスマホでは手書き、2本指は viewportHandler の拡大/移動に使う。）
