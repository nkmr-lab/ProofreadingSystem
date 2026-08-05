import { redrawVisibleNow } from './drawingHandler.js';
import { updateButtons } from './UIHandler.js';
import { logPage, isRecordingTimeline } from './timelineHandler.js';
import { resetView } from './viewportHandler.js';
import { appState } from './appState.js';

const base_url = "https://pr.nkmr.io";

// 部分拡大時のボケ対策：背景ラスタを表示サイズより高解像度で描く係数。
// 上げるほど鮮明だが重い（メモリ・描画時間）。MAX_CANVAS_PX で上限クランプ。
const ZOOM_SUPERSAMPLE = 3;   // devicePixelRatio に掛ける供給解像度係数
const MAX_SUPERSAMPLE  = 6;   // 供給解像度の上限倍率
const MAX_CANVAS_PX    = 3800; // キャンバス長辺の上限(px)
const pdf_js_url = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.9.359/pdf.worker.min.js';
const pdf_js_dist_url = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@2.9.359/cmaps/';
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = pdf_js_url;

export let pdfDoc = null;
export let paths = {};
export let pdfScale = 1;
let uploaded_files = null;

const pdfSVG = document.getElementById('pdfSVG');

// ---- exported helpers ----
export function getUploadedPDFFile(){ return uploaded_files; }
export function setUploadedPDFFile(file){ uploaded_files = file; }

// 1ページ目のテキストを抽出（タイトル推定用）。失敗しても空文字で返す。
export async function getFirstPageText(maxChars = 2000){
  if (!pdfDoc) return '';
  try {
    const page = await pdfDoc.getPage(1);
    const tc = await page.getTextContent();
    const s = tc.items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
    return s.slice(0, maxChars);
  } catch (e) {
    console.warn('getFirstPageText failed', e);
    return '';
  }
}

// ---- double-buffer layer state ----
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

let bgA = null;
let bgB = null;
let frontBg = null;
let backBg = null;
let frontUrl = null;
let backUrl = null;

function ensureSvgLayers(){
  if (!pdfSVG) return;
  if (pdfSVG.__layersReady) return;

  pdfSVG.__layersReady = true;
  while (pdfSVG.firstChild) pdfSVG.removeChild(pdfSVG.firstChild);

  bgA = document.createElementNS(SVG_NS, 'image');
  bgB = document.createElementNS(SVG_NS, 'image');

  for (const img of [bgA, bgB]) {
    img.setAttribute('x', '0');
    img.setAttribute('y', '0');
    img.setAttribute('width', '100%');
    img.setAttribute('height', '100%');

    // fade
    img.style.transition = 'opacity 120ms linear';

    // Safari compatibility: set both href and xlink:href when assigning later
    img.setAttribute('opacity', '0');
  }

  bgA.setAttribute('opacity', '1');
  bgB.setAttribute('opacity', '0');

  // ink layer (paths) stays on top of backgrounds
  const inkLayer = document.createElementNS(SVG_NS, 'g');
  inkLayer.setAttribute('id', 'inkLayer');

  pdfSVG.appendChild(bgA);
  pdfSVG.appendChild(bgB);
  pdfSVG.appendChild(inkLayer);

  frontBg = bgA;
  backBg = bgB;
}

function setSvgHref(img, url){
  img.setAttribute('href', url);
  img.setAttributeNS(XLINK_NS, 'href', url);
}

function clearSvgHref(img){
  img.removeAttribute('href');
  img.removeAttributeNS(XLINK_NS, 'href');
}

function preloadImageUrl(url){
  return new Promise((resolve, reject)=>{
    const i = new Image();
    i.onload = () => resolve(true);
    i.onerror = (e) => reject(e);
    i.src = url;
  });
}

async function swapInBackgroundUrl(url){
  // Wait until the browser can decode the image, so we never show blank.
  await preloadImageUrl(url);

  // Put new image to back and fade in
  setSvgHref(backBg, url);
  backBg.setAttribute('opacity', '1');
  frontBg.setAttribute('opacity', '0');

  // swap pointers
  const tmpImg = frontBg; frontBg = backBg; backBg = tmpImg;
  const tmpUrl = frontUrl; frontUrl = url; backUrl = tmpUrl;

  // prepare next back
  backBg.setAttribute('opacity', '0');
  clearSvgHref(backBg);

  // revoke old URL later (give Safari some time)
  if (backUrl) setTimeout(()=>{ try{ URL.revokeObjectURL(backUrl); }catch{} }, 1500);
  backUrl = null;
}

// ---- existing functions ----
export function handleFileSelect(event) {
  loadPdfFile(event.target.files?.[0]);
}

// File/Blob から直接PDFを読み込む（ローカル選択と LabPay からの ?src 転送で共用）。
export function loadPdfFile(file) {
  if (!file) return;
  if (file.type && file.type !== 'application/pdf') {
    alert('PDFファイルを選んでください。');
    return;
  }
  uploaded_files = file;

  const fileReader = new FileReader();
  fileReader.onload = function() {
    const typedarray = new Uint8Array(this.result);
    pdfjsLib.getDocument({
      data: typedarray,
      cMapUrl: pdf_js_dist_url,
      cMapPacked: true,
    }).promise.then(pdf => {
      pdfDoc = pdf;
      paths = {}; // pathsをクリア
      renderPage(1);
      const b = document.getElementById('file-select-button');
      if (b) b.style.display = 'none';
      updateButtons();
    }).catch(error => {
      console.error("Error loading PDF: ", error);
    });
  };
  fileReader.readAsArrayBuffer(file);

  const pdfContainer = document.getElementById('pdf-container');
  if (pdfContainer) pdfContainer.style.border = '1px solid #000';
}

