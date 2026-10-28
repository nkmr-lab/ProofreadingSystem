// HTMLエスケープ（各モジュールで重複していたのを共通化）
export function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// 研究室メンバー一覧（共有・依頼ピッカー用）。requestHandler/shareHandler で重複していたのを共通化。
export const GRADE_ORDER = ['教員', 'D3', 'D2', 'D1', 'M2', 'M1', 'B4', 'B3', 'B2', 'B1'];
let _rosterCache = null;
export async function fetchRoster(){
    if (_rosterCache) return _rosterCache;
    const res = await fetch('api.php?action=roster');
    const data = await res.json();
    _rosterCache = (data.users || []).filter(u => u.user && u.user !== 'nkmrlab');
    return _rosterCache;
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

export function extractUUID(_url) {
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

export function getLocalTimeString(){
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` + `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
