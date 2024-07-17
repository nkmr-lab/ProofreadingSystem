export function calculateAveragePressure(path) {
    if (!path.length) return 0;
    const totalPressure = path.reduce((sum, point) => sum + point.pressure, 0);
    return totalPressure / path.length;
}

export function calculateMedianPressure(_points) {
    if (!_points.length) return 0;
    const pressures = _points.map(point => point.pressure).sort((a, b) => a - b);
    const mid = Math.floor(pressures.length / 2);

    if (pressures.length % 2 === 0) {
        return (pressures[mid - 1] + pressures[mid]) / 2;
    } else {
        return pressures[mid];
    }
}

export function calcConfidenceOfPathsOnPage(pathArray){
    let confidence = 0;

    pathArray.forEach(path => {
        if(path.type != null && path.type == 'path'){
            if(getPathLength(path.points) > 50 && getMedianPressure(path.points) >= 0.9){
                confidence+=2;
            } else if(getPathLength(path.points) > 10 && getMedianPressure(path.points) >= 0.9){
                confidence++;
            } else if(getPathLength(path.points) > 10 && getMedianPressure(path.points) >= 0.8){
                confidence+=0.5;
            }
        }
    });

    return confidence;
}

function getPathLength(points) {
    if (points.length < 2) return 0;

    let length = 0;
    for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x;
        const dy = points[i].y - points[i - 1].y;
        length += Math.sqrt(dx * dx + dy * dy);
    }

    return length;
}

function getMedianPressure(points) {
    if (points.length === 0) return 0;

    const pressures = points.map(point => point.pressure).sort((a, b) => a - b);
    const middle = Math.floor(pressures.length / 2);

    if (pressures.length % 2 === 0) {
        return (pressures[middle - 1] + pressures[middle]) / 2;
    } else {
        return pressures[middle];
    }
}

export function extractUUID(_url) {
    console.log(_url);
    console.log(_url.length);
    if(_url.length < 50) return null;
    try {
        // URLオブジェクトを作成
        let urlObj = new URL(_url);
        // URLパス全体とクエリパラメータを含む文字列を取得
        let fullPath = urlObj.pathname + urlObj.search;
        // UUIDの正規表現
        let uuidRegex = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
        // 正規表現にマッチする部分を抽出
        let match = fullPath.match(uuidRegex);
        if (match) {
            return match[0];
        } else {
            throw new Error("Invalid UUID format");
        }
    } catch (error) {
        console.error("Invalid URL or UUID format:", error);
        return null;
    }
}
