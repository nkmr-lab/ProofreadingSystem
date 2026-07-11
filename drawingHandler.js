import { pdfScale, paths } from './pdfHandler.js';
import { calculateMedianPressure } from './subModule.js';
import { updateButtons } from './UIHandler.js';
import { generateSVGPath, addPathAnimation } from './htmlHandler.js';
import { logAddStroke, logEraseStrokes } from './timelineHandler.js';
import { getViewScale } from './viewportHandler.js';
import { appState } from './appState.js';

let currentPath = [];
let currentPathElement = null;
let activePointerId = null;
let lastValidPoint = null;

// 描画中の高速化：path の d を増分構築し、筆圧は走査平均で持つ
// （毎 pointermove で全体を移動平均＋中央値ソートしていた O(n²) を解消）。
let liveD = '';
let livePSum = 0;
let livePCount = 0;

// 確定ストロークの描画結果キャッシュ： `id|len|scale` -> { d, median }
// （再生や再描画のたびに全ストロークを平滑化し直すのを防ぐ）。
const renderCache = new Map();
const RENDER_CACHE_MAX = 4000;

export const DrawingMode = (() => {
  const DRAWING = Symbol('DRAWING');
  const ERASING = Symbol('ERASING');
  return Object.freeze({
    DRAWING,
    ERASING,
    next: (m) => (m === DRAWING ? ERASING : DRAWING),
  });
})();

const pdfSVG = document.getElementById('pdfSVG');

const localHiddenIdsByPage = new Map(); // page -> Set(ids)
function getHiddenSet(page) {
  if (!localHiddenIdsByPage.has(page)) localHiddenIdsByPage.set(page, new Set());
  return localHiddenIdsByPage.get(page);
}

export function getPaths() { return paths; }

function newStrokeId() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 's-' + Math.random().toString(16).slice(2) + '-' + Date.now().toString(16);
}

// ===== 互換：古いpathsを正規化（idなし/配列ストロークを吸収） =====
function normalizePageStrokes(pageNum) {
  const arr = paths?.[pageNum];
  if (!Array.isArray(arr)) return;

  for (let i = 0; i < arr.length; i++) {
    const s = arr[i];

    // 旧形式: points配列そのものが入っている（typeなし）
    if (Array.isArray(s)) {
      arr[i] = { type: 'path', id: newStrokeId(), points: s };
      continue;
    }

    // 旧形式: {type:'path', points:...} だが id が無い
    if (s && typeof s === 'object') {
      if (s.type === 'path' && Array.isArray(s.points) && !s.id) {
        s.id = newStrokeId();
      }
      // さらに昔: {points:...} だけ
      if (!s.type && Array.isArray(s.points)) {
        s.type = 'path';
        if (!s.id) s.id = newStrokeId();
      }
    }
  }
}

// ===== Drawing =====
export function startDrawing(event) {
  event.preventDefault();

  // ストロークはこの pointerId だけ
  if (typeof event.pointerId !== 'undefined') activePointerId = event.pointerId;
  else activePointerId = 'mouse';
  lastValidPoint = null;

  appState.isDrawing = true;
  currentPath = [];
  liveD = '';
  livePSum = 0;
  livePCount = 0;
  currentPathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');

  currentPathElement.setAttribute('stroke', appState.drawingMode === DrawingMode.ERASING ? 'rgba(0, 0, 255, 1)' : 'rgba(255, 0, 0, 1)');
  currentPathElement.setAttribute('stroke-width', '1');
  currentPathElement.setAttribute('fill', 'none');

  pdfSVG.appendChild(currentPathElement);
  doDrawing(event);
}

export function stopDrawing(event) {
  event.preventDefault();
  appState.isDrawing = false;

  if (!paths[appState.currentPageNum]) paths[appState.currentPageNum] = [];
  normalizePageStrokes(appState.currentPageNum);

  // mouse の場合だけ最後点を追加
  if (typeof event.offsetX !== 'undefined') {
    currentPath.push({
      x: event.offsetX / pdfScale,
      y: event.offsetY / pdfScale,
      pressure: 0.5,
      ts: Date.now()
    });
  }

  if (appState.drawingMode === DrawingMode.ERASING) {
    const erasedIds = eraseHitStrokes(); // ←消し軌跡全体で判定
    if (erasedIds.length > 0) logEraseStrokes(appState.currentPageNum, erasedIds);

    redrawVisibleNow();          // 先生画面に即反映
    //saveAnnotation(appState.uuid, paths); // paths自体は消さない（履歴保持）
  } else {
    if (currentPath.length > 1) {
      const strokeId = newStrokeId();
      paths[appState.currentPageNum].push({ type: 'path', id: strokeId, points: currentPath });
      currentPath = [];

      logAddStroke(appState.currentPageNum, strokeId);
      redrawVisibleNow();
      //saveAnnotation(appState.uuid, paths);
    }
  }

  appState.isDrawing = false;
  activePointerId = null;
  lastValidPoint = null;

  updateButtons();
}

