// silenceHandler.js
// 録音音声を WebAudio でデコードし、短時間エネルギーから「喋っている区間」を検出する。
// 再生中、無音の谷に来たら次の発話へ currentTime をジャンプして無駄な間を飛ばす。
// 既存の録音にもそのまま効く（サーバ側の事前処理は不要）。
import { appState } from './appState.js';

// --- 解析パラメータ ---
const FRAME_SEC   = 0.03;   // 30ms フレームでエネルギー算出
const HANG_SEC    = 0.30;   // 発話終わりの余韻（切れすぎ防止）
const MERGE_GAP   = 0.60;   // これ未満の谷は同じ発話として連結
const MIN_SKIP_SEC= 0.80;   // これ以上の無音だけスキップ対象にする
const LEAD_SEC    = 0.15;   // 発話頭を少し残して着地（頭切れ防止）

let speechSegments = [];    // [{start,end}] 秒・昇順
let enabled = true;
let tickTimer = null;

export function isSkipEnabled(){ return enabled; }
export function setSkipEnabled(v){
  enabled = !!v;
  localStorage.setItem('skipSilence', enabled ? '1' : '0');
}
export function loadSkipSetting(){
  const s = localStorage.getItem('skipSilence');
  enabled = (s === null) ? true : (s === '1');   // 既定 ON
  return enabled;
}

// 音声URL(またはBlob URL)を解析して発話区間を求める。失敗しても再生は続行。
export async function loadSilenceProfile(audioUrl){
  speechSegments = [];
  if (!audioUrl) return;
  try {
    const res = await fetch(audioUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const arr = await res.arrayBuffer();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const audioBuf = await ctx.decodeAudioData(arr);
    speechSegments = computeSpeechSegments(audioBuf);
    try { ctx.close(); } catch {}
  } catch (e) {
    console.warn('無音解析に失敗（スキップ無効で続行）:', e);
    speechSegments = [];
  }
}

function computeSpeechSegments(audioBuf){
  const ch = audioBuf.getChannelData(0);
  const sr = audioBuf.sampleRate;
  const frame = Math.max(1, Math.floor(sr * FRAME_SEC));
  const nFrames = Math.floor(ch.length / frame);
  if (nFrames < 2) return [];

  // フレームRMS
  const energies = new Float32Array(nFrames);
  for (let i = 0; i < nFrames; i++){
    let s = 0; const off = i * frame;
    for (let j = 0; j < frame; j++){ const v = ch[off + j]; s += v * v; }
    energies[i] = Math.sqrt(s / frame);
  }

  // 適応しきい値：ノイズ床(下位20%)とピーク(上位5%)から決める
  const sorted = Float32Array.from(energies).sort();
  const floor = sorted[Math.floor(sorted.length * 0.20)] || 0;
  const peak  = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const thr = Math.max(floor * 2.5, peak * 0.06, 0.005);

  const segs = [];
  let inSpeech = false, segStart = 0, lastVoiced = 0;
  for (let i = 0; i < nFrames; i++){
    const t = i * FRAME_SEC;
    const voiced = energies[i] >= thr;
    if (voiced){
      if (!inSpeech){ inSpeech = true; segStart = t; }
      lastVoiced = t;
    } else if (inSpeech && (t - lastVoiced) > HANG_SEC){
      inSpeech = false;
      segs.push({ start: Math.max(0, segStart - LEAD_SEC), end: lastVoiced + HANG_SEC });
    }
  }
  if (inSpeech) segs.push({ start: Math.max(0, segStart - LEAD_SEC), end: nFrames * FRAME_SEC });

  // 近接する区間を連結（MERGE_GAP 未満の谷は無視）
  const merged = [];
  for (const s of segs){
    const last = merged[merged.length - 1];
    if (last && s.start - last.end < MERGE_GAP) last.end = s.end;
    else merged.push({ ...s });
  }
  return merged;
}

// 再生中に無音の谷を飛ばす。audioEl は <audio>。
export function attachSilenceSkip(audioEl){
  if (!audioEl) return;
  detachSilenceSkip(audioEl);

  const maybeSkip = () => {
    if (!enabled || audioEl.paused || audioEl.ended) return;
    if (!speechSegments.length) return;
    const t = audioEl.currentTime;
    for (const seg of speechSegments){
      if (t < seg.start){
        // 発話前の無音。十分長ければ次の発話頭へジャンプ。
        if (seg.start - t >= MIN_SKIP_SEC){
          audioEl.currentTime = Math.max(0, seg.start - LEAD_SEC);
        }
        return;
      }
      if (t <= seg.end) return;   // 発話中：そのまま
    }
    // 最後の発話より後（末尾の無音）：終わりへ送って再生を締める
    if (isFinite(audioEl.duration) && audioEl.duration - t >= MIN_SKIP_SEC){
      audioEl.currentTime = audioEl.duration;
    }
  };

  const onPlay = () => { clearInterval(tickTimer); tickTimer = setInterval(maybeSkip, 100); maybeSkip(); };
  const onStop = () => { clearInterval(tickTimer); tickTimer = null; };

  audioEl.__silenceHandlers = { onPlay, onStop };
  audioEl.addEventListener('play', onPlay);
  audioEl.addEventListener('pause', onStop);
  audioEl.addEventListener('ended', onStop);

  if (!audioEl.paused) onPlay();
}

export function detachSilenceSkip(audioEl){
  if (!audioEl) return;
  const h = audioEl.__silenceHandlers;
  if (h){
    audioEl.removeEventListener('play', h.onPlay);
    audioEl.removeEventListener('pause', h.onStop);
    audioEl.removeEventListener('ended', h.onStop);
    delete audioEl.__silenceHandlers;
  }
  clearInterval(tickTimer);
  tickTimer = null;
}

// トグルUI（閲覧ページ）
export function bindSkipSilenceUI(){
  const btn = document.getElementById('skipSilence');
  if (!btn) return;
  const reflect = () => btn.classList.toggle('active', enabled);
  reflect();
  btn.addEventListener('click', () => { setSkipEnabled(!enabled); reflect(); });
}
