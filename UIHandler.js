import { DrawingMode } from "./drawingHandler.js";
import { paths, pdfDoc, handleFileSelect } from "./pdfHandler.js";
import { setHidden, setDisabled } from './htmlHandler.js';
import { appState } from './appState.js';

// ホームのダッシュボード（依頼ボタン・依頼/共有/履歴一覧）はホーム(PDF未読込)でのみ表示。
function setDashboardHidden(hidden) {
    ['requestBox', 'inreviewBox', 'requestsInBox', 'requestsOutBox', 'sharedBox', 'historyBox'].forEach(id => setHidden(id, hidden));
}

export function updateButtons() {
    // 速度トグル/静的モードは閲覧時のみ。既定は隠し、閲覧ブランチで出す。
    setHidden('speedToggle', true);
    setHidden('staticMode', true);
    if( appState.isCheckerMode == false ){
        setDashboardHidden(true);   // 閲覧時はダッシュボードを隠す
        setHidden('downloadPdf', false);   // PDFダウンロードは閲覧時に出す（共有された校正なのでDL可）
        setHidden('staticMode', false);    // 静的モードボタンは閲覧時に出す
        setHidden('drawing-mode', true);
        setHidden('undo', true);
        setHidden('recordServer', true);
        setHidden('recordLocal', true);
        setHidden('recordStop', true);
        setHidden('recordPause', true);
        setHidden('inputModeBox', true);
        setHidden('touchModeBox', true);
        setHidden('recIndicator', true);
        setHidden('zipControls', true);
        setHidden('pdfControls', true);
        setHidden('description', true);
        setHidden('pdf-container', false);
        setDisabled('drawing-mode', true);
        setDisabled('undo', true);

        if (appState.staticMode){
            // 静的モード：全書き込み表示＋ページ移動＋サムネ一覧。再生系は隠す。
            setHidden('audioPlayer', true);
            setHidden('speedButtons', true);
            setHidden('skipSilence', true);
            setHidden('shareReview', true);
            setHidden('prev-page', false);
            setHidden('next-page', false);
            setDisabled('prev-page', appState.currentPageNum <= 1);
            setDisabled('next-page', !pdfDoc || appState.currentPageNum >= pdfDoc.numPages);
        } else {
            // 通常の再生ビュー（速度ボタン群は「再生速度」トグルで出す＝ここでは触らない）
            setHidden('audioPlayer', false);
            setHidden('speedToggle', false);
            setHidden('skipSilence', false);
            setHidden('shareReview', !appState.isOwner);   // 共有は作成者のみ
            setHidden('prev-page', true);
            setHidden('next-page', true);
            setDisabled('prev-page', true);
            setDisabled('next-page', true);
            initPlaybackSpeedUI();
        }
    } else {
        if(pdfDoc){
            document.body.style.overflow = "hidden";
            setDashboardHidden(true);   // 録音/チェック中はダッシュボードを隠す
            setHidden('description', true);
            setHidden('pdf-container', false);

            // 閲覧のみ（被依頼者でない研究室メンバーが依頼原稿を開いた）：
            // 原稿PDFを読む＋ページ送り＋拡大だけ。録音・手書き・保存系は一切出さない。
            if (appState.viewOnly){
                ['recordServer','recordLocal','loginServerBtn','drawing-mode','undo',
                 'recordStop','recordPause','recIndicator','zipControls','reqBanner'].forEach(id => setHidden(id, true));
                setHidden('prev-page', false);
                setHidden('next-page', false);
                setDisabled('prev-page', appState.currentPageNum <= 1);
                setDisabled('next-page', appState.currentPageNum >= pdfDoc.numPages);
                setHidden('homeButton', false);
                setHidden('userMenu', false);
                setHidden('downloadPdf', false);   // 閲覧のみでもPDFは落とせる
                const rec0 = document.getElementById('recordServer');
                if (rec0) rec0.classList.remove('blink');
                return;
            }
            // ログイン中はサーバ蓄積に一本化（サーバー録音のみ）。
            // 未ログイン/外部はローカル録音のみ＋ログイン誘導ボタン。
            const loggedIn = !!appState.loggedIn;
            setHidden('recordServer', !loggedIn);
            setDisabled('recordServer', !loggedIn);
            setHidden('recordLocal', loggedIn);
            setDisabled('recordLocal', loggedIn);
            setHidden('loginServerBtn', loggedIn || appState.isRecording);
            setHidden('drawing-mode', false);
            setHidden('undo', false);

            setHidden('prev-page', false);
            setHidden('next-page', false);
            setDisabled('prev-page', appState.currentPageNum <= 1);
            setDisabled('next-page', appState.currentPageNum >= pdfDoc.numPages);
            setHidden('zipControls', true);
            if( appState.isRecording ){
                setHidden('reqBanner', true);   // 録音開始したら依頼バナーを隠す（邪魔・誤タップ防止）
                // 録音中は「録音開始」ボタン(サーバ/ローカル)は不要＝隠す（録音終了ボタンとインジケータがある）。
                setHidden('recordServer', true);
                setHidden('recordLocal', true);
                setDisabled('recordServer', true);
                setDisabled('recordLocal', true);
                setHidden('recordStop', false);
                setDisabled('recordStop', false);
                setHidden('recordPause', false);
                setDisabled('recordPause', false);
                setHidden('recIndicator', false);
                setDisabled('drawing-mode', false);
                setHidden('homeButton', true);
                setHidden('userMenu', true);     // 録音中はユーザーアイコン不要（音量・経過時間だけでよい）
                setDisabled('undo', !(paths[appState.currentPageNum] != null && paths[appState.currentPageNum].length > 0));
            } else {
                setHidden('homeButton', false);
                setHidden('userMenu', false);    // 録音中以外はユーザーアイコンを表示
                setDisabled('drawing-mode', true);
                setDisabled('undo', true);
                setHidden('recordStop', true);
                setHidden('recordPause', true);
                setHidden('recIndicator', true);
            }
            // 依頼（pr依頼 or LabPay作業中）を開いて録音待ちのときは「サーバー録音」ボタンを点滅させ、
            // 「ここを押して」と知らせる（以前の指示バナーの代わり）。
            const rec = document.getElementById('recordServer');
            if (rec) rec.classList.toggle(
                'blink',
                loggedIn && !appState.isRecording && !!(appState.reqUuid || appState.mrKey)
            );
            // 録音終了ボタンも録音中はふわふわ（開始ボタンと同じく「押せる」合図）
            const stopB = document.getElementById('recordStop');
            if (stopB) stopB.classList.toggle('blink', appState.isRecording);
            setHidden('downloadPdf', appState.isRecording);   // 録音中以外はPDFダウンロードを出す
        } else {
            document.body.style.overflow = "auto";
            setHidden('description', false);
            setHidden('pdf-container', true);
            setHidden('speedButtons', true);
            setHidden('audioPlayer', true);
            setHidden('recordServer', true);
            setHidden('recordLocal', true);
            setHidden('recIndicator', true);
            setHidden('recordStop', true);
            setHidden('recordPause', true);
            setHidden('loginServerBtn', appState.loggedIn);   // 未ログインならホームでもログイン入口を出す
            setHidden('downloadPdf', true);   // ホーム（PDF未読込）では出さない
            setHidden('prev-page', true);
            setHidden('next-page', true);
            setHidden('drawing-mode', true);
            setHidden('undo', true);
        }
    }
}

