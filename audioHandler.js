import { attachAudioSync, getRecordingMs } from './timelineHandler.js';
import { appState } from './appState.js';
import { dbg } from './debugOverlay.js';

// 録音の一時停止/再開（音声）。タイムライン側は recordingHandler が pause/resumeTimeline を呼ぶ。
export function pauseMic(){ try { if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.pause(); } catch (e) {} }
export function resumeMic(){ try { if (mediaRecorder && mediaRecorder.state === 'paused') mediaRecorder.resume(); } catch (e) {} }

function pickMimeType(){
  const candidates = [
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
  ];
  for (const t of candidates) {
    if (window.MediaRecorder?.isTypeSupported?.(t)) return t;
  }
  return '';
}

let mediaRecorder = null;
let audioChunks = [];
let currentUuid = '';

const AUDIO_MIME = 'audio/mp4';   // mp4のみ許可（Safari/iOS想定）
const AUDIO_BITRATE = 64000;      // サイズ抑制（必要に応じて調整）
const UPLOAD_TIMEOUT_MS = 90_000; // ★ネットワーク詰まり対策（90秒）

async function uploadAudio(uuid, blob, filename) {
  const form = new FormData();
  form.append('uuid', uuid);
  form.append('audio', blob, filename);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  try {
    const res = await fetch('api.php', {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });

    // サーバが落ちてる/HTML返す等もあるのでガード
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json().catch(() => null);
    if (!json) throw new Error('Upload response is not JSON');

    if (json.status !== 'success') {
      throw new Error(json.message || 'Failed to upload audio');
    }
    return json;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function startMp4Recording(_uuid) {
  // dbg("start recording.");
  if (!_uuid) throw new Error('UUID is required to start recording.');

  if (!window.MediaRecorder) {
    throw new Error('MediaRecorder is not supported in this browser.');
  }

  currentUuid = _uuid;
  audioChunks = [];

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  // iOSは「指定しない」のが強いので、pickMimeTypeは '' を返せるようにしておくのが吉
  const mimeType = pickMimeType(); // '' or 'audio/mp4' etc
  dbg('chosen mimeType', mimeType || '(browser default)');

  startRecUI(stream, () => dbg('startRecUI'));

  // mimeTypeが空なら optionsから外す（ブラウザに任せる）
  const opts = {
    audioBitsPerSecond: AUDIO_BITRATE,
  };
  if (mimeType) opts.mimeType = mimeType;

  mediaRecorder = new MediaRecorder(stream, opts);
  // lastAudioMime = 
  mediaRecorder.mimeType || mimeType || 'audio/mp4';
  // dbg('actual recorder mimeType', mediaRecorder.mimeType);

  // let n = 0;
  mediaRecorder.ondataavailable = (e) => {
    // dbg('dataavailable', ++n, 'size=', e.data?.size, 'type=', e.data?.type);
    if (e.data && e.data.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    // dbg('onstop fired');
    stream.getTracks().forEach(t => t.stop());
    stopRecUI?.();
  };

  // mediaRecorder.onstart = ()=>dbg('onstart fired');
  // mediaRecorder.onerror = (e)=>dbg('onerror', e?.error?.message || e?.message || String(e));

  mediaRecorder.start(1000);
  appState.isRecording = true;
}

export async function stopRecordingAndUpload({ allowDownloadOnFail = true } = {}) {
  if (!mediaRecorder || !appState.isRecording) return {status: 'error'};

  const uuid = currentUuid;
  const stopped = new Promise((resolve) => {
    mediaRecorder.addEventListener('stop', resolve, { once: true });
  });

  mediaRecorder.stop();
  await stopped;

  // Blob生成（救済のため保持）
  const blob = new Blob(audioChunks, { type: AUDIO_MIME });
  audioChunks = [];
  appState.isRecording = false;

  // ファイル名（端末保存にも使う）
  const filename = `${uuid}.m4a`;

  // upload（失敗したらダウンロード救済）
  try {
    const json = await uploadAudio(uuid, blob, filename);
    return { uuid, audioPath: json.audio, mime: json.mime || AUDIO_MIME, status: 'success' };
  } catch (err) {
    console.error('Audio upload failed:', err);

    if (allowDownloadOnFail && blob && blob.size > 0) {
      return { uuid, audioBlob: blob, status: 'upload_error' };
    } else {
      return {status: 'error'};
    }
  }
}

// function enableLocalAudioFallback() {
//     const picker = document.getElementById('localAudioPicker');
//     const input = document.getElementById('audio-file-input');
//     const audio = document.getElementById('audioPlayer');
//     if (!picker || !input || !audio) return;

//     picker.style.display = '';

//     input.onchange = () => {
//         const file = input.files?.[0];
//         if (!file) return;

//         // 以前の objectURL を解放
//         if (audio.dataset.objectUrl) URL.revokeObjectURL(audio.dataset.objectUrl);

//         const url = URL.createObjectURL(file);
//         audio.dataset.objectUrl = url;
//         audio.src = url;
//         audio.load();

//         // ローカル音声でも同期は動く
//         attachAudioSync(audio);
//         setHidden('localAudioPicker', true);
//     };
// }

export async function stopRecordingLocalOnly() {
  dbg('---- stopRecordingLocalOnly called ----');

  if (!mediaRecorder || !appState.isRecording) {
    dbg('mediaRecorder or isRecording missing');
    return null;
  }

  const uuid = currentUuid;
  dbg('current uuid', uuid);
  dbg('AUDIO_MIME', AUDIO_MIME);
  dbg('mediaRecorder.state before stop', mediaRecorder.state);

  const waitStop = new Promise((resolve) => {
    mediaRecorder.addEventListener('stop', () => {
      dbg('event: stop fired');
      resolve();
    }, { once: true });
  });

  const onData = (e) => {
    dbg('event: dataavailable size=', e?.data?.size, 'type=', e?.data?.type);
    if (e?.data && e.data.size > 0) {
      audioChunks.push(e.data);
      dbg('audioChunks length now', audioChunks.length);
    } else {
      dbg('dataavailable had 0 bytes');
    }
  };

  mediaRecorder.addEventListener('dataavailable', onData);

  try {
    mediaRecorder.requestData?.();
    dbg('requestData() called');
  } catch (e) {
    dbg('requestData error', e);
  }

  try {
    mediaRecorder.stop();
    dbg('stop() called');
  } catch (e) {
    dbg('stop error', e);
  }

  await waitStop;

  // iOSでdataavailableがstop後に来ることがある
  await new Promise(r => setTimeout(r, 0));

  mediaRecorder.removeEventListener('dataavailable', onData);

  dbg('audioChunks count', audioChunks.length);
  dbg('audioChunks sizes', audioChunks.map(c => c.size));

  const blob = new Blob(audioChunks, { type: AUDIO_MIME });

  dbg('FINAL blob.size', blob.size);
  dbg('FINAL blob.type', blob.type);

  audioChunks = [];
  appState.isRecording = false;

  dbg('---- stopRecordingLocalOnly finished ----');

  return { uuid, blob, mime: AUDIO_MIME };
}

export async function setAudioSourceOrFallback(audioUrl) {
    const audio = document.getElementById('audioPlayer');
    if (!audio) return;

    // まずサーバ音声を試す
    if (audioUrl) {
        audio.src = audioUrl;
        audio.load();

        // サーバに無い/403/壊れてる等は error イベントで拾える
        const ok = await new Promise((resolve) => {
            const onCanPlay = () => cleanup(true);
            const onErr = () => cleanup(false);

            const cleanup = (v) => {
                audio.removeEventListener('canplaythrough', onCanPlay);
                audio.removeEventListener('error', onErr);
                resolve(v);
            };

            audio.addEventListener('canplaythrough', onCanPlay, { once: true });
            audio.addEventListener('error', onErr, { once: true });

            // iOSで canplaythrough が来ないことがあるので保険（2秒）
            setTimeout(() => cleanup(true), 2000);
        });

        if (ok) {
            attachAudioSync(audio);
            return;
        }
    }

    // だめならローカルファイル選択へ
    // enableLocalAudioFallback();
}

// ================================
// Recording indicator + timer (30min) + playback rate buttons
// ================================
const REC_MAX_MS = 30 * 60 * 1000;

let recTimerId = null;
export let recStartMs = null;

let recAudioCtx = null;
let recAnalyser = null;
let recWave = null;
let recLevelRaf = null;

// mm:ss
function fmtMs(ms){
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s/60)).padStart(2,'0');
  const ss = String(s%60).padStart(2,'0');
  return `${mm}:${ss}`;
}

export function startRecUI(stream, onAutoStop){
  const ind = document.getElementById('recIndicator');
  const t = document.getElementById('recTimer');
  const level = document.getElementById('recLevel');

  if (!ind || !t || !level) return;

  ind.classList.remove('hidden');
  t.classList.remove('hidden');
  recStartMs = Date.now();
  t.textContent = "00:00";

  clearInterval(recTimerId);
  recTimerId = setInterval(() => {
    // 録音経過は一時停止分を除いた値（タイムライン時計と一致）。開始直後は0。
    const elapsed = getRecordingMs() || (Date.now() - recStartMs);
    t.textContent = fmtMs(elapsed);

    if (elapsed >= REC_MAX_MS) {
      stopRecUI();
      if (typeof onAutoStop === 'function') onAutoStop();
    }
  }, 250);

  // Audio level meter
  try{
    recAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = recAudioCtx.createMediaStreamSource(stream);
    recAnalyser = recAudioCtx.createAnalyser();
    recAnalyser.fftSize = 2048;
    recWave = new Uint8Array(recAnalyser.fftSize);
    src.connect(recAnalyser);

    const tick = () => {
      if (!recAnalyser) return;
      recAnalyser.getByteTimeDomainData(recWave);

      let sum = 0;
      for (let i=0;i<recWave.length;i++){
        const v = (recWave[i] - 128) / 128;
        sum += v*v;
      }
      const rms = Math.sqrt(sum / recWave.length); // 0..1
      const pct = Math.min(100, Math.round(rms * 180)); // 感度増幅
      level.style.setProperty('--level', `${pct}%`);

      recLevelRaf = requestAnimationFrame(tick);
    };
    tick();
  } catch(e){
    console.warn("Audio level indicator unavailable:", e);
    level.style.setProperty('--level', `0%`);
  }
}

export function stopRecUI(){
  const ind = document.getElementById('recIndicator');
  const t = document.getElementById('recTimer');
  const level = document.getElementById('recLevel');

  if (ind) {
    ind.classList.add('hidden');
    ind.classList.remove('blink');
  }
  if (t) t.classList.add('hidden');

  clearInterval(recTimerId);
  recTimerId = null;
  recStartMs = null;

  if (recLevelRaf) cancelAnimationFrame(recLevelRaf);
  recLevelRaf = null;

  if (level) level.style.setProperty('--level', `0%`);

  try { if (recAudioCtx) recAudioCtx.close(); } catch(_){}
  recAudioCtx = null;
  recAnalyser = null;
  recWave = null;
}