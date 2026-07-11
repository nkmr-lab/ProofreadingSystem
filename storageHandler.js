// storageHandler.js
import { updateButtons } from './UIHandler.js';
import { buildTimelinePayload, loadTimelinePayload, attachAudioSync, applyAtTimeMs } from './timelineHandler.js';
import { getUploadedPDFFile, setUploadedPDFFile, loadPDF, loadAnnotations } from './pdfHandler.js';
import { setAudioSourceOrFallback } from './audioHandler.js';
import { appState } from './appState.js';
import { getLocalTimeString } from './subModule.js';

export async function loadDataFromServer(_uuid){
  fetch(`api.php?uuid=${_uuid}`)
  .then((response) => response.json())
  .then(async (data) => {
      if (data.status === 'error') {
          alert('Failed to load PDF: ' + data.message);
          return;
      }

      loadPDF(data.pdf);
      await setAudioSourceOrFallback(data.audio);

      loadAnnotations(data.annotations);

      try {
          const parsed = JSON.parse(data.annotations);
          if (parsed && Array.isArray(parsed.events)) {
              loadTimelinePayload(parsed);
          } else {
              loadTimelinePayload({ events: [] });
          }
      } catch (e) {
          console.warn('Failed to parse annotations JSON for events:', e);
          loadTimelinePayload({ events: [] });
      }

      const audioEl = document.getElementById('audioPlayer');
      if (audioEl && data.audio) {
          audioEl.src = data.audio;

          // 音声再生と同期（play/seeking で applyAtTimeMs を呼ぶ）
          attachAudioSync(audioEl);

          // 読み込み直後（再生前）でも、現在の再生位置（通常0秒）に合わせて状態を反映
          const tMs = (audioEl.currentTime || 0) * 1000;
          applyAtTimeMs(tMs);
      }

      updateButtons();
  })
  .catch((error) => {
      console.error('Error:', error);
  });
}

export function saveJSON(_paths) {
    const data = { paths: _paths };
    const json = JSON.stringify(data);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (new Date()).toISOString() + '.json';
    a.click();
}

export async function saveAnnotations(payloadObject) {
  const _uuid = appState.uuid;
  if (!_uuid) throw new Error('UUID is not set');

  const dataObj = payloadObject ?? getPaths();
  const annotationData = JSON.stringify(dataObj);

  const jsonResponse = await fetch('api.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uuid: _uuid, data: annotationData }),
  });

  const jsonResult = await jsonResponse.json();
  if (jsonResult.status !== 'success') {
    throw new Error(jsonResult.message || 'Failed to save JSON');
  }
}

export async function getPdfBlob(){
  const f = getUploadedPDFFile?.();
  if (f instanceof Blob) return f; // File も Blob の一種
  return null;
}

async function downloadBlobAsFile(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 3000);
}

export async function importZipFile(event){
  const file = event.target.files?.[0];
  if (!file) return;
  try{
    await importDataZipFile(file);
  }catch(err){
    console.error(err);
    alert('ZIP読込に失敗: ' + (err?.message || err));
  } finally {
    event.target.value = '';
  }
}

export async function exportLocalRecordingAsZip({ pdfBlob, audioBlob, audioExt = 'm4a' }){
  if (!window.JSZip) throw new Error('JSZip not loaded');
  if (!pdfBlob)  throw new Error('PDFがローカルにありません（Select File でPDFを選んでください）');
  if (!audioBlob) throw new Error('音声データがありません');

  console.log('audioBlob size', audioBlob?.size);
  if (!audioBlob || audioBlob.size === 0) {
    alert('音声が0KBです。録音データが取得できていません。');
  }

  const payload = buildTimelinePayload();

  const zip = new window.JSZip();
  zip.file('paper.pdf', pdfBlob);
  zip.file(`audio.${audioExt}`, audioBlob);
  zip.file('session.json', JSON.stringify(payload));

  const out = await zip.generateAsync({ type: 'blob' });
  await downloadBlobAsFile(out, "checked_" + getLocalTimeString() + ".zip");
}

export async function importDataZipFile(zipFile){
  if (!window.JSZip) {
    alert('JSZip not loaded');
    return;
  }
  if (!zipFile) return;

  const zip = await window.JSZip.loadAsync(zipFile);

  // ---- helpers ----
  const setAudioFromBlob = (blob) => {
    const audio = document.getElementById('audioPlayer');
    if (!audio) return;
    const url = URL.createObjectURL(blob);
    audio.src = url;
    audio.load();
    // しばらく後に解放（再生に使うので即revokeしない）
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const setPdfFromBlob = (blob) => {
    setUploadedPDFFile?.(blob);
    const url = URL.createObjectURL(blob);
    loadPDF(url);
    // PDFは描画完了まで参照されうるので遅めに解放
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  // ---- 1) PDF（必須）----
  const pdfEntry = zip.file('paper.pdf');
  if (!pdfEntry) {
    alert('zipに paper.pdf が見つかりません');
    return;
  }

  const pdfBlob = await pdfEntry.async('blob');
  setPdfFromBlob(pdfBlob);

  // ---- 2) session.json（あれば最優先）----
  const sessionEntry = zip.file('session.json');
  if (sessionEntry) {
    try {
      const sessionText = await sessionEntry.async('text');
      loadAnnotations(sessionText);
      try {
          const parsed = JSON.parse(sessionText);
          if (parsed && Array.isArray(parsed.events)) {
              loadTimelinePayload(parsed); // timelineHandler 側で payload.events を保持する
          } else {
              loadTimelinePayload({ events: [] });
          }
      } catch (e) {
          console.warn('Failed to parse annotations JSON for events:', e);
          loadTimelinePayload({ events: [] });
      }
    } catch (e) {
      console.warn('Failed to parse session.json', e);
    }
  }

  // ---- 3) audio（sessionの有無に関係なく）----
  const audioEntryM4A = zip.file('audio.m4a');
  const audioEntryMP4 = zip.file('audio.mp4');
  const audioEntry = audioEntryM4A || audioEntryMP4;
  if (audioEntry) {
    let audioBlob = await audioEntry.async('blob');

    // ★ iPhone Safari対策：blob.type が空なら付け直す
    if (!audioBlob.type) {
      const mime = audioEntryMP4 ? 'video/mp4' : 'audio/mp4'; // m4aは audio/mp4 が実体
      audioBlob = audioBlob.slice(0, audioBlob.size, mime);
    }

    setAudioFromBlob(audioBlob);

    const audioPlayer = document.getElementById('audioPlayer');
    if (audioPlayer) {
      // iPhoneは load直後 currentTime が取れない/NaN になることがあるので
      audioPlayer.onloadedmetadata = () => {
        attachAudioSync(audioPlayer);
        const tMs = (audioPlayer.currentTime || 0) * 1000;
        applyAtTimeMs(tMs);
      };
    }
  } else {
    console.warn('No audio in zip');
  }

  // ---- mode/UI：ZIP閲覧は学生モード固定 ----
  appState.isCheckerMode = false;
  updateButtons();
}
