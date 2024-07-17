import { changePage, loadPDF, loadAnnotations, sharePDF } from './pdfHandler.js';
import { startDrawing, stopDrawing, doDrawing, redrawPaths, undoLast, setUUID, setDrawingMode, READING, isEditing } from './drawingHandler.js';
import { showThumbnails } from './thumbnailHandler.js';
import { updateButtons, handlePlayPause, toggleDrawingMode, changeInteractionMode, initPressureRangeSlider, initDragAndDropUI } from './UIHandler.js';
import { extractUUID } from './subModule.js';

document.getElementById('playPauseBtn').addEventListener('click', handlePlayPause);
document.getElementById('playSlider').addEventListener('input',()=>redrawPaths(parseInt(playSlider.value, 10)));
//document.getElementById('save-json').addEventListener('click', saveJSON);
//document.getElementById('load-json').addEventListener('click', loadJSON);
document.getElementById('next-page').addEventListener('click', () => changePage(1));
document.getElementById('prev-page').addEventListener('click', () => changePage(-1));
document.addEventListener('keydown', function(event) {
    if(isEditing() === false){
        switch(event.key) {
        case 'ArrowRight':
            changePage(1);
            break;
        case 'ArrowLeft':
            changePage(-1);
            break;
        }
    }
});
document.getElementById('undo').addEventListener('click', undoLast);
document.getElementById('drawing-mode').addEventListener('click', toggleDrawingMode);
document.getElementById('show-thumbnails').addEventListener('click', () => showThumbnails(false));
document.getElementById('filter-pages').addEventListener('click', () => showThumbnails(true));
document.getElementById('share').addEventListener('click', sharePDF);
document.getElementById('autoplay').addEventListener('click', handlePlayPause);

const pdfSVG = document.getElementById('pdf-svg');
pdfSVG.addEventListener('mousedown', startDrawing);
pdfSVG.addEventListener('mouseup', stopDrawing);
pdfSVG.addEventListener('mousemove', doDrawing);
pdfSVG.addEventListener('touchstart', startDrawing, { passive: false });
pdfSVG.addEventListener('touchend', stopDrawing, { passive: false });
pdfSVG.addEventListener('touchmove', doDrawing, { passive: false });

const playSlider = document.getElementById('playSlider');

const urlParams = new URLSearchParams(window.location.search);
let uuid = urlParams.get('uuid');
if(!uuid){
    uuid = extractUUID(window.location.href);
}
const defaultPressureMin = urlParams.get('min') != null ? urlParams.get('min') : 0;
const defaultPressureMax = urlParams.get('max') != null ? urlParams.get('max') : 1;

initPressureRangeSlider(defaultPressureMin, defaultPressureMax);

if (uuid) {
    setUUID(uuid);
    console.log("loading...");

    setDrawingMode(READING);
    document.getElementById('drawing-mode').innerText = "描く 書く 消す [閲覧]";
    document.getElementById('drawing-mode').style.background = "#ffffcc";
    changeInteractionMode(READING);

    fetch(`api.php?uuid=${uuid}`)
        .then(response => response.json())
        .then(data => {
            console.log(data);
            if (data.status === 'error') {
                alert('Failed to load PDF: ' + data.message);
            } else {
                loadPDF(data.pdf);
                loadAnnotations(data.annotations);
                updateButtons();
            }
        })
        .catch(error => {
            console.error('Error:', error);
        });
} else {
    // ドラッグアンドドロップ機能
    initDragAndDropUI();
}
