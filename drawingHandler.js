import { currentPageNum, pdfScale, paths } from './pdfHandler.js';
import { saveAnnotation } from './storageHandler.js';
import { calculateMedianPressure } from './subModule.js';
import { updateSlider, updateButtons } from './UIHandler.js';
import { generateSVGPath, addPathAnimation, createTextBox, createTextElement } from './htmlHandler.js';

export let drawing = false;
export let editing = false;

let currentPath = [];
let currentPathElement = null;
let uuid = '';
let pressureMin = 0, pressureMax = 1;

export const DRAWING = 0;
export const TYPING  = 1;
export const ERASING = 2;
export const READING = 3;
export const NUMBER_OF_DRAWING_MODE = 4;
let drawingMode = DRAWING;

export let isPlaying = false;
let interval = null;

const pdfSVG = document.getElementById('pdf-svg');
const playSlider = document.getElementById('playSlider');

export function getDrawingMode(){ return drawingMode; }
export function setDrawingMode(_mode){ drawingMode = _mode; }
export function isEditing(){ return editing; }
export function setEditing(_editing){ editing = _editing; }

export function startAnimation(){
    isPlaying = true;

    // もしmaxなら0ページ目に設定する
    if(parseInt(playSlider.value) === parseInt(playSlider.max)) playSlider.value = 0;
    redrawPaths(parseInt(playSlider.value));

    interval = setInterval(() => {
        if (parseInt(playSlider.value) <= parseInt(playSlider.max)){
            //redrawPaths(parseInt(playSlider.value));
            appendDrawingPaths(Math.max(parseInt(playSlider.value)-1, 0), parseInt(playSlider.value), pdfScale);
        }
        if (parseInt(playSlider.value) >= parseInt(playSlider.max)) {
            stopAnimation();
        }
        playSlider.value ++;
    }, 100);
    playPauseBtn.textContent = '⏸️';
}

export function stopAnimation(){
    clearInterval(interval);
    playPauseBtn.textContent = '⏩️';
    isPlaying = false;
}

export function startDrawing(event) {
    console.log("start drawing");
    event.preventDefault();
    stopAnimation();
    playSlider.value = playSlider.max;

    drawing = true;
    currentPath = [];
    currentPathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    if(drawingMode === ERASING){
        currentPathElement.setAttribute('stroke', 'rgba(0, 0, 255, 1)');
    } else {
        currentPathElement.setAttribute('stroke', 'rgba(255, 0, 0, 1)');
    }
    currentPathElement.setAttribute('stroke-width', '1');
    currentPathElement.setAttribute('fill', 'none');
    pdfSVG.appendChild(currentPathElement);

    // 最初のポイントを追加
    doDrawing(event);
}

export function stopDrawing(event) {
    console.log("stop drawing");
    event.preventDefault();
    drawing = false;
    if (!paths[currentPageNum]) {
        paths[currentPageNum] = [];
    }

    const endX = event.offsetX;
    const endY = event.offsetY;
    currentPath.push({ x: endX / pdfScale, y: endY / pdfScale, pressure: 0.5, ts: Date.now() });

    if (drawingMode == ERASING) {
        erasePath();
        redrawPaths(paths[currentPageNum].length);
        saveAnnotation(uuid, paths);
    } else {
        if(currentPath.length > 1){
            paths[currentPageNum].push({ type: 'path', points: currentPath });
            currentPath = [];
            redrawPaths(paths[currentPageNum].length);

            if (drawingMode == TYPING){
                setEditing(true);
                const textBox = createTextBox(endX / pdfScale, endY / pdfScale, pdfScale, (text) => {
                    paths[currentPageNum].push({ type: 'text', x: endX / pdfScale, y: endY / pdfScale, text: text, ts: Date.now() });
                    redrawPaths(paths[currentPageNum].length);
                    saveAnnotation(uuid, paths);
                    setEditing(false);
                });
                pdfSVG.appendChild(textBox);
                textBox.querySelector('textarea').focus();
                //textBox.querySelector('input').focus();
            }

            saveAnnotation(uuid, paths);
        }
    }

    updateSlider(paths[currentPageNum].length, paths[currentPageNum].length);
    updateButtons(); // ボタンの有効/無効を設定
}

