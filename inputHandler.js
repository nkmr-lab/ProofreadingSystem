import { startDrawing, stopDrawing, doDrawing, cancelDrawing } from './drawingHandler.js';
import { appState } from './appState.js';
import { changePage, pdfDoc } from './pdfHandler.js';
import { panByScreen, commitPanLog, abortGesture } from './viewportHandler.js';
import { hud } from './debugHud.js';

// ===== スマホ判定 =====
// 指だけの狭い画面のときだけ「移動/手書き」切替を有効にする。
// iPad(coarseだが広い)・PC(fine)は対象外＝従来どおり指＝手書き。
const phoneMQ = window.matchMedia('(pointer: coarse) and (max-width: 640px)');
export function isPhone(){ return phoneMQ.matches; }

// ペン(Apple Pencil)筆記を検知したら、この時間だけタッチのズーム/パンを抑止(iPad palm rejection)。
const PEN_GRACE_MS = 800;

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
    if (e.pointerType === 'pen') {
      appState.penActiveUntil = performance.now() + PEN_GRACE_MS;  // palm rejection用
      // ペン優先：手のひらが2点タッチと誤認されて gesturing が立っていても、
      // ペンが降りたらジェスチャ状態を解除して必ず描けるようにする。
      abortGesture();
    }
    hud(`DN ${e.pointerType[0]} id=${e.pointerId} p=${(e.pressure||0).toFixed(2)} act=${activePointerId} g=${appState.gesturing?1:0}`);
    // ペン優先モード：指は一切使わない（描画もジェスチャも。手をついても誤爆しない）。ペンは通す。
    // preventDefault も必ず呼ぶ：手のひらの接触で Safari がスクロール/ジェスチャ判定を始めると、
    // 進行中ペンに pointercancel が飛んで線が途切れるため、ここで指の既定動作を止めておく。
    if (appState.penOnly && e.pointerType === 'touch') { e.preventDefault(); hud('  blk penOnly'); return; }
    if (!appState.isCheckerMode) return;
    if (appState.isPaused) return;            // 一時停止中は描かない
    if (appState.gesturing && e.pointerType !== 'pen') return;   // 2本指ジェスチャ中はタッチ描画しない（ペンは上で解除済み）
    if (!isAllowedPointer(e)) { hud(`  blk notAllowed ${e.pointerType}`); return; }

    // iPad ペン優先(palm rejection):
    // ・ペン筆記中(＋直後GRACE)に来たタッチは描画に使わない＝手のひら誤爆を無視。
    if (e.pointerType === 'touch' && performance.now() < (appState.penActiveUntil || 0)) { hud('  blk palmGrace'); return; }
    // ・ペンは最優先：進行中の別ポインタ(手のひらのタッチ／取りこぼした前のペン)があれば
    //   破棄して奪う（古い activePointerId が残ってペンが弾かれるのを防ぐ）。
    if (e.pointerType === 'pen' && activePointerId != null && activePointerId !== e.pointerId) {
      try { cancelDrawing(); } catch {}
      try { _pdfSVG.releasePointerCapture(activePointerId); } catch {}
      activePointerId = null;
      activePointerType = null;
    }

    // 既に別pointerで描画中なら無視（混線防止。ただしペンは上で奪取済み）
    if (activePointerId != null && activePointerId !== e.pointerId) { hud('  blk busy'); return; }

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

    hud(`  START ${e.pointerType}`);
    startDrawing(e);
  };

  const onMove = (e) => {
    if (e.pointerType === 'pen') appState.penActiveUntil = performance.now() + PEN_GRACE_MS;  // palm rejection用
    if (appState.penOnly && e.pointerType === 'touch') { e.preventDefault(); return; }   // ペン優先：指は無視（既定動作も止める）
    if (!appState.isCheckerMode) return;

    // 取りこぼし保険：ペンが押下中(pressure>0 or buttons)なのに描画が始まっていなければ、
    // ここで開始する（pointerdownが弾かれた/届かなかったケースを救う）。
    if (e.pointerType === 'pen' && activePointerId == null &&
        !appState.isPaused && appState.inputMode.pen &&
        ((e.pressure > 0) || ((e.buttons & 1) === 1))) {
      abortGesture();
      activePointerId = e.pointerId;
      activePointerType = 'pen';
      try { _pdfSVG.setPointerCapture(e.pointerId); } catch {}
      hud('  MV->START pen (recovered)');
      startDrawing(e);
      return;
    }

    // スマホ move/auto 中
    if (phoneGesture && e.pointerId === activePointerId) { handlePhoneMove(e); return; }

    if (!isAllowedPointer(e)) return;

    // ★核：activePointerId 以外は無視
    if (activePointerId == null) return;
    if (e.pointerId !== activePointerId) return;

    // hover（押してないmove）は、そもそも pointerdown が無く activePointerId==null で
    // 上の分岐で弾かれている。ここまで来た pen move は接触中なので、
    // 筆圧0の軽い接触も含めてすべて描く（以前は pressure/buttons=0 を落として
    // Apple Pencil の軽い・短いストロークが頻繁に消えていた＝「何度も書けない」）。

    e.preventDefault();
    // 速い短ストロークは pointermove が間引かれて点が足りず消えやすい。
    // 間引かれた中間点(coalesced)も拾って、短い線も確実に残す。
    const coalesced = (typeof e.getCoalescedEvents === 'function') ? e.getCoalescedEvents() : null;
    if (coalesced && coalesced.length > 1) {
      for (const ce of coalesced) doDrawing(ce);
    } else {
      doDrawing(e);
    }
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

    hud(`${e.type.slice(7,9).toUpperCase()} ${e.pointerType[0]} id=${e.pointerId} act=${activePointerId}`);
    if (!appState.isCheckerMode) return;
    if (appState.penOnly && e.pointerType === 'touch') { e.preventDefault(); return; }   // ペン優先：指は無視（既定動作も止める）
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
  // ★lostpointercapture では finish しない：iPadで手のひらが触れた瞬間などに
  //   ペンの pointer capture がブラウザ都合で外れることがあり、ペンはまだ画面に
  //   着いているのに finish→stopDrawing で線が途中終了・分断されていた（＝「手をつくと書けない」）。
  //   capture が外れても pointermove は SVG 上のペンに届き続けるので、そのまま描き続け、
  //   終了は pointerup / pointercancel だけで確定する。capture 喪失時の掃除は次のペン降下が奪う。
  _pdfSVG.addEventListener('lostpointercapture', (e) => { hud(`LPC ${e.pointerType?.[0]||'?'} (ignored)`); }, { passive:true });

  _pdfSVG.__ptr = { onDown, onMove, onUp: finish };
}

