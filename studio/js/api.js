// Provider layer.
// - Face swap: with no server URL configured, the in-browser engine makes an
//   instant overlay preview. With one, the generative swap (InsightFace
//   inswapper) runs on the Visage face swap server in /studio-server.
// - Voice: ElevenLabs when an API key is set, otherwise a browser preview voice.
// The REST contract is documented in studio/README.md.

import { getSettings } from './store.js';
import * as eleven from './elevenlabs.js';

const base = () => getSettings().apiBase.trim().replace(/\/+$/, '');

async function request(path, { method = 'GET', body, json, signal } = {}) {
  const headers = {};
  const token = getSettings().apiToken?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  let res;
  try {
    res = await fetch(base() + path, { method, body, headers, signal, credentials: 'omit' });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('Couldn\'t reach the face swap server. Check the URL in Dashboard → Account, and that the server is running.');
  }
  if (!res.ok) {
    let msg = `Server error ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* not json */ }
    if (res.status === 401) msg = 'The face swap server needs an access token. Add it in Dashboard → Account.';
    throw new Error(msg);
  }
  const type = res.headers.get('Content-Type') || '';
  return type.includes('application/json') ? res.json() : res.blob();
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Cancelled', 'AbortError')); }, { once: true });
});

async function pollJob(id, onProgress, signal) {
  for (;;) {
    const job = await request(`/v1/jobs/${encodeURIComponent(id)}`, { signal });
    const stage = job.status === 'queued' ? `Waiting in line (${job.position || 1} ahead)` : job.stage;
    onProgress?.(job.progress ?? 0, stage);
    if (job.status === 'succeeded') return job;
    if (job.status === 'failed') throw new Error(job.error || 'The face swap failed.');
    await sleep(1500, signal);
  }
}

function extFor(blob, fallback) {
  const t = (blob.type || '').split(';')[0];
  return { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[t] || fallback;
}

let healthCache = null;

export const api = {
  // 'cloud' when a face swap server is configured, otherwise 'local'.
  get mode() { return base() ? 'cloud' : 'local'; },

  async health({ fresh = false } = {}) {
    if (!base()) return { ok: true, mode: 'local' };
    if (!fresh && healthCache && healthCache.base === base() && Date.now() - healthCache.at < 30_000) return healthCache.value;
    const value = await request('/v1/health');
    healthCache = { base: base(), at: Date.now(), value };
    return value;
  },

  // Checks the access token against the server.
  async checkAuth() { return request('/v1/auth'); },

  // Server-side screen for face photos: rejects photos without a face and faces
  // that match the server's protected-people gallery.
  async screenIdentity(kind, file) {
    if (!base() || kind !== 'face' || !file) return { allowed: true };
    const fd = new FormData();
    fd.append('kind', kind);
    fd.append('file', file, `face.${extFor(file, 'jpg')}`);
    return request('/v1/safety/screen', { method: 'POST', body: fd });
  },

  async submitReport(report) {
    if (!base()) return { ok: true };
    return request('/v1/reports', { method: 'POST', json: report });
  },

  // Which engine clones voices.
  get voiceProvider() { return eleven.isConfigured() ? 'elevenlabs' : 'local'; },

  // Returns { voiceId, provider } with ElevenLabs, or null (preview voice only).
  async cloneVoice(samples, { name, consentId, removeNoise = false, description = '' }) {
    if (!eleven.isConfigured()) return null;
    const r = await eleven.cloneVoice(samples, { name, description, removeNoise, labels: { source: 'visage-studio', consent: consentId } });
    return { ...r, provider: 'elevenlabs' };
  },

  async deleteVoice(voice) {
    if (voice.remoteId && voice.provider === 'elevenlabs' && eleven.isConfigured()) return eleven.deleteVoice(voice.remoteId);
  },

  // Returns an audio Blob from the cloned voice, or null when only the browser preview voice is available.
  async synthesize(voice, text, { speed = 1, emotion = 'neutral', tone = 'natural' } = {}) {
    if (!voice.remoteId) return null;
    if (!eleven.isConfigured()) throw new Error('Add your ElevenLabs API key in Dashboard → Account to use this voice.');
    return eleven.speak(voice.remoteId, text, { speed, emotion, tone });
  },

  /**
   * Generative face swap on the server. Resolves with the swapped MP4 Blob.
   * onProgress(fraction, stage) covers upload, queue and processing.
   */
  async faceSwapVideo(video, face, { signal, onProgress, duration } = {}) {
    if (!base()) throw new Error('No face swap server is connected.');
    const h = await this.health();
    if (!h.ready) throw new Error(h.loading ? 'The face swap server is still starting up. Try again in a minute.' : `The face swap server isn't ready: ${h.error || 'models not loaded'}`);
    if (duration && h.maxSeconds && duration > h.maxSeconds + 0.5) {
      throw new Error(`This server swaps videos up to ${Math.floor(h.maxSeconds)} seconds long. Upload a shorter clip.`);
    }
    onProgress?.(0, 'Uploading');
    const fd = new FormData();
    fd.append('video', video, `source.${extFor(video, 'mp4')}`);
    fd.append('face', face, `face.${extFor(face, 'jpg')}`);
    fd.append('preserveExpressions', 'true');
    const { jobId } = await request('/v1/face-swap', { method: 'POST', body: fd, signal });
    const job = await pollJob(jobId, onProgress, signal);
    onProgress?.(1, 'Downloading result');
    return request(job.resultPath, { signal });
  },
};
