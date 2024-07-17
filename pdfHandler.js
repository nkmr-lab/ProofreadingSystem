import { redrawPaths, getUUID, setUUID, getPaths, startAnimation, stopAnimation } from './drawingHandler.js';
import { createImageElement } from './htmlHandler.js';
import { updateButtons, updateSlider } from './UIHandler.js';

const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.9.359/pdf.worker.min.js';

const base_url = "https://pr.nkmr.io";

export let pdfDoc = null;
export let currentPageNum = 1;
export let paths = {};
export let pdfScale = 1;
let isRendering = false;
let uploaded_files = null;

const pdfSVG = document.getElementById('pdf-svg');
const zoomSlider = document.getElementById('zoomSlider');

zoomSlider.addEventListener('input', () => {
    pdfScale = 1 / parseFloat(zoomSlider.value);
    renderPage(currentPageNum);
});

export function handleFileSelect(event) {
    uploaded_files = event.target.files[0];
    if (uploaded_files && uploaded_files.type !== 'application/pdf') {
        alert('Please upload a PDF file.');
        return;
    }

    let fileReader = new FileReader();
    fileReader.onload = function() {
        let typedarray = new Uint8Array(this.result);
        pdfjsLib.getDocument({
            data: typedarray,
            cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@2.9.359/cmaps/',
            cMapPacked: true,
            //textLayerMode: 2,
        }).promise.then(pdf => {
            pdfDoc = pdf;
            paths = {}; // pathsをクリア
            renderPage(1);
            // ボタンの有効/無効を設定
            document.getElementById('file-select-button').style = 'display: none';
            updateButtons();
        }).catch(error => {
            console.error("Error loading PDF: ", error);
        });
    };
    fileReader.readAsArrayBuffer(uploaded_files);

    const pdfContainer = document.getElementById('pdf-container');
    pdfContainer.style.border = '1px solid #000';
}

export function loadPDF(url) {
    const loadingTask = pdfjsLib.getDocument({
        url: url,
        cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@2.9.359/cmaps/',
        cMapPacked: true
    });
    loadingTask.promise.then(pdf => {
        pdfDoc = pdf;
        pdfScale = 1 / parseFloat(document.getElementById('zoomSlider').value);
        renderPage(1);
        // ボタンの有効/無効を設定
    }).catch(error => {
        console.error('Error loading PDF:', error);
    });
}

export async function sharePDF() {
    // すでにUUIDがある場合は共有されているので不要
    let uuid = getUUID();
    if(uuid){
        alert('already shared');
    }

    if(!uploaded_files){
        alert('Please upload a PDF file first.');
        return;
    }
    /*
    const pdfFile = document.getElementById('pdf-upload').files[0];
    if (!pdfFile) {
        alert('Please upload a PDF file first.');
        return;
    }
        */

    // UUIDの生成とPDFのアップロード
    const formData = new FormData();
    //formData.append('file', pdfFile);
    formData.append('file', uploaded_files);

    try {
        const response = await fetch('api.php', {
            method: 'POST',
            body: formData
        });

        const data = await response.text();
        console.log('PDF upload response (raw):', data);

        try {
            const jsonData = JSON.parse(data);
            console.log('PDF upload response (parsed):', jsonData);

            if (jsonData.uuid) {
                setUUID(jsonData.uuid);

                // JSONのアップロード
                const annotationData = JSON.stringify(getPaths());
                const jsonResponse = await fetch('api.php', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        uuid: getUUID(),
                        data: annotationData,
                    }),
                });

                const jsonResult = await jsonResponse.json();
                console.log('JSON upload response:', jsonResult);

                if (jsonResult.status === 'success') {
                    const url = `${base_url}/${jsonData.uuid}`;
                    try {
                        await navigator.clipboard.writeText(url);
                        history.pushState("", "", url);
                        alert('Shareable URL copied to clipboard: ' + url);
                    } catch (error) {
                        console.error('Failed to copy URL to clipboard: ', error);
                        alert('Failed to copy URL to clipboard: ' + url);
                    }
                } else {
                    console.error(jsonResult.message);
                    alert('Failed to save JSON: ' + jsonResult.message);
                }
            } else {
                console.error(jsonData.message);
                alert('Failed to upload PDF: ' + jsonData.message);
            }
        } catch (jsonError) {
            console.error('Failed to parse JSON:', jsonError);
            alert('Failed to upload PDF: Response is not valid JSON.');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to share PDF: ' + error.message);
    }
}

