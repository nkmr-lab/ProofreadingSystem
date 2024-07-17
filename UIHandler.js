import { stopAnimation, startAnimation, isPlaying, } from "./drawingHandler.js";
import { startDrawing, stopDrawing, doDrawing, redrawPaths, setPressureMinMax } from './drawingHandler.js';
import { getDrawingMode, setDrawingMode, DRAWING, ERASING, TYPING, READING, NUMBER_OF_DRAWING_MODE } from "./drawingHandler.js";
import { paths, currentPageNum, pdfDoc, changePage, handleFileSelect } from "./pdfHandler.js";

const pdfSVG = document.getElementById('pdf-svg');
const playSlider = document.getElementById('playSlider');

export function updateSlider(_value, _max) {
    playSlider.max = _max;
    playSlider.value = _value;
}

export function updateButtons() {
    // 次のページ、前のページボタンの有効/無効を設定
    document.getElementById('prev-page').disabled = (currentPageNum <= 1);
    if(pdfDoc){
        document.getElementById('next-page').disabled = (currentPageNum >= pdfDoc.numPages);
    } else {
        document.getElementById('next-page').disabled = true;
    }

    document.getElementById('show-thumbnails').disabled = false;
    document.getElementById('drawing-mode').disabled = false;

    document.getElementById('undo').disabled = !(paths[currentPageNum] != null && paths[currentPageNum].length > 0);

    // 手書きありページ一覧ボタンの有効/無効を設定
    let hasHandwriting = Object.keys(paths).some(key => paths[key].length > 0);
    document.getElementById('filter-pages').disabled = !hasHandwriting;
    document.getElementById('share').disabled = !hasHandwriting;
}

export function toggleDrawingMode() {
    setDrawingMode((getDrawingMode() + 1) % NUMBER_OF_DRAWING_MODE);
    changeInteractionMode(getDrawingMode());
  
    if(getDrawingMode() === DRAWING){
        document.getElementById('drawing-mode').innerText = "[描く] 書く 消す 閲覧";
        document.getElementById('drawing-mode').style.background = "#ffcccc";
    } else if(getDrawingMode() === TYPING){
        document.getElementById('drawing-mode').innerText = "描く [書く] 消す 閲覧";
        document.getElementById('drawing-mode').style.background = "#ff cc";
    } else if(getDrawingMode() === ERASING){
        document.getElementById('drawing-mode').innerText = "描く 書く [消す] 閲覧";
        document.getElementById('drawing-mode').style.background = "#ccccff";
        if(isPlaying){
            stopAnimation();
            playSlider.value = playSlider.max;
            redrawPaths(playSlider.max);
        }
    } else if(getDrawingMode() === READING){
        document.getElementById('drawing-mode').style.background = "#ffffcc";
        document.getElementById('drawing-mode').innerText = "描く 書く 消す [閲覧]";
    }
}

export function changeInteractionMode(_mode){
    if(_mode === READING){
        pdfSVG.removeEventListener('touchstart', startDrawing, { passive: false });
        pdfSVG.removeEventListener('touchend', stopDrawing, { passive: false });
        pdfSVG.removeEventListener('touchmove', doDrawing, { passive: false });
        pdfSVG.addEventListener('touchstart', handleTouchStart, false);
        pdfSVG.addEventListener('touchmove', handleTouchMove, false);
        pdfSVG.addEventListener('touchend', handleTouchEnd, false);
        pdfSVG.addEventListener('pointerdown', handleTouchStart, false);
        pdfSVG.addEventListener('pointermove', handleTouchMove, false);
        pdfSVG.addEventListener('pointerup', handleTouchEnd, false);

        pdfSVG.removeEventListener('mousedown', startDrawing);
        pdfSVG.removeEventListener('mouseup', stopDrawing);
        pdfSVG.removeEventListener('mousemove', doDrawing);
    } else {
        pdfSVG.removeEventListener('touchstart', handleTouchStart, false);
        pdfSVG.removeEventListener('touchmove', handleTouchMove, false);
        pdfSVG.removeEventListener('touchend', handleTouchEnd, false);
        pdfSVG.addEventListener('touchstart', startDrawing, { passive: false });
        pdfSVG.addEventListener('touchend', stopDrawing, { passive: false });
        pdfSVG.addEventListener('touchmove', doDrawing, { passive: false });
        pdfSVG.removeEventListener('pointerdown', handleTouchStart, false);
        pdfSVG.removeEventListener('pointermove', handleTouchMove, false);
        pdfSVG.removeEventListener('pointerup', handleTouchEnd, false);

        pdfSVG.addEventListener('mousedown', startDrawing);
        pdfSVG.addEventListener('mouseup', stopDrawing);
        pdfSVG.addEventListener('mousemove', doDrawing);
    }
}

export function handlePlayPause() {
    if (isPlaying) {
        stopAnimation();
    } else {
        startAnimation();
    }
}

