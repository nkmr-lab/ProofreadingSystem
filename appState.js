export const appState = {
    isCheckerMode: false,
    isRecording: false,
    isRendering: false,
    isDrawing: false,
    recordTarget: null,
    currentPageNum: 1,
    drawingMode: 0,
    inputMode: { pen:true, touch:true, mouse:true },
    gesturing: false,   // 2本指ピンチ/パン中は手書きを止める
    loggedIn: false,
    reviewCb: null,     // LabPay校閲連携: {cb, cbt} 保存成功時に結果URLを返す
    uuid: null,
};
