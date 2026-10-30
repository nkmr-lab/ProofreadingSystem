export const appState = {
    isCheckerMode: false,
    isRecording: false,
    isPaused: false,        // 録音一時停止中
    isBusy: false,          // 録音開始/終了の処理中（ボタン二度押し防止）
    isRendering: false,
    isDrawing: false,
    recordTarget: null,
    currentPageNum: 1,
    drawingMode: 0,
    inputMode: { pen:true, touch:true, mouse:true },
    // スマホ限定：1本指を何に使うか。'draw'=手書き / 'move'=画面移動 / 'auto'=向きで自動判定。
    // PC/iPad では未使用（従来どおり指＝手書き）。
    touchMode: 'auto',
    gesturing: false,   // 2本指ピンチ/パン中は手書きを止める
    penActiveUntil: 0,  // ペン(Apple Pencil)筆記中＋直後のタッチ無視(palm rejection)。performance.now()基準
    penDown: false,     // ペンが物理的に接地している間 true。この間は指(touch)のピンチ/パン/スワイプを一切動かさない（ペン最優先）
    penOnly: false,     // ペン優先モード：ONの間は指(touch)を完全に無視（描画/ピンチ/横スワイプ全部切る）。手をついても確実に書ける。ページは＜前 次＞で
    loggedIn: false,
    reviewCb: null,     // LabPay校閲連携: {cb, cbt} 保存成功時に結果URLを返す
    uuid: null,
    reqUuid: null,      // チェック依頼としてレビュー中なら、その依頼(原稿)のuuid。保存時に request_done で紐づけ
    viewOnly: false,    // 依頼原稿を閲覧のみで開いている（被依頼者でない研究室メンバー）。録音/手書き不可
    pdfUrl: null,       // 閲覧中PDFのダウンロード用URL（ビューアはFileを持たないのでURLで配る）
    staticMode: false,  // 静的モード（校正の全書き込みをページ単位で表示・サムネ一覧）

    mrKey: null,        // LabPay作業中タスク(review_id_reviewer_row_id)としてレビュー中なら、保存後 inreview_done で消す
    isOwner: false,     // 閲覧中の校正の作成者本人か（共有相手の設定可否）
    recipients: [],     // 共有相手（username配列, 作成者にだけ届く）
    restricted: true,   // true=相手だけ閲覧可 / false=相手に届けるが公開（誰でも閲覧可）
};