// 再生速度ボタンの初期化。updateButtons から何度も呼ばれるので、
// リスナー多重登録を防ぐため一度だけ実行する。
let speedUIReady = false;
export function initPlaybackSpeedUI() {
  if (speedUIReady) return;
  const audioEl = document.getElementById('audioPlayer');
  const container = document.getElementById('speedButtons');
  if (!audioEl || !container) return;

  const btns = Array.from(container.querySelectorAll('.speedBtn'));
  if (btns.length === 0) return;

  const setActive = (rate) => {
    btns.forEach((b) => b.classList.toggle('active', b.dataset.rate === String(rate)));
  };

  audioEl.playbackRate = 1.0;   // 初期状態：等速
  setActive(1.0);

  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const r = parseFloat(btn.dataset.rate);
      if (!Number.isFinite(r)) return;
      audioEl.playbackRate = r;
      setActive(r);
    });
  });

  // 外部要因で速度が変わってもUIを追従
  audioEl.addEventListener('ratechange', () => setActive(audioEl.playbackRate));

  speedUIReady = true;
}

export function initFileInputButton() {
    document.getElementById('file-select-button').addEventListener('click', () => {
        document.getElementById('file-input').click();
    });
    document.getElementById('file-input').addEventListener('change', handleFileSelect);
}

export function toggleDrawingMode() {
    appState.drawingMode = DrawingMode.next(appState.drawingMode);

    const btn = document.getElementById('drawing-mode');
    if(appState.drawingMode === DrawingMode.DRAWING){
        btn.innerText = "[描く] 消す";
        btn.classList.add('is-drawing');
        btn.classList.remove('is-erasing');
    } else if(appState.drawingMode === DrawingMode.ERASING){
        btn.innerText = "描く [消す]";
        btn.classList.add('is-erasing');
        btn.classList.remove('is-drawing');
    }
}