export function doDrawing(event) {
    if (!drawing) return;
    event.preventDefault();
    console.log("doDrawing: " + drawingMode);

    let rect = pdfSVG.getBoundingClientRect();
    let x, y, pressure;
    if (event.changedTouches) {
        x = (event.changedTouches[0].clientX - rect.left) / pdfScale;
        y = (event.changedTouches[0].clientY - rect.top) / pdfScale;
        pressure = event.changedTouches[0].force || 0.5; // Use event.force if available, otherwise default to 0.5
    } else {
        x = (event.clientX - rect.left) / pdfScale;
        y = (event.clientY - rect.top) / pdfScale;
        pressure = event.pressure || 0.5; // Use event.pressure if available, otherwise default to 0.5
    }
    currentPath.push({ x: x, y: y, pressure: pressure, ts: Date.now() });

    let mid_pressure = calculateMedianPressure(currentPath);
    let alpha = getAlphaFromPressure(mid_pressure); // Ensure alpha is between 0.5 and 1
    let strokeStyle = `rgba(255, 0, 0, ${alpha})`;
    let lineWidth = getWidthFromPressure(mid_pressure, pdfScale);
    if(drawingMode === ERASING){
        strokeStyle = `rgba(100, 100, 200, ${alpha})`;
        lineWidth = 10 / pdfScale;
    }
    currentPathElement.setAttribute('d', generateSVGPath(currentPath, pdfScale));
    currentPathElement.setAttribute('stroke', strokeStyle);
    currentPathElement.setAttribute('stroke-width', lineWidth);
}

export function undoLast() {
    if (paths[currentPageNum] && paths[currentPageNum].length > 0) {
        paths[currentPageNum].pop();
        pdfSVG.removeChild(pdfSVG.lastChild);
        saveAnnotation(uuid, paths);
        updateButtons();
    }
}

function erasePath() {
    if (currentPath.length > 0) {
        let x = currentPath[0].x;
        let y = currentPath[0].y;
        let eraseWidth = 10 / pdfScale;
        paths[currentPageNum] = paths[currentPageNum].filter(path => {
            if(path.type != null && path.type === 'path'){
                return !path.points.some(point => {
                    return Math.abs(point.x - x) < eraseWidth && Math.abs(point.y - y) < eraseWidth;
                });
            } else if(path.type === 'text'){
                return !(Math.abs(path.x - x) < eraseWidth && Math.abs(path.y - y) < eraseWidth);
            }
            return !path.some(point => {
                return Math.abs(point.x - x) < eraseWidth && Math.abs(point.y - y) < eraseWidth;
            });
        });

        playSlider.max = paths[currentPageNum].length;
        saveAnnotation(uuid, paths);
    }
}

export function redrawPaths(upToStrokeIndex) {
    // 保存されているPDF画像を保持
    let existingImages = Array.from(pdfSVG.querySelectorAll('image'));
    while (pdfSVG.firstChild) {
        pdfSVG.removeChild(pdfSVG.firstChild);
    }
    // PDF画像を再度追加
    existingImages.forEach(img => pdfSVG.appendChild(img));

    // 0ストローク目から、upToStrokeIndex目まで追加
    appendDrawingPaths(0, upToStrokeIndex, pdfScale);
}

function appendDrawingPaths(fromStrokeIndex, toStrokeIndex, _scale) {
    // 保存されているPDF画像を保持
    if (paths[currentPageNum]) {
        let path_sliced = paths[currentPageNum].slice(fromStrokeIndex, toStrokeIndex);
        path_sliced.forEach(path => {
            if(path.type == null){
                const pathElement = createPathElement(path, _scale);
                if(pathElement != null) pdfSVG.appendChild(pathElement);
            } else if(path.type === 'path'){
                const pathElement = createPathElement(path.points, _scale);
                if(pathElement != null) pdfSVG.appendChild(pathElement);
            } else if(path.type === 'text'){
                const textElement = createTextElement(path.x, path.y, _scale, path.text);
                if(textElement != null ) pdfSVG.appendChild(textElement);
            }
        });
    }
}

export function setPressureMinMax(_pmin, _pmax){
    pressureMin = _pmin;
    pressureMax = _pmax;
}

// _pointsは {x, y, pressure, ts} の配列
function createPathElement(_points, _scale){
    let pressure = calculateMedianPressure(_points);
    if(pressure < pressureMin || pressure > pressureMax){ return null; }
    let pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');

    let alpha = getAlphaFromPressure(pressure);
    let strokeStyle = `rgba(255, 0, 0, ${alpha})`;
    let lineWidth = getWidthFromPressure(pressure, _scale);
    if(pressure > 0.8){
        addPathAnimation(pathElement, lineWidth);
    }
    pathElement.setAttribute('d', generateSVGPath(_points, _scale));
    pathElement.setAttribute('stroke', strokeStyle);
    pathElement.setAttribute('stroke-width', lineWidth);
    pathElement.setAttribute('fill', 'none');
    return pathElement;
}

export function setUUID(_newUUID) {
    console.log("set uuid: " + _newUUID);
    uuid = _newUUID;
}

export function getUUID() {
    return uuid;
}

export function getWidthFromPressure(_pressure, _scaleFactor)
{
    if(_scaleFactor < 0.5) return 1;
    return (1 + _pressure) * _scaleFactor;// * scaleFactor;
}

export function getAlphaFromPressure(_pressure)
{
    return 0.8 + (_pressure * 0.2); // Ensure alpha is between 0.5 and 1
}

export function getPaths() {
    return paths;
}
