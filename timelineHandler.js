// timelineHandler.js
import { pdfDoc, renderPageAsync, pdfScale } from './pdfHandler.js';
import { getPaths, redrawFromStrokes } from './drawingHandler.js';
import { applyNormalizedView } from './viewportHandler.js';
import { appState } from './appState.js';

let t0Perf = null;
let recording = false;
let events = [];   // {t, type, page, ...}
let baseTs = null; // 録音開始の絶対時刻（Date.now）

// 再生中にログが増える事故防止
let suppressLogging = false;

// 無駄打ち抑制＆PDFちらつき防止
let lastApplied = { page: null, visibleHash: null, partialLen: null };

// 同期ループ
let timerId = null;

function nowMsFromStart() {
  if (!t0Perf) return 0;
  return Math.max(0, Math.round(performance.now() - t0Perf));
}

export function startTimeline() {
  baseTs = Date.now();
  t0Perf = performance.now();
  recording = true;

  events = [
    { t: 0, type: 'start', page: appState.currentPageNum, baseTs }
  ];

  lastApplied = { page: null, visibleHash: null, partialLen: null };
}

export function stopTimeline() {
  recording = false;
  t0Perf = null;
}

export function isRecordingTimeline() {
  return recording;
}

export function buildTimelinePayload() {
  return { paths: getPaths(), events };
}

export function loadTimelinePayload(payload) {
  events = Array.isArray(payload?.events) ? payload.events : [];
  const startEv = events.find(e => e && e.type === 'start');
  baseTs = startEv?.baseTs ?? null;

  lastApplied = { page: null, visibleHash: null, partialLen: null };
}

// ===== logging API =====

export function logPage(pageNum) {
  if (!recording || suppressLogging) return;
  events.push({ t: nowMsFromStart(), type: 'page', page: pageNum });
}

// 保険：tsが無い古いデータでも再生できるよう add を残す
export function logAddStroke(pageNum, strokeId) {
  if (!recording || suppressLogging) return;
  events.push({ t: nowMsFromStart(), type: 'add', page: pageNum, id: strokeId });
}

export function logEraseStrokes(pageNum, strokeIds) {
  if (!recording || suppressLogging) return;
  if (!Array.isArray(strokeIds) || strokeIds.length === 0) return;
  events.push({ t: nowMsFromStart(), type: 'erase', page: pageNum, ids: strokeIds });
}

// 部分拡大（表示範囲）の記録。view = {nx,ny,nw,nh}（ページに対する0〜1）
export function logView(pageNum, view) {
  if (!recording || suppressLogging || !view) return;
  events.push({
    t: nowMsFromStart(), type: 'view', page: pageNum,
    v: {
      nx: +view.nx.toFixed(4), ny: +view.ny.toFixed(4),
      nw: +view.nw.toFixed(4), nh: +view.nh.toFixed(4),
    },
  });
}

// timeMs 時点で pageNum に適用すべき表示範囲。無ければ全体。
function computeViewAt(timeMs, pageNum) {
  let v = { nx: 0, ny: 0, nw: 1, nh: 1 };
  if (!events) return v;
  for (const ev of events) {
    if (!ev) continue;
    if (ev.t > timeMs) break;
    if (ev.type === 'view' && ev.page === pageNum && ev.v) v = ev.v;
  }
  return v;
}

function computePageAt(timeMs) {
  if (!events || events.length === 0) return 1;

  let page = events[0].page ?? 1;
  for (const ev of events) {
    if (!ev) continue;
    if (ev.t > timeMs) break;
    if (ev.type === 'page') page = ev.page;
  }
  return page;
}

function computeErasedSetAt(timeMs, pageNum) {
  const erased = new Set();
  if (!events) return erased;

  for (const ev of events) {
    if (!ev) continue;
    if (ev.t > timeMs) break;

    if (ev.type === 'erase' && ev.page === pageNum && Array.isArray(ev.ids)) {
      for (const id of ev.ids) erased.add(id);
    }
  }
  return erased;
}

// ts で「この時刻までに書き終えたストローク」を返す
function lastTsOfStroke(stroke) {
  const pts = stroke?.points;
  if (!Array.isArray(pts) || pts.length === 0) return null;
  const last = pts[pts.length - 1];
  return typeof last?.ts === 'number' ? last.ts : null;
}

function firstTsOfStroke(stroke) {
  const pts = stroke?.points;
  if (!Array.isArray(pts) || pts.length === 0) return null;
  const first = pts[0];
  return typeof first?.ts === 'number' ? first.ts : null;
}

function sliceStrokeByAbsNow(stroke, absNowMs) {
  const pts = stroke?.points;
  if (!Array.isArray(pts) || pts.length === 0) return null;

  // tsが無いなら部分描画できないので全部
  if (pts[0]?.ts == null) return { ...stroke };

  let k = 0;
  while (k < pts.length && pts[k].ts <= absNowMs) k++;

  if (k <= 1) {
    // ほぼ点だけ：ちらつき防止で描かない（または1点だけでも良いがpathにならない）
    return null;
  }
  return { ...stroke, points: pts.slice(0, k) };
}