function validatePaths(){
    //console.log("validate paths");
    if(paths == null) return;

    //console.log("path length = " + Object.keys(paths).length);
    for (let pageNum in paths) {
        //console.log(paths[pageNum]);
        //console.log(paths[pageNum].length);
        for(let pathNum=0; pathNum<paths[pageNum].length; pathNum++){
            if(paths[pageNum][pathNum] != null && paths[pageNum][pathNum].type === 'path'){
                for(let i=1; i<paths[pageNum][pathNum].points.length; i++){
                    if(paths[pageNum][pathNum].points[i].x == null || paths[pageNum][pathNum].points[i].y == null){
                        paths[pageNum][pathNum].points[i].x = paths[pageNum][pathNum].points[i-1].x;
                        paths[pageNum][pathNum].points[i].y = paths[pageNum][pathNum].points[i-1].y;
                    }
                }
            }
        }
    }
}

export function loadAnnotations(annotations) {
    paths = JSON.parse(annotations);
    //console.log(paths);
    validatePaths();

    if (pdfDoc) {
        renderPage(currentPageNum);
    }
}

export function renderPage(num) {
    currentPageNum = num;
    console.log("render " + num);
    if (isRendering) return;

    isRendering = true;

    pdfDoc.getPage(num).then(page => {
        let viewport = page.getViewport({ scale: pdfScale });
        let headerHeight = 50; // Adjust for margin
        pdfScale = Math.min((window.innerWidth - 20) / viewport.width, (window.innerHeight - headerHeight - 20) / viewport.height);

        // viewport = page.getViewport({ scale: scale });
        // while (pdfSVG.firstChild) {
        //     pdfSVG.removeChild(pdfSVG.firstChild);
        // }
        // pdfSVG.setAttribute('width', viewport.width);
        // pdfSVG.setAttribute('height', viewport.height);
        // Increase the scale for higher resolution rendering
        let rateHighRes = 2;
        if(viewport.width < 500) rateHighRes = 4;
        let highResScale = pdfScale * rateHighRes; // Example: render at double resolution
        viewport = page.getViewport({ scale: highResScale });
        while (pdfSVG.firstChild) {
            pdfSVG.removeChild(pdfSVG.firstChild);
        }
        pdfSVG.setAttribute('width', viewport.width / rateHighRes); // Adjust to match the display scale
        pdfSVG.setAttribute('height', viewport.height / rateHighRes);

        // Create a canvas to render the PDF page
        let canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        let context = canvas.getContext('2d');

        let renderContext = {
            canvasContext: context,
            viewport: viewport
        };

        page.render(renderContext).promise.then(() => {
            // Create an image element and set its href to the canvas data URL
            pdfSVG.appendChild(createImageElement(viewport.width / rateHighRes, viewport.height / rateHighRes, canvas.toDataURL()));
            isRendering = false;

            if(document.getElementById('autoplay').checked){
                stopAnimation();
                playSlider.value = 0;
                if(paths[currentPageNum]){
                    playSlider.max = paths[currentPageNum].length;
                    startAnimation();
                }
            } else {
                stopAnimation();
                if (paths[currentPageNum]) {
                    redrawPaths(paths[currentPageNum].length);
                }    
            }
            updateButtons(); // ボタンの有効/無効を設定
            if(!document.getElementById('autoplay').checked){
                updateSlider(paths[currentPageNum].length, paths[currentPageNum].length);
            }
        }).catch(error => {
            console.error("Error rendering page: ", error);
            isRendering = false;
        });
    }).catch(error => {
        console.error("Error rendering page: ", error);
        isRendering = false;
    });
}

export function changePage(offset) {
    if (isRendering) return;
    // 端っこの場合は無視するよ
    if (offset < 0 && currentPageNum == 1) return;
    if (offset > 0 && currentPageNum == pdfDoc.numPages) return;

    currentPageNum += offset;
    if (currentPageNum < 1) currentPageNum = 1;
    if (currentPageNum > pdfDoc.numPages) currentPageNum = pdfDoc.numPages;
    pdfScale = 1 / parseFloat(document.getElementById('zoomSlider').value);
    renderPage(currentPageNum);
}