export function getScaleFromSlider(){
    return 1 / parseFloat(document.getElementById('zoomSlider').value);
}

let xDown, yDown, initialDistance, lastTouchEnd;

function handleTouchStart(event) {
    if (event.touches != null && event.touches.length != null){
        if(event.touches.length === 2) {
            initialDistance = getDistance(event.touches[0], event.touches[1]);
        } else if (event.touches.length === 1) {
            const firstTouch = event.touches[0];
            xDown = firstTouch.clientX;
            yDown = firstTouch.clientY;
        }
    } else {
        xDown = event.clientX;
        yDown = event.clientY;
    }
}

const thresholdSwipe = 50;

function handleTouchMove(event) {
    if (event.touches != null && event.touches.length != null){
        if (event.touches.length === 2) {
            const currentDistance = getDistance(event.touches[0], event.touches[1]);
            if (initialDistance) {
                if (currentDistance > initialDistance) {
                    console.log('Pinch Out');
                } else {
                    console.log('Pinch In');
                }
            }
            initialDistance = currentDistance;
        } else if (event.touches.length === 1) {
            if (!xDown || !yDown) {
                return;
            }

            const xUp = event.touches[0].clientX;
            const yUp = event.touches[0].clientY;

            const xDiff = xDown - xUp;
            const yDiff = yDown - yUp;

            if (Math.abs(xDiff) > Math.abs(yDiff)) {
                if (xDiff > thresholdSwipe) {
                    console.log('Swipe Left');
                    changePage(1);
                } else if(xDiff < -thresholdSwipe){
                    console.log('Swipe Right');
                    changePage(-1);
                }
            } else {
                if (yDiff > thresholdSwipe) {
                    console.log('Swipe Up');
                } else if(yDiff < -thresholdSwipe){
                    console.log('Swipe Down');
                }
            }

            xDown = null;
            yDown = null;
        }
    } else {
        if (!xDown || !yDown) {
            return;
        }

        const xUp = event.clientX;
        const yUp = event.clientY;

        const xDiff = xDown - xUp;
        const yDiff = yDown - yUp;

        if (Math.abs(xDiff) > Math.abs(yDiff)) {
            console.log("swipe?" + xDiff);
            console.log("(" + xDown + ", " + yDown + ") -> (" + xUp + ", " + yUp + ")");
            if (xDiff > thresholdSwipe) {
                console.log('Swipe Left');
                changePage(1);
                xDown = null;
                yDown = null;
            } else if(xDiff < -thresholdSwipe){
                console.log('Swipe Right');
                changePage(-1);
                xDown = null;
                yDown = null;
            }
        } else {
            if (yDiff > thresholdSwipe) {
                console.log('Swipe Up');
            } else if(yDiff < -thresholdSwipe){
                console.log('Swipe Down');
            }
            xDown = null;
            yDown = null;
        }   
    }
}

function handleTouchEnd(event) {
    const now = new Date().getTime();
    if (now - lastTouchEnd <= 300) {
        event.preventDefault();
    }
    lastTouchEnd = now;
    initialDistance = null;
    xDown = null;
    yDown = null;
}

function getDistance(touch1, touch2) {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

export function initPressureRangeSlider(_defaultPressureMin, _defaultPressureMax){
    const pressureRangeSlider = document.getElementById('pressure-range-slider');
    noUiSlider.create(pressureRangeSlider, {
        start: [1-_defaultPressureMax, 1-_defaultPressureMin],
        connect: true,
        orientation: 'vertical',
        range: {
            'min': 0,
            'max': 1
        },
        step: 0.01
    });

    pressureRangeSlider.noUiSlider.on('update', (values) => {
        setPressureMinMax(1-parseFloat(values[1]), 1-parseFloat(values[0]));
        redrawPaths(parseInt(playSlider.value));
    });
}

export function initDragAndDropUI(){
    const pdfContainer = document.getElementById('pdf-container');
    pdfContainer.style.border = '2px dashed #000';
    pdfContainer.setAttribute('width', '100%');
    pdfContainer.setAttribute('height', '100%');

    pdfContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        pdfContainer.style.border = '2px dashed #000';
    });

    pdfContainer.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        pdfContainer.style.border = '1px solid #000';
    });

    pdfContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        pdfContainer.style.border = '1px solid #000';

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFileSelect({ target: { files: files } });
        }
    });

    // ファイル選択ボタン機能
    document.getElementById('file-select-button').addEventListener('click', () => {
        document.getElementById('file-input').click();
    });

    document.getElementById('file-input').addEventListener('change', handleFileSelect);

    // requestAnimationFrame(() => {
    //     const body = document.getElementById('bodyContent');
    //     const rect = body.getBoundingClientRect();
    //     console.log(rect);

    //     pdfContainer.setAttribute('width', rect.width);
    //     pdfContainer.setAttribute('height', rect.height);
    // });
}
