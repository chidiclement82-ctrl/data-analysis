// Voice engine: recording, waveform analysis, the local voice profile, and speech.
//
// Locally, a "voice model" is a profile measured from the sample (pitch, pace,
// brightness) that steers the browser's speech engine for instant previews.
// Neural cloning that sounds like the speaker runs on the cloud provider; its
// audio is returned as a file and can be mixed into videos.

import { api } from './api.js';

export const EMOTIONS = {
  neutral: { label: 'Neutral', pitch: 0, rate: 0 },
  happy: { label: 'Happy', pitch: 0.15, rate: 0.08 },
  excited: { label: 'Excited', pitch: 0.25, rate: 0.15 },
  calm: { label: 'Calm', pitch: -0.05, rate: -0.12 },
  serious: { label: 'Serious', pitch: -0.15, rate: -0.05 },
  sad: { label: 'Sad', pitch: -0.2, rate: -0.18 },
};

export const TONES = {
  natural: { label: 'Natural', pitch: 0 },
  warm: { label: 'Warm', pitch: -0.08 },
  bright: { label: 'Bright', pitch: 0.12 },
  deep: { label: 'Deep', pitch: -0.2 },
};

export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported?.(m)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const ac = new AudioContext();
  const analyser = ac.createAnalyser();
  analyser.fftSize = 1024;
  ac.createMediaStreamSource(stream).connect(analyser);
  rec.start(250);
  const started = Date.now();
  return {
    analyser,
    elapsed: () => (Date.now() - started) / 1000,
    stop: () => new Promise(resolve => {
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        ac.close();
        resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      };
      rec.stop();
    }),
    cancel: () => { try { rec.stop(); } catch { /* already stopped */ } stream.getTracks().forEach(t => t.stop()); ac.close(); },
  };
}

export async function decode(blob) {
  const ac = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100);
  return ac.decodeAudioData(await blob.arrayBuffer());
}

/** Downsampled peaks for drawing a waveform. */
export function peaks(buffer, n = 120) {
  const d = buffer.getChannelData(0);
  const size = Math.floor(d.length / n) || 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * size; j < Math.min(d.length, (i + 1) * size); j += 4) m = Math.max(m, Math.abs(d[j]));
    out.push(m);
  }
  const max = Math.max(...out, 0.01);
  return out.map(v => v / max);
}

export function drawWave(canvas, values, progress = 0) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300, hgt = canvas.clientHeight || 56;
  canvas.width = w * dpr; canvas.height = hgt * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, hgt);
  const bw = w / values.length;
  const css = getComputedStyle(document.documentElement);
  values.forEach((v, i) => {
    const bh = Math.max(2, v * (hgt - 6));
    ctx.fillStyle = i / values.length < progress ? css.getPropertyValue('--accent').trim() || '#8b7bff' : css.getPropertyValue('--wave').trim() || '#4a4a66';
    ctx.beginPath();
    ctx.roundRect(i * bw + 1, (hgt - bh) / 2, Math.max(1, bw - 2), bh, 1.5);
    ctx.fill();
  });
}

/**
 * Measures the speaker's median pitch (autocorrelation over voiced frames),
 * speaking pace (energy bursts per second), brightness and sample quality.
 */
export function analyzeVoice(buffer) {
  const sr = buffer.sampleRate;
  const d = buffer.getChannelData(0);
  const frame = Math.floor(sr * 0.04);
  const pitches = [];
  let voiced = 0, frames = 0, bursts = 0, wasLoud = false, zc = 0, peak = 0, energySum = 0;
  for (let start = 0; start + frame < d.length; start += frame) {
    frames++;
    let e = 0;
    for (let i = start; i < start + frame; i++) { e += d[i] * d[i]; peak = Math.max(peak, Math.abs(d[i])); if (i > start && (d[i] > 0) !== (d[i - 1] > 0)) zc++; }
    e = Math.sqrt(e / frame);
    energySum += e;
    const loud = e > 0.02;
    if (loud && !wasLoud) bursts++;
    wasLoud = loud;
    if (!loud) continue;
    voiced++;
    // Autocorrelation pitch for 70–400 Hz.
    const minLag = Math.floor(sr / 400), maxLag = Math.floor(sr / 70);
    let best = 0, bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0;
      for (let i = start; i < start + frame - lag; i += 2) s += d[i] * d[i + lag];
      if (s > best) { best = s; bestLag = lag; }
    }
    if (bestLag) pitches.push(sr / bestLag);
  }
  pitches.sort((a, b) => a - b);
  const f0 = pitches.length ? pitches[Math.floor(pitches.length / 2)] : 150;
  const duration = d.length / sr;
  const voicedSec = voiced * 0.04;
  const quality = voicedSec < 8 ? 'short' : peak > 0.98 ? 'clipping' : energySum / frames < 0.01 ? 'quiet' : 'good';
  return {
    f0: Math.round(f0),
    pace: +(bursts / Math.max(1, voicedSec)).toFixed(2),
    brightness: +(zc / d.length * sr / 1000).toFixed(2),
    duration: +duration.toFixed(1),
    voicedSeconds: +voicedSec.toFixed(1),
    quality,
  };
}

