import { setEditing } from './drawingHandler.js';
import { currentPageNum, paths } from './pdfHandler.js';

export function createImageElement(_width, _height, _imgDataURL)
{
    let imgElement = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    imgElement.setAttribute('href', _imgDataURL);
    imgElement.setAttribute('x', 0);
    imgElement.setAttribute('y', 0);
    imgElement.setAttribute('width', _width);
    imgElement.setAttribute('height', _height);
    return imgElement;
}

export function createPathElement(_points, _scale, _color, _lineWidth){
    let pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathElement.setAttribute('d', generateSVGPath(_points, _scale));
    pathElement.setAttribute('stroke', _color);
    pathElement.setAttribute('stroke-width', _lineWidth);
    pathElement.setAttribute('fill', 'none');
    return pathElement;
}

export function addPathAnimation(pathElement, lineWidth){
    let animateStroke = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
    animateStroke.setAttribute('attributeName', 'stroke-width');
    animateStroke.setAttribute('values', `${lineWidth};${lineWidth * 3};${lineWidth}`);
    animateStroke.setAttribute('dur', '1s');
    animateStroke.setAttribute('repeatCount', 'indefinite');

    let animateOpacity = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
    animateOpacity.setAttribute('attributeName', 'stroke-opacity');
    animateOpacity.setAttribute('values', '1;0.5;1');
    animateOpacity.setAttribute('dur', '1s');
    animateOpacity.setAttribute('repeatCount', 'indefinite');

    pathElement.appendChild(animateStroke);
    pathElement.appendChild(animateOpacity);
}

export function generateEraseElement(_points, _scale, _color, _lineWidth){
    let pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathElement.setAttribute('d', generateSVGPath(_points, _scale));
    pathElement.setAttribute('stroke', _color);
    pathElement.setAttribute('stroke-width', _lineWidth);
    pathElement.setAttribute('fill', 'none');
    return pathElement;
}

export function generateSVGPath(_points, _scale){
    return _points.map((point, index) => {
        return `${index === 0 ? 'M' : 'L'} ${point.x * _scale} ${point.y * _scale}`;
    }).join(' ');
}

function adjustSize(_textSpan, _parentDiv, _foreignObject) 
{   
    // foreignObjectの現在の大きさを取得
    // const width = foreignObject.getAttribute('width');
    // const height = foreignObject.getAttribute('height');
    // console.log(`foreignObjectの幅: ${width}`);
    // console.log(`foreignObjectの高さ: ${height}`);

    // requestAnimationFrameでレンダリング後にサイズを取得
    requestAnimationFrame(() => {
        const rect = _textSpan.getBoundingClientRect();
        // console.log(`spanの幅: ${rect.width}`);
        // console.log(`spanの高さ: ${rect.height}`);

        _parentDiv.setAttribute('width', rect.width+8);
        _parentDiv.setAttribute('height', rect.height);
        // foreignObjectのサイズを調整
        _foreignObject.setAttribute('width', rect.width+10);
        _foreignObject.setAttribute('height', rect.height+5);
    });
    
    // foreignObjectのサイズを調整
    //foreignObject.setAttribute('width', rect.width);
    //foreignObject.setAttribute('height', rect.height);
}

function updatePathsByEdit(_pagePaths, _x, _y, _text){
    const textPath = _pagePaths.find(p => p.type === 'text' && p.x === _x && p.y === _y);
    if (textPath) {
        textPath.text = _text;
    }
}

function resizeForeignObjectIfMinimized(_foreignObject, _scale){   
    if(_foreignObject.getAttribute('width') < 150 * _scale)
        _foreignObject.setAttribute('width', 150 * _scale);
    if(_foreignObject.getAttribute('height') < 50 * _scale)
        _foreignObject.setAttribute('height', 50 * _scale);
}

