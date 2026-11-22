// HTMLエスケープ（各モジュールで重複していたのを共通化）
export function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// api.php への JSON POST（成功以外は例外）。各所の定型 fetch を共通化。
export async function apiPost(body){
    const r = await fetch('api.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.status !== 'success') throw new Error(d.message || `失敗しました (${r.status})`);
    return d;
}

// 下部パネル（文字起こし/査読）の表示制御を共通化。bodyClass は左右分割用（t-open/r-open）。
export function makePanel(panelEl, bodyClass){
    const show = (v) => {
        if (panelEl) panelEl.style.display = v ? '' : 'none';
        document.body.classList.toggle(bodyClass, !!(v && panelEl));
    };
    const toggle = () => { if (panelEl) show(panelEl.style.display === 'none'); };
    return { show, toggle };
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

// 学年を昇順（教員→B1、GRADE_ORDER順。未知の学年は末尾）に並べる。share/request 共用。
export function sortGradesAsc(grades){
  return grades.slice().sort((a, b) => {
    const ia = GRADE_ORDER.indexOf(a), ib = GRADE_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

// 研究室メンバーを学年ごとにまとめたチェックボックス群のHTMLを返す。
// shareHandler（共有相手）と requestHandler（依頼相手）で重複していた描画を共通化。
//   opts.selected   : 既定でチェックする user 配列（共有の現在値など）
//   opts.gradeFilter : 表示する学年の Set（未指定＝全員。依頼は REVIEWER_GRADES で絞る）
//   opts.withName   : <input> に data-name を付けるか（依頼は選択時に表示名が要る）
export function renderMemberPicker(users, { selected = [], gradeFilter = null, withName = false } = {}){
  const sel = new Set(selected);
  const byGrade = {};
  for (const u of users){
    if (gradeFilter && !gradeFilter.has(u.grade)) continue;
    (byGrade[u.grade] ||= []).push(u);
  }
  let html = '';
  for (const g of sortGradesAsc(Object.keys(byGrade))){
    html += `<div class="share-grade">${escapeHtml(g || 'その他')}</div><div class="share-grade-list">`;
    for (const u of byGrade[g]){
      const checked  = sel.has(u.user) ? ' checked' : '';
      const nameAttr = withName ? ` data-name="${escapeHtml(u.name || u.user)}"` : '';
      html += `<label class="share-member"><input type="checkbox" value="${escapeHtml(u.user)}"${checked}${nameAttr}> ${escapeHtml(u.name || u.user)}</label>`;
    }
    html += '</div>';
  }
  return html;
}

// 共有/依頼モーダルのステータス行表示。el は status 要素。share/request 共用。
export function setPickerStatus(el, msg, isErr){
  if (!el) return;
  el.textContent = msg;
  el.style.color = isErr ? 'var(--danger)' : 'var(--muted)';
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
