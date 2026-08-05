export const appState = {
    isCheckerMode: false,
    isRecording: false,
    isPaused: false,        // 録音一時停止中
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
    loggedIn: false,
    reviewCb: null,     // LabPay校閲連携: {cb, cbt} 保存成功時に結果URLを返す
    uuid: null,
    isOwner: false,     // 閲覧中の校正の作成者本人か（共有相手の設定可否）
    recipients: [],     // 限定公開の相手（username配列, 作成者にだけ届く）
};
