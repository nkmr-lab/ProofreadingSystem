// viewportHandler.js
// 部分拡大（ピンチ/パン）を CSS transform で実現し、その表示範囲を
// 「ページに対する正規化矩形(0〜1)」としてタイムラインに記録・再生する。
//  - 2本指ピンチ = 拡大縮小 / 2本指ドラッグ = 移動 / 1本指 = 手書き（drawingHandler）
//  - 記録側: 表示が変わるたびに logView() で view イベントを追加
//  - 再生側: applyNormalizedView() で見る人の画面を同じ範囲へ寄せる（自動追従）
import { appState } from './appState.js';
import { cancelDrawing } from './drawingHandler.js';
import { logView, isRecordingTimeline } from './timelineHandler.js';

const MIN_SCALE = 1;      // これ以上引けない（ページ全体でストップ）
const MAX_SCALE = 6;      // 最大600%
const LOG_THROTTLE_MS = 90;

let svg = null;
let container = null;

// 現在の変形（transform-origin:0 0, transform = translate(tx,ty) scale(s)）
let s = 1, tx = 0, ty = 0;

// ピンチ用に生きているタッチを保持
const pts = new Map(); // pointerId -> {x,y}
let gesture = null;     // {s0,tx0,ty0, d0, midU, midV, mode}

let lastLogAt = 0;
let userTouchedDuringPlayback = false; // 再生中に見る人が触ったか（未使用フラグ, 将来用）

export function initViewport(_svg, _container) {
  svg = _svg;
  container = _container;
  if (!svg) return;
  svg.style.transformOrigin = '0 0';
  svg.style.willChange = 'transform';
  applyTransform(false);
}

export function getViewScale() { return s; }

function applyTransform(animate) {
  if (!svg) return;
  svg.style.transition = animate ? 'transform 280ms ease' : 'none';
  svg.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
}

// 変形せずのレイアウト原点（画面座標）。transform=translate(tx,ty)scale(s), origin0,0 なので
// getBoundingClientRect().left = L0 + tx  → L0 = rect.left - tx
function layoutOrigin() {
  const r = svg.getBoundingClientRect();
  return { L0: r.left - tx, T0: r.top - ty };
}

function elemSize() {
  return { EW: svg.clientWidth || 1, EH: svg.clientHeight || 1 };
}

// パンのはみ出しを抑える（ページが画面を覆う範囲に収める）
function clampTranslate() {
  if (!container) return;
  const c = container.getBoundingClientRect();
  const { L0, T0 } = layoutOrigin();
  const { EW, EH } = elemSize();
  const pageW = s * EW, pageH = s * EH;

  // 水平
  if (pageW <= c.width) {
    tx = (c.left + (c.width - pageW) / 2) - L0;           // 収まるなら中央
  } else {
    const minTx = (c.right - pageW) - L0;                  // 右端をコンテナ右に
    const maxTx = c.left - L0;                             // 左端をコンテナ左に
    tx = Math.min(maxTx, Math.max(minTx, tx));
  }
  // 垂直
  if (pageH <= c.height) {
    ty = (c.top + (c.height - pageH) / 2) - T0;
  } else {
    const minTy = (c.bottom - pageH) - T0;
    const maxTy = c.top - T0;
    ty = Math.min(maxTy, Math.max(minTy, ty));
  }
}

// ===== 記録: 現在の表示範囲を正規化(0〜1)で返す =====
export function currentNormalizedView() {
  if (!svg || !container) return { nx: 0, ny: 0, nw: 1, nh: 1 };
  const e = svg.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  const cl = (v) => Math.min(1, Math.max(0, v));
  const nx = cl((c.left - e.left) / e.width);
  const ny = cl((c.top - e.top) / e.height);
  const nx2 = cl((c.right - e.left) / e.width);
  const ny2 = cl((c.bottom - e.top) / e.height);
  return { nx, ny, nw: Math.max(0.02, nx2 - nx), nh: Math.max(0.02, ny2 - ny) };
}

