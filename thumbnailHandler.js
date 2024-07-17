import { pdfDoc, renderPage, paths } from './pdfHandler.js';
import { getAlphaFromPressure, getWidthFromPressure } from './drawingHandler.js';
import { calculateMedianPressure, calcConfidenceOfPathsOnPage } from './subModule.js';
import { createImageElement, createPathElement } from './htmlHandler.js';

const thumbnailScale = 0.4;

function createPathElementForThumbnail(path)
{
    if(path.type != null && path.type === 'path'){
        let pressure = calculateMedianPressure(path.points);
        let alpha = getAlphaFromPressure(pressure);        
        return createPathElement(path.points, thumbnailScale, `rgba(255, 0, 0, ${alpha})`, getWidthFromPressure(pressure, thumbnailScale));
    } else if(path.type == null){ // 後で消す
        let pressure = calculateMedianPressure(path);
        let alpha = getAlphaFromPressure(pressure);        
        return createPathElement(path, thumbnailScale, `rgba(255, 0, 0, ${alpha})`, getWidthFromPressure(pressure, thumbnailScale));
    }
    return null;
}

export function showThumbnails(filtered) {
    if (!pdfDoc) {
        console.error("PDF document is not loaded.");
        return;
    }

    let thumbnailsDiv = document.getElementById('thumbnails');
    thumbnailsDiv.innerHTML = '<div style="font-size: 48px; position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);">Loading thumbnails...</div>';

    let promises = [];
    for (let i = 1; i <= pdfDoc.numPages; i++) {
        if ((filtered && paths[i] && paths[i].length > 0) || !filtered) {
            promises.push(pdfDoc.getPage(i).then(page => {
                let viewport = page.getViewport({ scale: thumbnailScale });

                let thumbnailSVG = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                thumbnailSVG.setAttribute('width', viewport.width);
                thumbnailSVG.setAttribute('height', viewport.height);

                // Create a canvas to render the PDF page for thumbnail
                let canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                let context = canvas.getContext('2d');

                let renderContext = {
                    canvasContext: context,
                    viewport: viewport
                };

                return page.render(renderContext).promise.then(() => {
                    // Create an image element and set its href to the canvas data URL
                    thumbnailSVG.appendChild(createImageElement(viewport.width, viewport.height, canvas.toDataURL()));
                    if (paths[i] && paths[i].length > 0) {
                        paths[i].forEach(path => {
                            if(path.type == null || (path.type != null && path.type === 'path')){
                                thumbnailSVG.appendChild(createPathElementForThumbnail(path));
                            }
                        });
                    }
                    return { thumbnailSVG, pageIndex: i };
                });
            }).catch(error => {
                console.error("Error generating thumbnail: ", error);
            }));
        }
    }

    Promise.all(promises).then(thumbnails => {
        thumbnailsDiv.innerHTML = '';
        thumbnails.sort((a, b) => a.pageIndex - b.pageIndex);
        thumbnails.forEach(({ thumbnailSVG, pageIndex }) => {
            let thumbnail = document.createElement('div');
            thumbnail.className = 'thumbnail';
            thumbnail.appendChild(thumbnailSVG);
            thumbnail.addEventListener('click', () => {
                renderPage(pageIndex);
                thumbnailsDiv.style.display = 'none';
                document.getElementById('pdf-svg').style.display = 'block';
            });
            thumbnailsDiv.appendChild(thumbnail);

            // 手書きがあるページには枠を付ける
            if (paths[pageIndex] && paths[pageIndex].length > 0) {
                thumbnail.style.border = highlightThumbnail(paths[pageIndex]);
            }
        });
    }).catch(error => {
        console.error("Error generating thumbnails: ", error);
    });

    thumbnailsDiv.style.display = 'grid';
    document.getElementById('pdf-svg').style.display = 'none';
}

function highlightThumbnail(paths){
    const confidence = calcConfidenceOfPathsOnPage(paths);
    let borderColor = 'red';
    let borderWidth = '2px';
    if (confidence > 3) {
        borderWidth = '10px';
    } else if (confidence > 2) {
        borderWidth = '5px';
    }
    return `${borderWidth} solid ${borderColor}`;
}