export function createTextElement(_x, _y, _scale, _text) {
    const foreignObject = createForeignObject(_x, _y, _scale);
    const div = createParentDivElement();

    const span = document.createElement('span');
    span.innerHTML = _text.replace(/\r?\n/g, '<br>');
    span.style.fontSize = (8 * _scale) + 'pt';
    span.style.display = 'inline-block';
    span.style.position = 'absolute';
    span.style.top = '0';
    span.style.padding = '1px';
    // span.style.width = '100%';
    // span.style.height = '100%';
    span.style.cursor = 'pointer';
    span.style.color = 'red';

    span.onclick = (e) => {
        setEditing(true);
        e.stopPropagation();
        resizeForeignObjectIfMinimized(foreignObject, _scale);

        const input = createTextareaElement(_scale);
        input.value = _text;

        const button = createSaveButtonElement();

        input.onblur = () => {
            span.innerHTML = input.value.replace(/\r?\n/g, '<br>');
            div.replaceChild(span, input);
            adjustSize(span, div, foreignObject);

            div.removeChild(button);
            updatePathsByEdit(paths[currentPageNum], _x, _y, input.value);
            setEditing(false);
        };
        div.replaceChild(input, span);

        button.onclick = (e) => {
            e.stopPropagation();
            span.innerHTML = input.value.replace(/\r?\n/g, '<br>');
            div.replaceChild(span, input);
            adjustSize(span, div, foreignObject);

            div.removeChild(button);
            updatePathsByEdit(paths[currentPageNum], _x, _y, input.value);
            setEditing(false);
        }

        div.appendChild(button);
        input.focus();
    };

    div.appendChild(span);
    foreignObject.appendChild(div);
    adjustSize(span, div, foreignObject);

    // イベント伝播を停止するためのイベントリスナー
    foreignObject.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });
    foreignObject.addEventListener('mouseup', (e) => {
        e.stopPropagation();
    });
    return foreignObject;
}

function createForeignObject(_x, _y, _scale){
    const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    foreignObject.setAttribute('x', _x * _scale);
    foreignObject.setAttribute('y', _y * _scale);
    foreignObject.setAttribute('width', 150 * _scale);
    foreignObject.setAttribute('height', 50 * _scale)
    foreignObject.classList.add('text-box');
    return foreignObject;    
}

function createParentDivElement(){
    let div = document.createElement('div');
    div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    div.style.position = 'relative';
    div.style.background = 'rgba(255, 255, 200, 0.8)';
    div.style.border = '1px solid black';
    div.style.padding = '0px';
    div.style.borderRadius = '5px';
    div.style.width = '90%';
    div.style.height = '90%';
    return div;
}

function createTextareaElement(_scale)
{
    const textarea = document.createElement('textarea');
    textarea.style.width = '100%';//'calc(100% - 20px)';
    textarea.style.height = '100%';
    textarea.style.margin = '0px';
    textarea.style.fontSize = (8 * _scale) + 'pt';
    return textarea;
}

function createSaveButtonElement(){
    let button = document.createElement('button');
    button.innerText = '✓';
    button.fontSize = '8pt';
    button.style.position = 'absolute';
    button.style.background = 'orange';
    button.style.top = '0';
    button.style.left = '0';
    button.style.width = '10px';
    button.style.height = '10px';
    return button;
}

// テキストボックスを作成する関数
export function createTextBox(_x, _y, _scale, onSave) {
    console.log("create text box");
    const foreignObject = createForeignObject(_x, _y, _scale);
    const div = createParentDivElement();
    const input = createTextareaElement(_scale);

    const button = createSaveButtonElement();
    button.onclick = (e) => {
        e.stopPropagation();
        console.log("save! " + input.value);
        onSave(input.value);
        setEditing(false);
        //pdfSVG.removeChild(foreignObject);
    };

    div.appendChild(input);
    div.appendChild(button);
    foreignObject.appendChild(div);
    console.log(foreignObject);

    // イベント伝播を停止するためのイベントリスナー
    foreignObject.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });

    return foreignObject;
}