export function browserVoices() {
  return new Promise(resolve => {
    const v = speechSynthesis.getVoices();
    if (v.length) return resolve(v);
    speechSynthesis.onvoiceschanged = () => resolve(speechSynthesis.getVoices());
    setTimeout(() => resolve(speechSynthesis.getVoices()), 1200);
  });
}

// Maps the speaker's measured profile + chosen emotion/tone to speech engine settings.
export function speechParams(profile, { speed = 1, emotion = 'neutral', tone = 'natural' } = {}) {
  const e = EMOTIONS[emotion] || EMOTIONS.neutral;
  const t = TONES[tone] || TONES.natural;
  const basePitch = profile ? Math.min(1.6, Math.max(0.5, 1 + (profile.f0 - 165) / 220)) : 1;
  return {
    pitch: Math.min(2, Math.max(0, basePitch + e.pitch + t.pitch)),
    rate: Math.min(2.5, Math.max(0.4, speed * (1 + e.rate))),
  };
}

/** Speaks text with the browser engine using the voice profile. Returns a handle with stop(). */
export async function speakPreview(voice, text, opts = {}, { onEnd, onBoundary } = {}) {
  speechSynthesis.cancel();
  const voices = await browserVoices();
  const u = new SpeechSynthesisUtterance(text);
  const p = speechParams(voice?.profile, opts);
  u.pitch = p.pitch;
  u.rate = p.rate;
  const preferred = voices.find(v => v.voiceURI === voice?.browserVoice) || voices.find(v => v.default) || voices[0];
  if (preferred) { u.voice = preferred; u.lang = preferred.lang; }
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  u.onboundary = (e) => onBoundary?.(e.charIndex);
  speechSynthesis.speak(u);
  return { stop: () => speechSynthesis.cancel() };
}

/**
 * Generates speech audio. In cloud mode returns { blob } from the neural voice.
 * Locally returns { preview: true }: the text is spoken live but no file exists.
 */
export async function generateSpeech(voice, text, opts) {
  const blob = await api.synthesize(voice, text, opts);
  return blob ? { blob } : { preview: true };
}

/** Rough narration length for timing subtitles when there's no audio file. */
export function estimateSpeechSeconds(text, speed = 1) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words / (2.6 * speed) + 0.4;
}

// ---------- Voice samples from a video ----------

/** Decodes a video's soundtrack. Throws a friendly error when there's no usable audio. */
export async function audioFromVideo(file) {
  let buf;
  try { buf = await decode(file); } catch { throw new Error('We couldn\'t read any audio from this video. Try an MP4 or WebM with sound.'); }
  if (!buf.duration || buf.duration < 3) throw new Error('This video has no audio track, or it\'s too short.');
  return buf;
}

/** Start time of the `seconds`-long window with the most speech-like (voiced) audio. */
export function bestSpeechWindow(buffer, seconds) {
  if (buffer.duration <= seconds) return 0;
  const sr = buffer.sampleRate;
  const d = buffer.getChannelData(0);
  const hop = Math.floor(sr * 0.25);
  const voiced = [];
  for (let s = 0; s + hop <= d.length; s += hop) {
    let e = 0;
    for (let i = s; i < s + hop; i += 4) e += d[i] * d[i];
    voiced.push(Math.sqrt(e / (hop / 4)) > 0.02 ? 1 : 0);
  }
  const win = Math.floor(seconds / 0.25);
  let sum = voiced.slice(0, win).reduce((a, b) => a + b, 0), best = sum, bestAt = 0;
  for (let i = win; i < voiced.length; i++) {
    sum += voiced[i] - voiced[i - win];
    if (sum > best) { best = sum; bestAt = i - win + 1; }
  }
  return bestAt * 0.25;
}

/** Cuts [start, end) from a buffer, mixes to mono, resamples, normalizes, and returns a WAV File. */
export async function encodeWavSegment(buffer, start, end, { rate = 22050, name = 'voice-sample.wav' } = {}) {
  const dur = Math.max(0.5, end - start);
  const off = new OfflineAudioContext(1, Math.ceil(dur * rate), rate);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start(0, start, dur);
  const pcm = (await off.startRendering()).getChannelData(0);
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  const gain = peak > 0 ? Math.min(4, 0.89 / peak) : 1; // normalize to about -1 dBFS
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i] * gain)) * 0x7fff, true);
  return new File([out.buffer], name, { type: 'audio/wav' });
}
