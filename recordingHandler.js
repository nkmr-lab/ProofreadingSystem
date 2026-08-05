import { startTimeline, stopTimeline, buildTimelinePayload } from './timelineHandler.js';
import { attachPointerDrawing } from './inputHandler.js';
import { updateButtons } from './UIHandler.js';
import { appState } from './appState.js';
import { ensureUUID, ensureUUIDLocal, getFirstPageText } from './pdfHandler.js';
import { startMp4Recording, stopRecordingAndUpload, stopRecUI, stopRecordingLocalOnly } from './audioHandler.js';
import { setHidden } from './htmlHandler.js';
import { getPdfBlob, exportLocalRecordingAsZip, saveAnnotations } from './storageHandler.js';
import { DrawingMode } from './drawingHandler.js';
import { resetView } from './viewportHandler.js';

export async function startRecordingOnServer(){
  try {
    // UUID確保（PDFアップロード＋pushStateで /{uuid} に）
    appState.recordTarget = 'server';
    const newUuid = await ensureUUID(appState.uuid);
    appState.uuid = newUuid;
    appState.drawingMode = DrawingMode.DRAWING;

    // mp4のみ許可で録音開始
    await startMp4Recording(newUuid);

    document.getElementById('recordServer').textContent = '● サーバー録音中';
    setHidden('recordLocal', true);
    attachPointerDrawing(pdfSVG, appState);
    startTimeline();
    resetView(true);   // 表示を全体に戻し、初期の表示範囲を記録
    updateButtons();

    extractTitleAsync(newUuid);   // 論文タイトルを抽出（非同期・録音は待たせない）
  } catch (e) {
    console.error(e);
    alert(e.message || String(e));
    updateButtons();
  }
}

export async function startRecordingOnLocal(){
  try {
    // UUID確保（PDFアップロード＋pushStateで /{uuid} に）
    appState.recordTarget = 'local';
    const newUuid = await ensureUUIDLocal(appState.uuid);//ensureUUIDwithDummy(appState.uuid);
    appState.uuid = newUuid;
    appState.drawingMode = DrawingMode.DRAWING;

    // mp4のみ許可で録音開始
    await startMp4Recording(newUuid);

    document.getElementById('recordLocal').textContent = '● ローカル録音中';
    setHidden('recordServer', true);
    attachPointerDrawing(pdfSVG, appState);
    startTimeline();
    resetView(true);
  } catch (e) {
    console.error(e);
    alert(e.message || String(e));
  }
  updateButtons();
}

export async function stopRecording(){
  try {
    if (appState.recordTarget === 'server') {
      const result = await stopRecordingAndUpload();
      if( result.status === 'upload_error') {
        const pdfBlob = await getPdfBlob();
        await exportLocalRecordingAsZip({ pdfBlob, audioBlob: result.audioBlob, audioExt: 'm4a', });
        alert('サーバにアップロードできなかったため、チェック結果をダウンロードしました。このファイルを共有して下さい。ZIP読み込みでチェック状況を表示することができます。');
        setTimeout(()=>location.assign('/'), 100);  
      } else if( result.status !== 'error' ){
        await saveAnnotations(buildTimelinePayload());
        // 字幕を裏で先に生成しておく（keepaliveで画面遷移後も継続）。開いた時には出来ている。
        try {
          fetch('transcribe.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'uuid=' + encodeURIComponent(appState.uuid),
            keepalive: true,
          });
        } catch (e) { /* 失敗しても閲覧時に生成できる */ }
        const shareUrl = `https://pr.nkmr.io/${appState.uuid}`;
        await postReviewResult(shareUrl);   // LabPay校閲連携なら結果URLを書き戻す
        alert('チェック結果をサーバにアップロードしました。このURLを共有して下さい。');
        setTimeout(()=>location.assign(`/${appState.uuid}`), 100);
      }
    } else if (appState.recordTarget === 'local') {
      const local = await stopRecordingLocalOnly(); // { uuid, blob, mime }
      if (!local?.blob) throw new Error('録音データが取得できませんでした');
      const pdfBlob = await getPdfBlob();
      await exportLocalRecordingAsZip({ pdfBlob, audioBlob: local.blob, audioExt: 'm4a', });
      alert('チェック結果をダウンロードしました。このファイルを共有して下さい。ZIP読み込みでチェック状況を表示することができます。');
      setTimeout(()=>location.assign('/'), 100);
    }
  } catch (e) {
    console.error(e);
    alert(e.message || String(e));
  }
  // 共通の後処理
  stopTimeline();
  appState.recordTarget = null;
  appState.isCheckerMode = false;
  stopRecUI();
  updateButtons();
}

// 1ページ目テキストから論文タイトルを抽出し、所有者metaに保存（履歴表示用）。
// 非同期・失敗しても録音や保存に影響しない。
async function extractTitleAsync(uuid){
  try {
    const text = await getFirstPageText();
    if (!text) return;
    await fetch('api.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'title', uuid, text }),
    });
  } catch (e) {
    console.warn('title extract failed', e);
  }
}

// LabPay の「校閲する」経由なら、保存した校閲URLを元のタスク添付へ返却する。
async function postReviewResult(resultUrl) {
  const rc = appState.reviewCb;
  if (!rc?.cb || !rc?.cbt) return;
  try {
    await fetch(rc.cb, {
      method: 'POST',
      // LabPay は状態変更POSTに X-Requested-With: labpay(CSRF対策)を要求する。
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'labpay' },
      body: JSON.stringify({ cbt: rc.cbt, resultUrl }),
    });
  } catch (e) {
    console.warn('review result callback failed', e);
  }
}