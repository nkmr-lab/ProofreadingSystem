// htmlHandler.js — SVG生成と表示ヘルパ

// 筆圧が強いストローク用の点滅アニメを path に付与
export function addPathAnimation(pathElement, lineWidth){
    const animateStroke = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
    animateStroke.setAttribute('attributeName', 'stroke-width');
    animateStroke.setAttribute('values', `${lineWidth};${lineWidth * 3};${lineWidth}`);
    animateStroke.setAttribute('dur', '1s');
    animateStroke.setAttribute('repeatCount', 'indefinite');

    const animateOpacity = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
    animateOpacity.setAttribute('attributeName', 'stroke-opacity');
    animateOpacity.setAttribute('values', '1;0.5;1');
    animateOpacity.setAttribute('dur', '1s');
    animateOpacity.setAttribute('repeatCount', 'indefinite');

    pathElement.appendChild(animateStroke);
    pathElement.appendChild(animateOpacity);
}

// 点列を移動平均で平滑化し、SVG path の d 文字列に変換
export function generateSVGPath(_points, _scale) {
    function movingAverage(points, windowSize) {
        const smoothed = [];
        const half = Math.floor(windowSize / 2);
        for (let i = 0; i < points.length; i++) {
            const start = Math.max(0, i - half);
            const end = Math.min(points.length - 1, i + half);
            let sumX = 0, sumY = 0, count = 0;
            for (let j = start; j <= end; j++) {
                sumX += points[j].x;
                sumY += points[j].y;
                count++;
            }
            smoothed.push({ x: sumX / count, y: sumY / count });
        }
        return smoothed;
    }

    const smoothedPoints = movingAverage(_points, 5);
    // 端点は元の位置を保持（始点・終点がにじまないように）
    smoothedPoints[0] = _points[0];
    smoothedPoints[smoothedPoints.length - 1] = _points[_points.length - 1];
    return smoothedPoints.map((point, index) => {
        return `${index === 0 ? 'M' : 'L'} ${point.x * _scale} ${point.y * _scale}`;
    }).join(' ');
}

export function setHidden(id, hidden){
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = hidden ? 'none' : '';
}

export function setDisabled(id, disabled){
  const el = document.getElementById(id);
  if (!el) return;
  el.disabled = !!disabled;
}
