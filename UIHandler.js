import { DrawingMode } from "./drawingHandler.js";
import { paths, pdfDoc, handleFileSelect } from "./pdfHandler.js";
import { setHidden, setDisabled } from './htmlHandler.js';
import { appState } from './appState.js';

export function updateButtons() {
    if( appState.isCheckerMode == false ){
        // 学生側：ページボタンも描画もundoも不要（＝触らせない）
        setHidden('speedButtons', false);
        setHidden('audioPlayer', false);
        setHidden('skipSilence', false);   // 無音スキップは閲覧時のみ
        setHidden('prev-page', true);
        setHidden('next-page', true);
        setHidden('drawing-mode', true);
        setHidden('undo', true);
        setHidden('recordServer', true);
        setHidden('recordLocal', true);
        setHidden('recordStop', true);
        setHidden('inputModeBox', true);
        setHidden('touchModeBox', true);
        setHidden('recIndicator', true);
        setHidden('zipControls', true);
        setHidden('pdfControls', true);
        setHidden('description', true);
        setHidden('pdf-container', false);

        setDisabled('prev-page', true);
        setDisabled('next-page', true);
        setDisabled('drawing-mode', true);
        setDisabled('undo', true);

        initPlaybackSpeedUI();
    } else {
        if(pdfDoc){
            document.body.style.overflow = "hidden";
            setHidden('description', true);
            setHidden('pdf-container', false);
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
                if( appState.recordTarget === 'server') setHidden('recordLocal', true);
                if( appState.recordTarget === 'local') setHidden('recordServer', true);
                setDisabled('recordServer', true);
                setDisabled('recordLocal', true);
                setHidden('recordStop', false);
                setDisabled('recordStop', false);
                setHidden('recIndicator', false);
                setDisabled('drawing-mode', false);
                setHidden('homeButton', true);
                setDisabled('undo', !(paths[appState.currentPageNum] != null && paths[appState.currentPageNum].length > 0));
            } else {
                setHidden('homeButton', false);
                setDisabled('drawing-mode', true);
                setDisabled('undo', true);
                setHidden('recordStop', true);
                setHidden('recIndicator', true);
            }
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