// 進行中のストロークをコミットせず破棄（2本指ピンチ開始時などに使用）
export function cancelDrawing() {
  appState.isDrawing = false;
  if (currentPathElement && currentPathElement.parentNode) {
    currentPathElement.parentNode.removeChild(currentPathElement);
  }
  currentPathElement = null;
  currentPath = [];
  activePointerId = null;
  lastValidPoint = null;
}

export function doDrawing(event) {
  if (!appState.isDrawing) return;
  event.preventDefault();

  if (typeof event.pointerId !== 'undefined' && activePointerId !== null) {
    if (event.pointerId !== activePointerId) return; // 混入遮断
  }

  const rect = pdfSVG.getBoundingClientRect();
  // 部分拡大中は getBoundingClientRect が拡大後の位置/幅を返すので、
  // ズーム倍率(getViewScale)でも割ってページ座標へ戻す。
  const denom = pdfScale * getViewScale();
  let x, y, pressure;

  if (event.changedTouches) {
    x = (event.changedTouches[0].clientX - rect.left) / denom;
    y = (event.changedTouches[0].clientY - rect.top) / denom;
    pressure = event.changedTouches[0].force || 0.5;
  } else {
    x = (event.clientX - rect.left) / denom;
    y = (event.clientY - rect.top) / denom;
    pressure = event.pressure || 0.5;
  }

  // 変なイベント除外
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;

  // iOSゴースト対策：最初の点が(0,0)なら捨てる
  if (currentPath.length === 0 && x === 0 && y === 0) return;

  // キャンバス外なら強制終了（drawingが残るのを防ぐ）
  const w = pdfSVG.clientWidth / pdfScale;
  const h = pdfSVG.clientHeight / pdfScale;
  if (x < 0 || y < 0 || x > w || y > h) {
    stopDrawing(event);
    return;
  }

  // 異常ジャンプ点を捨てる（直線の原因点）
  if (lastValidPoint) {
    const dx = x - lastValidPoint.x;
    const dy = y - lastValidPoint.y;
    const dist2 = dx*dx + dy*dy;

    // 画面上で 80px 相当以上のジャンプは異常として捨てる
    const maxJump = 80 / pdfScale;
    if (dist2 > maxJump * maxJump) {
      return; // この点は入れない
    }
  }

  currentPath.push({ x, y, pressure, ts: Date.now() });
  lastValidPoint = { x, y };

  // 走査平均で筆圧を更新（毎moveの中央値ソートを回避）
  livePSum += pressure;
  livePCount++;
  const meanP = livePSum / livePCount;
  const alpha = getAlphaFromPressure(meanP);

  // d は増分で追記（毎moveの全体再生成を回避）。確定時に平滑化して描き直す。
  liveD += (liveD === '' ? 'M ' : ' L ') + (x * pdfScale) + ' ' + (y * pdfScale);

  let strokeStyle = `rgba(255, 0, 0, ${alpha})`;
  let lineWidth = getWidthFromPressure(meanP, pdfScale);
  if (appState.drawingMode === DrawingMode.ERASING) {
    strokeStyle = `rgba(100, 100, 200, ${alpha})`;
    lineWidth = 10 / pdfScale;
  }

  currentPathElement.setAttribute('d', liveD);
  currentPathElement.setAttribute('stroke', strokeStyle);
  currentPathElement.setAttribute('stroke-width', lineWidth);
}

// ===== Undo =====
// 「非表示」扱いにする
export function undoLast() {
  normalizePageStrokes(appState.currentPageNum);
  const pageStrokes = paths[appState.currentPageNum];
  if (!pageStrokes || pageStrokes.length === 0) return;

  const hidden = getHiddenSet(appState.currentPageNum);

  for (let i = pageStrokes.length - 1; i >= 0; i--) {
    const s = pageStrokes[i];
    if (!s) continue;
    if (!s.id) s.id = newStrokeId(); // 念のため
    if (hidden.has(s.id)) continue;

    hidden.add(s.id);
    logEraseStrokes(appState.currentPageNum, [s.id]);

    redrawVisibleNow();
    //saveAnnotation(appState.uuid, paths);
    updateButtons();
    return;
  }
}