// ===== Pen ON / Touch OFF 時の、指の横スワイプによるページめくり（画面のどこでもOK）=====
// タッチを手書きに使わない設定(inputMode.touch===false)のとき、指は描画に使わない代わりに
//  ・右から左へスワイプ → 次ページ / 左から右へスワイプ → 前ページ（画面端でなくてよい）
// 単指のときだけ扱う（2本指ピンチ/パンは viewport 側）。
// ★ペン筆記中(＋直後GRACE)は無効＝手のひらのドリフトで勝手にページが飛んで書きかけが
//   消えるのを防ぐ。遅い動き(手のひら)も MAX_MS で弾く。
export function attachEdgeSwipeNav(svg){
  if (!svg || svg.__edgeSwipe) return;
  svg.__edgeSwipe = true;

  const MIN_DX = 70;          // ページめくりとみなす最小の横移動(px)
  const OFF_AXIS = 0.7;       // |dy| <= |dx|*0.7 ＝ ほぼ水平なら有効
  const MAX_MS = 700;         // これより遅いスワイプは無視（手のひらのドリフト対策）

  let active = null;          // {id, x0, y0, t0}
  let touchCount = 0;

  const usable = () => appState.isCheckerMode && !appState.inputMode.touch && !appState.penOnly && !!pdfDoc;
  const penActive = () => performance.now() < (appState.penActiveUntil || 0);

  svg.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    touchCount++;
    if (!usable() || penActive() || touchCount > 1) { active = null; return; }  // 描画ON/ペン筆記中/2本指は対象外
    active = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now() };
  }, { passive: true });

  const endTrack = (e) => {
    if (e.pointerType === 'touch') touchCount = Math.max(0, touchCount - 1);
    if (!active || e.pointerId !== active.id) return;
    const a = active; active = null;
    if (!usable() || penActive() || touchCount > 0) return;        // ペン筆記中/指が残る＝対象外
    if (performance.now() - a.t0 > MAX_MS) return;                 // 遅い＝スワイプでない（手のひら）
    const dx = e.clientX - a.x0;
    const dy = e.clientY - a.y0;
    if (Math.abs(dx) < MIN_DX) return;
    if (Math.abs(dy) > Math.abs(dx) * OFF_AXIS) return;            // 縦が大きい＝ページめくりでない
    if (dx < 0) { hud('SWIPE next'); changePage(1); }             // 右→左 ＝ 次ページ
    else        { hud('SWIPE prev'); changePage(-1); }            // 左→右 ＝ 前ページ
  };
  svg.addEventListener('pointerup', endTrack, { passive: true });
  svg.addEventListener('pointercancel', endTrack, { passive: true });
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

// ===== ペン優先モード（手をついても書ける：ONの間は指を完全に無視）=====
// 描画・ピンチ・横スワイプの全タッチ処理を切る。ページ送りは＜前 次＞ボタン/矢印キーで。
export function loadPenOnly(){
  const on = localStorage.getItem('penOnly') === '1';
  appState.penOnly = on;
  document.getElementById('penOnly')?.classList.toggle('active', on);
}
export function bindPenOnlyUI(){
  const b = document.getElementById('penOnly');
  if (!b) return;
  b.addEventListener('click', () => {
    appState.penOnly = !appState.penOnly;
    b.classList.toggle('active', appState.penOnly);
    localStorage.setItem('penOnly', appState.penOnly ? '1' : '0');
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
