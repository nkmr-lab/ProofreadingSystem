import { startTimeline, stopTimeline, buildTimelinePayload, pauseTimeline, resumeTimeline } from './timelineHandler.js';
import { attachPointerDrawing } from './inputHandler.js';
import { updateButtons } from './UIHandler.js';
import { appState } from './appState.js';
import { ensureUUID, ensureUUIDLocal, getFirstPageText } from './pdfHandler.js';
import { startMp4Recording, stopRecordingAndUpload, stopRecUI, stopRecordingLocalOnly, pauseMic, resumeMic } from './audioHandler.js';
import { setHidden, setDisabled } from './htmlHandler.js';
import { getPdfBlob, exportLocalRecordingAsZip, saveAnnotations } from './storageHandler.js';
import { DrawingMode } from './drawingHandler.js';
import { resetView } from './viewportHandler.js';
import { hud } from './debugHud.js';

export async function startRecordingOnServer(){
  // 押した瞬間に処理中フラグを立て、二度押し（反応待ちの再クリック）を無視する。
  if (appState.isBusy || appState.isRecording) return;
  appState.isBusy = true;
  const btn = document.getElementById('recordServer');
  // 即座に無効化＋表示を変えて「押せた」ことを分かるようにする（準備には数秒かかるため）。
  setDisabled('recordServer', true);
  setDisabled('recordLocal', true);
  if (btn){ btn.classList.remove('blink'); btn.textContent = '準備中…'; }
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
    if (btn) btn.textContent = '● サーバー録音';
    updateButtons();
  } finally {
    appState.isBusy = false;
  }
}

export async function startRecordingOnLocal(){
  if (appState.isBusy || appState.isRecording) return;
  appState.isBusy = true;
  const btn = document.getElementById('recordLocal');
  setDisabled('recordServer', true);
  setDisabled('recordLocal', true);
  if (btn) btn.textContent = '準備中…';
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
    if (btn) btn.textContent = '● ローカル録音';
  } finally {
    appState.isBusy = false;
  }
  updateButtons();
}

// 録音の一時停止/再開。音声(MediaRecorder)とタイムライン時計の両方を止める。
export function togglePauseRecording(){
  if (!appState.isRecording) return;
  if (!appState.isPaused){
    appState.isPaused = true;
    pauseMic();
    pauseTimeline();
  } else {
    appState.isPaused = false;
    resumeMic();
    resumeTimeline();
  }
  const btn = document.getElementById('recordPause');
  if (btn) btn.textContent = appState.isPaused ? '▶ 再開' : '⏸ 一時停止';
  const ind = document.getElementById('recIndicator');
  if (ind) ind.classList.toggle('is-paused', appState.isPaused);
  const t = document.getElementById('recTimer');
  if (t) t.classList.toggle('is-paused', appState.isPaused);
}

export async function stopRecording(){
  // アップロード・保存に数秒かかる。終了ボタンの二度押しで stopRecording が重複実行されるのを防ぐ。
  if (appState.isBusy) return;
  appState.isBusy = true;
  const sbtn = document.getElementById('recordStop');
  // 即座に無効化＋表示を変えて「押せた」ことを分かるようにする。
  setDisabled('recordStop', true);
  setDisabled('recordPause', true);
  if (sbtn) sbtn.textContent = '■ 保存中…';
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
        // pr単独のチェック依頼のレビュー中なら、結果を依頼に紐づける
        if (appState.reqUuid) {
          try {
            await fetch('api.php', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'request_done', uuid: appState.reqUuid, result_uuid: appState.uuid }),
            });
          } catch (e) { console.warn('request_done failed', e); }
        }
        // LabPay作業中タスクのレビューなら、結果返却(postReviewResult)済み後に作業中から外す
        if (appState.mrKey && appState.reviewCb?.cbt) {
          try {
            await fetch('api.php', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'inreview_done', key: appState.mrKey }),
            });
          } catch (e) { console.warn('inreview_done failed', e); }
        }
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
  appState.isPaused = false;
  const pbtn = document.getElementById('recordPause');
  if (pbtn) pbtn.textContent = '⏸ 一時停止';
  if (sbtn) sbtn.textContent = '■ 録音終了';   // 画面遷移しなかった場合に備えて戻す
  stopRecUI();
  updateButtons();
  appState.isBusy = false;
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
// ★ブラウザから pay.nkmr.io へ直接POSTすると CORS(プリフライト)で弾かれるため、
//   pr のサーバ(api.php)経由で中継する(roster と同じCORS回避)。結果コードをHUDに出す。
async function postReviewResult(resultUrl) {
  const rc = appState.reviewCb;
  if (!rc?.cb || !rc?.cbt) { hud('cb: reviewCb無し(LabPay通知しない)'); return; }
  try {
    const r = await fetch('api.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'review_callback', cb: rc.cb, cbt: rc.cbt, resultUrl }),
    });
    const d = await r.json().catch(() => ({}));
    hud(`cb->LabPay http=${d.code ?? r.status} ${d.err ? ('err=' + d.err) : ''}`);
    console.log('review_callback result', d);
  } catch (e) {
    hud('cb->LabPay 送信失敗');
    console.warn('review result callback failed', e);
  }
}