function buildStrokesForTime(pageNum, timeMs) {
  const all = getPaths()?.[pageNum] ?? [];
  if (!Array.isArray(all) || all.length === 0) {
    return { strokes: [], visibleHash: '', partialLen: 0 };
  }

  const erased = computeErasedSetAt(timeMs, pageNum);

  // 絶対時刻へ変換（無ければ部分描画なし）
  const absNow = (baseTs != null) ? (baseTs + timeMs) : null;

  const strokes = [];
  let partialLen = 0;

  // tsがあるデータ：ts駆動で「書いてる風」を作る
  const hasTs = all.some(s => firstTsOfStroke(s) != null);

  if (hasTs && absNow != null) {
    for (const s of all) {
      if (!s || !s.id) continue;
      if (erased.has(s.id)) continue;

      const firstTs = firstTsOfStroke(s);
      const lastTs = lastTsOfStroke(s);

      if (firstTs == null || lastTs == null) {
        // ts欠落：後段のaddベースで拾いたいが混在は複雑なので、ここでは全部表示扱いにする
        strokes.push(s);
        continue;
      }

      if (absNow >= lastTs) {
        // 完了
        strokes.push(s);
        continue;
      }

      if (absNow >= firstTs && absNow < lastTs) {
        // 書き中：部分描画して以降は描かない（通常は1本だけ）
        const partial = sliceStrokeByAbsNow(s, absNow);
        if (partial) {
          strokes.push(partial);
          partialLen = partial.points.length;
        }
        break;
      }

      break;
    }
  } else {
    // tsが無い古いデータ：addイベントの数で「ここまで」を決める（保険）
    let addedIds = [];
    for (const ev of events) {
      if (!ev) continue;
      if (ev.t > timeMs) break;
      if (ev.type === 'add' && ev.page === pageNum && ev.id) {
        addedIds.push(ev.id);
      }
    }
    const visible = new Set(addedIds);
    for (const s of all) {
      if (!s || !s.id) continue;
      if (!visible.has(s.id)) continue;
      if (erased.has(s.id)) continue;
      strokes.push(s);
    }
  }

  // visibleHash（無駄打ち抑制用）
  // id列＋partialLenで簡易に判定
  const ids = strokes.map(s => s.id).join(',');
  const visibleHash = `${pageNum}:${ids}`;

  return { strokes, visibleHash, partialLen };
}

export async function applyAtTimeMs(timeMs) {
  if (!pdfDoc) return;

  const page = computePageAt(timeMs);
  const { strokes, visibleHash, partialLen } = buildStrokesForTime(page, timeMs);
  const view = computeViewAt(timeMs, page);
  const viewKey = `${page}:${view.nx},${view.ny},${view.nw},${view.nh}`;

  const strokesSame =
    lastApplied.page === page &&
    lastApplied.visibleHash === visibleHash &&
    lastApplied.partialLen === partialLen;
  const viewSame = lastApplied.viewKey === viewKey;

  // 手書きも表示範囲も変化無しなら何もしない
  if (strokesSame && viewSame) return;

  suppressLogging = true;
  try {
    if (!strokesSame) {
      // ページが変わった時だけPDFをレンダ（ちらつき防止）
      if (lastApplied.page !== page) {
        await renderPageAsync(page);
      }
      // PDF image は触らず、strokeだけ更新
      redrawFromStrokes(strokes, pdfScale);
    }
    // 記録された表示範囲が変わった時だけ寄せる（間は見る人が自由にピンチ可）。
    // 記録時にピンチ途中も逐次記録しているので、スナップでも動きは滑らかに再現される。
    if (!viewSame) {
      applyNormalizedView(view, false);
    }
  } finally {
    suppressLogging = false;
    lastApplied = { page, visibleHash, partialLen, viewKey };
  }
}

export function attachAudioSync(audioEl, fps = 15) {
  if (!audioEl) return;
  detachAudioSync(audioEl);

  const intervalMs = Math.max(30, Math.round(1000 / fps));

  const tick = () => {
    if (!audioEl.paused && !audioEl.ended) {
      applyAtTimeMs((audioEl.currentTime || 0) * 1000);
    }
  };

  const onPlay = () => {
    clearInterval(timerId);
    timerId = setInterval(tick, intervalMs);
    tick();
  };

  const onPause = () => {
    clearInterval(timerId);
    timerId = null;
  };

  const onEnded = () => {
    clearInterval(timerId);
    timerId = null;
  };

  const onSeeking = () => {
    applyAtTimeMs((audioEl.currentTime || 0) * 1000);
  };

  audioEl.__timelineHandlers = { onPlay, onPause, onEnded, onSeeking };

  audioEl.addEventListener('play', onPlay);
  audioEl.addEventListener('pause', onPause);
  audioEl.addEventListener('ended', onEnded);
  audioEl.addEventListener('seeking', onSeeking);

  // 初期反映
  applyAtTimeMs((audioEl.currentTime || 0) * 1000);
}

export function detachAudioSync(audioEl) {
  if (!audioEl) return;
  const h = audioEl.__timelineHandlers;
  if (!h) return;

  audioEl.removeEventListener('play', h.onPlay);
  audioEl.removeEventListener('pause', h.onPause);
  audioEl.removeEventListener('ended', h.onEnded);
  audioEl.removeEventListener('seeking', h.onSeeking);

  delete audioEl.__timelineHandlers;

  clearInterval(timerId);
  timerId = null;
}