// ===== Erase (event-based) =====
// “消し始め1点”ではなく “消し軌跡の複数点” でヒット判定する
function eraseHitStrokes() {
  const erased = [];
  if (currentPath.length === 0) return erased;

  normalizePageStrokes(appState.currentPageNum);

  const pageStrokes = paths[appState.currentPageNum] || [];
  const hidden = getHiddenSet(appState.currentPageNum);

  // 画面上で 12px くらいの消し半径 → pdf座標へ
  const rPdf = 12 / Math.max(0.001, pdfScale);
  const r2 = rPdf * rPdf;

  // 消し軌跡点（間引き：全部使うと重いので1/2間引き）
  const eraserPts = [];
  for (let i = 0; i < currentPath.length; i += 2) {
    const p = currentPath[i];
    if (p) eraserPts.push(p);
  }
  // 念のため末尾も
  eraserPts.push(currentPath[currentPath.length - 1]);

  const hit = (stroke) => {
    const pts = stroke?.points;
    if (!Array.isArray(pts) || pts.length === 0) return false;

    // まず粗く間引いて当たり判定（高速化）
    for (let i = 0; i < pts.length; i += 2) {
      const sp = pts[i];
      for (const ep of eraserPts) {
        const dx = sp.x - ep.x;
        const dy = sp.y - ep.y;
        if (dx*dx + dy*dy <= r2) return true;
      }
    }
    return false;
  };

  for (const s of pageStrokes) {
    if (!s) continue;
    if (!s.id) s.id = newStrokeId(); // 念のため
    if (hidden.has(s.id)) continue;

    if (hit(s)) {
      hidden.add(s.id);
      erased.push(s.id);
    }
  }

  return erased;
}

export function redrawVisibleNow() {
  normalizePageStrokes(appState.currentPageNum);

  const pageStrokes = paths[appState.currentPageNum] || [];
  const hidden = getHiddenSet(appState.currentPageNum);

  // id無しはここで付与済みのはず
  const visible = pageStrokes.filter(s => s && s.id && !hidden.has(s.id));
  redrawFromStrokes(visible, pdfScale);
}

export function redrawFromStrokes(strokes, _scale) {
  // image以外（手書きpath）だけ削除
  const nodes = Array.from(pdfSVG.childNodes);
  for (const n of nodes) {
    if (n.nodeName.toLowerCase() !== 'image') pdfSVG.removeChild(n);
  }

  strokes.forEach((stroke) => {
    const pts = stroke?.points;
    if (!Array.isArray(pts) || pts.length < 2) return;
    const el = createPathElement(stroke, _scale);
    if (el) pdfSVG.appendChild(el);
  });
}

// 確定ストロークの d と中央値筆圧をキャッシュ（id と点数と scale が同じなら再利用）。
// 再生の各フレームで全ストロークを平滑化し直すコストを消す。書き途中の部分ストロークは
// 点数が毎回変わるのでキャッシュヒットせず、そこだけ都度計算になる（1本だけなので軽い）。
function strokeRender(stroke, scale) {
  const pts = stroke.points;
  const key = stroke.id ? `${stroke.id}|${pts.length}|${scale}` : null;
  if (key) {
    const hit = renderCache.get(key);
    if (hit) return hit;
  }
  const val = { d: generateSVGPath(pts, scale), median: calculateMedianPressure(pts) };
  if (key) {
    if (renderCache.size >= RENDER_CACHE_MAX) renderCache.clear();
    renderCache.set(key, val);
  }
  return val;
}

function createPathElement(stroke, _scale) {
  const { d, median } = strokeRender(stroke, _scale);
  const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');

  const alpha = getAlphaFromPressure(median);
  const strokeStyle = `rgba(255, 0, 0, ${alpha})`;
  const lineWidth = getWidthFromPressure(median, _scale);

  if (median > 0.8) addPathAnimation(pathElement, lineWidth);

  pathElement.setAttribute('d', d);
  pathElement.setAttribute('stroke', strokeStyle);
  pathElement.setAttribute('stroke-width', lineWidth);
  pathElement.setAttribute('fill', 'none');
  return pathElement;
}

export function getWidthFromPressure(_pressure, _scaleFactor) {
  if (_scaleFactor < 0.5) return 1;
  return (1 + _pressure) * _scaleFactor;
}

export function getAlphaFromPressure(_pressure) {
  return 0.8 + (_pressure * 0.2);
}