export function loadPDF(_url) {
  const loadingTask = pdfjsLib.getDocument({
    url: _url,
    cMapUrl: pdf_js_dist_url,
    cMapPacked: true
  });
  loadingTask.promise.then(pdf => {
    pdfDoc = pdf;
    renderPage(1);
  }).catch(error => {
    console.error('Error loading PDF:', error);
  });
}

export function ensureUUIDLocal(_uuid) {
  if (_uuid) return _uuid;

  const uuid = crypto.randomUUID();

  const newUrl = `${location.origin}${location.pathname}?uuid=${uuid}`;
  history.replaceState({}, '', newUrl);

  return uuid;
}

export async function ensureUUID(_uuid) {
  if (_uuid) return _uuid;

  if(!uploaded_files){
    throw new Error('Please upload a PDF file first.');
  }

  const formData = new FormData();
  formData.append('file', uploaded_files);

  const response = await fetch('api.php', { method: 'POST', body: formData });
  const text = await response.text();

  let jsonData;
  try {
    jsonData = JSON.parse(text);
  } catch (e) {
    console.error('PDF upload response (raw):', text);
    throw new Error('Failed to upload PDF: Response is not valid JSON.');
  }

  if (!jsonData.uuid) {
    throw new Error(jsonData.message || 'Failed to upload PDF');
  }

  const url = `${base_url}/${jsonData.uuid}`;
  try {
    history.pushState("", "", url);
  } catch (e) {
    console.warn('pushState failed', e);
  }

  return jsonData.uuid;
}

function validatePaths(){
  if(paths == null) return;

  for (let pageNum in paths) {
    for(let pathNum=0; pathNum<paths[pageNum].length; pathNum++){
      for(let i=1; i<paths[pageNum][pathNum].points.length; i++){
        if(paths[pageNum][pathNum].points[i].x == null || paths[pageNum][pathNum].points[i].y == null){
          paths[pageNum][pathNum].points[i].x = paths[pageNum][pathNum].points[i-1].x;
          paths[pageNum][pathNum].points[i].y = paths[pageNum][pathNum].points[i-1].y;
        }
      }
    }
  }
}

export function loadAnnotations(annotations) {
  const parsed = JSON.parse(annotations);

  if (parsed && parsed.paths) {
    paths = parsed.paths;
  } else {
    paths = parsed;
  }
  validatePaths();
}

export function renderPageAsync(_num) {
  appState.currentPageNum = _num;

  if (!pdfDoc) {
    console.warn("renderPageAsync called but pdfDoc is null");
    return Promise.resolve(false);
  }

  if (appState.isRendering) return Promise.resolve(false);
  appState.isRendering = true;

  ensureSvgLayers();

  return pdfDoc.getPage(_num).then((page) => {
    const baseViewport = page.getViewport({ scale: 1 });
    const headerHeight = 50;

    const fitScale = Math.min(
      (window.innerWidth - 20) / baseViewport.width,
      (window.innerHeight - headerHeight - 20) / baseViewport.height
    );

    pdfScale = fitScale;

    // 表示サイズ（fit）は固定。背景ラスタだけ高解像度で描き、CSS拡大時のボケを抑える。
    const displayW = baseViewport.width * pdfScale;
    const displayH = baseViewport.height * pdfScale;

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    let ss = Math.min(MAX_SUPERSAMPLE, Math.max(2, dpr * ZOOM_SUPERSAMPLE));
    let renderScale = pdfScale * ss;
    let viewport = page.getViewport({ scale: renderScale });
    const longSide = Math.max(viewport.width, viewport.height);
    if (longSide > MAX_CANVAS_PX) {
      renderScale *= MAX_CANVAS_PX / longSide;   // メモリ保護で上限クランプ
      viewport = page.getViewport({ scale: renderScale });
    }

    // Update svg size（表示は fit のまま）, but DO NOT clear children
    pdfSVG.setAttribute('width', displayW);
    pdfSVG.setAttribute('height', displayH);

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext('2d');

    return page.render({ canvasContext: context, viewport }).promise.then(async () => {
      // Prefer toBlob to avoid huge base64 strings (and faster on mobile)
      const blob = await new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/png');
      });

      if (!blob) throw new Error('canvas.toBlob failed');

      const url = URL.createObjectURL(blob);

      // Swap-in without flicker
      await swapInBackgroundUrl(url);

      appState.isRendering = false;
      if (appState.isCheckerMode) redrawVisibleNow();
      updateButtons();
      return true;
    }).catch((err) => {
      console.error("Error rendering page: ", err);
      appState.isRendering = false;
      return false;
    });
  }).catch((err) => {
    console.error("Error loading page: ", err);
    appState.isRendering = false;
    return false;
  });
}

// 互換
export function renderPage(_num) {
  renderPageAsync(_num);
}

export function changePage(_offset) {
  if (appState.isRendering) return;
  if (_offset < 0 && appState.currentPageNum == 1) return;
  if (_offset > 0 && appState.currentPageNum == pdfDoc.numPages) return;

  appState.currentPageNum += _offset;
  if (appState.currentPageNum < 1) appState.currentPageNum = 1;
  if (appState.currentPageNum > pdfDoc.numPages) appState.currentPageNum = pdfDoc.numPages;

  if (isRecordingTimeline()) logPage(appState.currentPageNum);
  renderPage(appState.currentPageNum);
  resetView(true);   // ページを送ったら拡大を全体へ戻す（記録側は初期viewを記録）
}