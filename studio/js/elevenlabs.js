// ElevenLabs client for real neural voice cloning (Instant Voice Cloning) and
// speech in the cloned voice. Called straight from the browser with the
// account's own API key (Dashboard → Account), so it works on a static host.

import { getSettings } from './store.js';

const BASE = 'https://api.elevenlabs.io';
export const MAX_SCRIPT_CHARS = 5000;

const key = () => getSettings().elevenKey.trim();
export const isConfigured = () => !!key();

async function call(path, { method = 'GET', body, json, accept } = {}) {
  const headers = { 'xi-api-key': key() };
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (accept) headers.Accept = accept;
  let res;
  try {
    res = await fetch(BASE + path, { method, body, headers });
  } catch {
    throw new Error('Couldn\'t reach ElevenLabs. Check your connection and try again.');
  }
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = typeof j.detail === 'string' ? j.detail : j.detail?.message || j.detail?.status || '';
    } catch { /* not json */ }
    if (res.status === 401) throw new Error('ElevenLabs rejected the API key. Check it in Dashboard → Account.');
    if (res.status === 402 || /subscription|upgrade|instant voice cloning/i.test(detail)) {
      throw new Error(`Your ElevenLabs plan doesn't allow this${detail ? `: ${detail}` : ''}. Instant voice cloning needs the Starter plan or higher.`);
    }
    if (res.status === 429) throw new Error('ElevenLabs is busy or your quota is used up. Try again in a minute.');
    throw new Error(detail || `ElevenLabs error ${res.status}`);
  }
  return res;
}

/** Plan details, including whether instant voice cloning is allowed. */
export async function subscription() {
  return (await call('/v1/user/subscription')).json();
}

/**
 * Creates an instant voice clone from one or more audio files.
 * Returns { voiceId, requiresVerification }.
 */
export async function cloneVoice(files, { name, description = '', removeNoise = false, labels = {} } = {}) {
  const fd = new FormData();
  fd.append('name', name || 'My voice');
  if (description) fd.append('description', description);
  fd.append('remove_background_noise', String(removeNoise));
  fd.append('labels', JSON.stringify(labels));
  files.forEach((f, i) => fd.append('files', f, f.name || `sample-${i + 1}.${(f.type.split('/')[1] || 'webm').split(';')[0]}`));
  const j = await (await call('/v1/voices/add', { method: 'POST', body: fd })).json();
  return { voiceId: j.voice_id, requiresVerification: !!j.requires_verification };
}

export async function deleteVoice(voiceId) {
  await call(`/v1/voices/${encodeURIComponent(voiceId)}`, { method: 'DELETE' });
}

// Emotion and tone become ElevenLabs voice settings. Lower stability and higher
// style make delivery more expressive; higher stability makes it even and calm.
const EMOTION_SETTINGS = {
  neutral: { stability: 0.5, style: 0.0 },
  happy: { stability: 0.4, style: 0.35 },
  excited: { stability: 0.3, style: 0.6 },
  calm: { stability: 0.75, style: 0.05 },
  serious: { stability: 0.65, style: 0.15 },
  sad: { stability: 0.45, style: 0.4 },
};
const TONE_SETTINGS = {
  natural: { similarity: 0.8, style: 0 },
  warm: { similarity: 0.85, style: 0.05 },
  bright: { similarity: 0.75, style: 0.12 },
  deep: { similarity: 0.9, style: -0.05 },
};
// eleven_v3 understands inline audio tags, which steer emotion far more directly.
const V3_TAGS = { happy: '[happy]', excited: '[excited]', calm: '[calm]', serious: '[serious]', sad: '[sad]' };

export function voiceSettings({ speed = 1, emotion = 'neutral', tone = 'natural' } = {}) {
  const e = EMOTION_SETTINGS[emotion] || EMOTION_SETTINGS.neutral;
  const t = TONE_SETTINGS[tone] || TONE_SETTINGS.natural;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  return {
    stability: e.stability,
    similarity_boost: t.similarity,
    style: clamp(e.style + t.style, 0, 1),
    use_speaker_boost: true,
    speed: clamp(speed, 0.7, 1.2),
  };
}

/** Speech in the cloned voice as an MP3 Blob. */
export async function speak(voiceId, text, opts = {}) {
  if (text.length > MAX_SCRIPT_CHARS) throw new Error(`Scripts can be up to ${MAX_SCRIPT_CHARS.toLocaleString()} characters.`);
  const model = getSettings().elevenModel || 'eleven_multilingual_v2';
  const tag = model === 'eleven_v3' && V3_TAGS[opts.emotion];
  const res = await call(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    accept: 'audio/mpeg',
    json: { text: tag ? `${tag} ${text}` : text, model_id: model, voice_settings: voiceSettings(opts) },
  });
  return res.blob();
}
