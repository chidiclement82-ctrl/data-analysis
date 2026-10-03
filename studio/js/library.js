// Shared actions for the user's media library: adding faces and source videos
// (always behind the consent gate), and pickers used by the wizard and tools.

import { h, icon, toast, loadImage, loadVideo, seek, fmtTime, fmtDate } from './ui.js';
import { put, get, all, uid, blobUrl } from './store.js';
import { requestConsent, isProtectedName } from './safety.js';
import { prepareSourceFace } from './faceswap.js';

const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 5 * 60;

export async function addFace(file, name = '') {
  if (!file.type.startsWith('image/')) { toast('Please choose an image (JPG, PNG or WebP).', 'error'); return null; }
  const label = name || file.name.replace(/\.[^.]+$/, '');
  const consent = await requestConsent('face', file, { suggestedLabel: isProtectedName(label) ? label : '' });
  if (!consent) return null;
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const prepared = await prepareSourceFace(img);
    const thumb = await new Promise(r => prepared.crop.toBlob(r, 'image/jpeg', 0.9));
    const rec = await put('faces', {
      id: uid('face'),
      name: consent.relation === 'self' ? `${consent.subjectName.split(' ')[0]} (me)` : consent.subjectName,
      blob: file,
      thumb,
      detected: prepared.detected,
      consentId: consent.id,
      subject: consent.subjectName,
    });
    faceCache.set(rec.id, prepared);
    toast(prepared.detected ? 'Face saved. We found and cropped your face.' : 'Saved. No face was detected automatically, so we used the center of the photo. A clear, front-facing photo works best.', prepared.detected ? 'success' : 'info');
    return rec;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const faceCache = new Map();
export async function preparedFace(faceId) {
  if (faceCache.has(faceId)) return faceCache.get(faceId);
  const face = await get('faces', faceId);
  if (!face) return null;
  const url = URL.createObjectURL(face.blob);
  try {
    const prepared = await prepareSourceFace(await loadImage(url));
    faceCache.set(faceId, prepared);
    return prepared;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function addSourceVideo(file) {
  if (!file.type.startsWith('video/')) { toast('Please choose a video file (MP4, MOV or WebM).', 'error'); return null; }
  if (file.size > MAX_VIDEO_BYTES) { toast('That video is over 500 MB. Trim it or export a smaller copy first.', 'error'); return null; }
  const url = URL.createObjectURL(file);
  let meta;
  try {
    const v = await loadVideo(url);
    if (v.duration > MAX_VIDEO_SECONDS) { toast('Videos can be up to 5 minutes long.', 'error'); return null; }
    await seek(v, Math.min(1, v.duration / 3));
    const c = document.createElement('canvas');
    c.width = 480; c.height = Math.round(480 * v.videoHeight / v.videoWidth);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    meta = { duration: v.duration, width: v.videoWidth, height: v.videoHeight, thumb: c.toDataURL('image/jpeg', 0.8) };
  } catch (e) {
    toast(e.message, 'error');
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
  const consent = await requestConsent('video', file);
  if (!consent) return null;
  return put('videos', { id: uid('vid'), kind: 'source', name: file.name, blob: file, consentId: consent.id, ...meta });
}

export function faceTile(face, { selected, onSelect, actions } = {}) {
  return h('div', { class: `tile${onSelect ? ' selectable' : ''}${selected ? ' selected' : ''}`, role: onSelect ? 'button' : null, tabindex: onSelect ? '0' : null,
    onclick: onSelect ? () => onSelect(face) : null,
    onkeydown: onSelect ? (e) => { if (e.key === 'Enter') onSelect(face); } : null },
    h('span', { class: 'check-mark' }, icon('check', 14)),
    h('div', { class: 'media' }, h('img', { src: blobUrl(face.id + ':thumb', face.thumb || face.blob), alt: face.name })),
    h('div', { class: 'body' },
      h('span', { class: 'title' }, face.name),
      h('span', { class: 'row small muted' }, h('span', { class: 'badge ok' }, icon('shield', 12), 'Consent on file'))),
    actions && h('div', { class: 'actions' }, actions));
}

export function videoTile(video, { selected, onSelect, actions } = {}) {
  return h('div', { class: `tile${onSelect ? ' selectable' : ''}${selected ? ' selected' : ''}`, role: onSelect ? 'button' : null, tabindex: onSelect ? '0' : null,
    onclick: onSelect ? () => onSelect(video) : null,
    onkeydown: onSelect ? (e) => { if (e.key === 'Enter') onSelect(video); } : null },
    h('span', { class: 'check-mark' }, icon('check', 14)),
    h('div', { class: 'media wide' }, video.thumb ? h('img', { src: video.thumb, alt: '' }) : icon('film', 28)),
    h('div', { class: 'body' },
      h('span', { class: 'title', title: video.name }, video.name),
      h('span', { class: 'small muted' }, `${fmtTime(video.duration)} · ${video.width}×${video.height} · ${fmtDate(video.createdAt)}`),
      video.kind === 'generated' && h('span', {}, h('span', { class: 'badge ai' }, icon('sparkle', 12), 'AI-generated · ' + video.contentId))),
    actions && h('div', { class: 'actions' }, actions));
}

export async function sourceVideos() { return (await all('videos')).filter(v => v.kind === 'source'); }
