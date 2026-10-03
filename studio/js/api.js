// Provider layer. With no API base URL configured, the studio runs on the local
// in-browser engines (instant previews, no uploads leave the device). With one,
// heavy AI work (generative face swap, neural voice cloning and speech) runs on
// your backend through the REST contract documented in studio/README.md.

import { getSettings } from './store.js';

const base = () => getSettings().apiBase.replace(/\/+$/, '');

async function request(path, { method = 'GET', body, json } = {}) {
  const headers = {};
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  const res = await fetch(base() + path, { method, body, headers, credentials: 'include' });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { msg = (await res.json()).error || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  const type = res.headers.get('Content-Type') || '';
  return type.includes('application/json') ? res.json() : res.blob();
}

async function pollJob(id, onProgress) {
  for (;;) {
    const job = await request(`/v1/jobs/${encodeURIComponent(id)}`);
    onProgress?.(job.progress ?? 0, job.stage);
    if (job.status === 'succeeded') return job;
    if (job.status === 'failed') throw new Error(job.error || 'Generation failed');
    await new Promise(r => setTimeout(r, 1500));
  }
}

export const api = {
  get mode() { return base() ? 'cloud' : 'local'; },

  async health() {
    if (!base()) return { ok: true, mode: 'local' };
    return request('/v1/health');
  },

  // Server-side identity screen: matches uploads against protected public figures
  // and checks voice samples for replay/synthetic spoofing.
  async screenIdentity(kind, file, subjectName) {
    if (!base()) return { allowed: true };
    const fd = new FormData();
    fd.append('kind', kind);
    fd.append('subjectName', subjectName || '');
    if (file) fd.append('file', file);
    return request('/v1/safety/screen', { method: 'POST', body: fd });
  },

  async submitReport(report) {
    if (!base()) return { ok: true };
    return request('/v1/reports', { method: 'POST', json: report });
  },

  // Returns { voiceId } in cloud mode. Locally, the caller keeps the analyzed profile.
  async cloneVoice(sample, { name, consentId }) {
    if (!base()) return null;
    const fd = new FormData();
    fd.append('sample', sample, 'sample.webm');
    fd.append('name', name);
    fd.append('consentId', consentId);
    return request('/v1/voices', { method: 'POST', body: fd });
  },

  // Returns an audio Blob in cloud mode, or null when only the browser preview voice is available.
  async synthesize(voice, text, { speed = 1, emotion = 'neutral', tone = 'natural' } = {}) {
    if (!base() || !voice.remoteId) return null;
    return request(`/v1/voices/${encodeURIComponent(voice.remoteId)}/speech`, {
      method: 'POST', json: { text, speed, emotion, tone },
    });
  },

  // Full-quality generative swap. Returns a video Blob, or null in local mode
  // (the editor then composites the swap live with the in-browser engine).
  async faceSwapVideo(video, face, { preserveExpressions = true } = {}, onProgress) {
    if (!base()) return null;
    const fd = new FormData();
    fd.append('video', video, 'source.mp4');
    fd.append('face', face, 'face.jpg');
    fd.append('preserveExpressions', String(preserveExpressions));
    const { jobId } = await request('/v1/face-swap', { method: 'POST', body: fd });
    const job = await pollJob(jobId, onProgress);
    return request(job.resultPath);
  },
};