function maybeLogView(force) {
  if (!isRecordingTimeline()) return;
  const now = performance.now();
  if (!force && now - lastLogAt < LOG_THROTTLE_MS) return;
  lastLogAt = now;
  logView(appState.currentPageNum, currentNormalizedView());
}

// ===== 再生: 正規化ビューを画面に反映（contain-fit で寄せる） =====
export function applyNormalizedView(view, animate = true) {
  if (!svg || !container || !view) return;
  const { EW, EH } = elemSize();
  const c = container.getBoundingClientRect();
  const { L0, T0 } = layoutOrigin();

  const rw = Math.max(1, view.nw * EW);
  const rh = Math.max(1, view.nh * EH);
  const rx = view.nx * EW;
  const ry = view.ny * EH;

  let ns = Math.min(c.width / rw, c.height / rh);
  ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, ns));

  const ox = (c.width - ns * rw) / 2;
  const oy = (c.height - ns * rh) / 2;

  s = ns;
  tx = c.left + ox - L0 - ns * rx;
  ty = c.top + oy - T0 - ns * ry;
  clampTranslate();
  applyTransform(animate);
}

// ===== 1本指パン（スマホの「移動」用） =====
// 2本指ジェスチャとは別に、画面座標の移動量で平行移動する。
// 拡大していない(=収まっている)ときは clampTranslate が中央へ戻すので実質動かない。
export function panByScreen(dxScreen, dyScreen) {
  if (!svg) return;
  tx += dxScreen;
  ty += dyScreen;
  clampTranslate();
  applyTransform(false);
  maybeLogView(false);
}

// 1本指パンの終了時に最終表示範囲を確定記録する。
export function commitPanLog() {
  maybeLogView(true);
}

export function resetView(log = false, animate = false) {
  s = 1; tx = 0; ty = 0;
  clampTranslate();
  applyTransform(animate);
  if (log) maybeLogView(true);
}

// ===== ジェスチャ（2本指ピンチ/パン） =====
export function attachViewportGestures(_svg) {
  if (!_svg || _svg.__vpAttached) return;
  _svg.__vpAttached = true;

  const onDown = (e) => {
    if (e.pointerType !== 'touch') return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      // 2本目 → ピンチ開始。進行中の手書きは破棄。
      appState.gesturing = true;
      try { cancelDrawing(); } catch {}
      startGesture();
    }
  };

  const onMove = (e) => {
    if (e.pointerType !== 'touch') return;
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (appState.gesturing && pts.size >= 2) {
      e.preventDefault();
      updateGesture();
      maybeLogView(false);
    }
  };

  const onUp = (e) => {
    if (e.pointerType !== 'touch') return;
    pts.delete(e.pointerId);
    if (pts.size < 2 && appState.gesturing) {
      appState.gesturing = false;
      gesture = null;
      clampTranslate();
      applyTransform(false);
      maybeLogView(true); // 最終位置を確定記録
    }
  };

  _svg.addEventListener('pointerdown', onDown, { passive: false });
  _svg.addEventListener('pointermove', onMove, { passive: false });
  _svg.addEventListener('pointerup', onUp, { passive: false });
  _svg.addEventListener('pointercancel', onUp, { passive: false });
}

function twoPoints() {
  const it = pts.values();
  const a = it.next().value, b = it.next().value;
  return [a, b];
}

function startGesture() {
  const [a, b] = twoPoints();
  if (!a || !b) return;
  const d0 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const { L0, T0 } = layoutOrigin();
  // 中点直下のローカル座標（拡大の支点を固定するため）
  const midU = (mx - (L0 + tx)) / s;
  const midV = (my - (T0 + ty)) / s;
  gesture = { d0, midU, midV };
}

function updateGesture() {
  if (!gesture) return;
  const [a, b] = twoPoints();
  if (!a || !b) return;
  const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const { L0, T0 } = layoutOrigin();

  s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * (d / gesture.d0)));
  gesture.d0 = d; // 相対更新（安定）

  // 支点(midU,midV)を現在の中点へ合わせる
  tx = mx - L0 - s * gesture.midU;
  ty = my - T0 - s * gesture.midV;
  clampTranslate();
  applyTransform(false);
}
