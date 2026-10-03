// Quick face swap: pick a face + a video, see the before/after, export.

import { h, icon, dropzone, loadVideo, modal } from '../ui.js';
import { all, get, blobUrl } from '../store.js';
import { addFace, addSourceVideo, faceTile, videoTile, sourceVideos } from '../library.js';
import { createProject, saveProject, runCloudSwap } from '../projects.js';
import { api } from '../api.js';
import { analyzeVideo, getDetector } from '../faceswap.js';
import { mountEditor } from '../editor.js';
import { generateBlock, downloadButton } from '../exportui.js';

export async function renderFaceSwap(app, { params }) {
  let faceId = params.face || null;
  let videoId = params.video || null;
  let editor = null;
  let ctrl = null;

  const facesCol = h('div', { class: 'card' });
  const videosCol = h('div', { class: 'card' });
  const result = h('div', { style: { marginTop: '20px' } });
  const swapBtn = h('button', { class: 'btn primary lg' }, icon('face'), 'Swap face');

  async function drawPickers() {
    const faces = await all('faces');
    const videos = await sourceVideos();
    facesCol.replaceChildren(
      h('h3', {}, '1. Your face'),
      faces.length > 0 && h('div', { class: 'thumb-grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', marginBottom: '14px' } },
        faces.map(f => faceTile(f, { selected: f.id === faceId, onSelect: (x) => { faceId = x.id; drawPickers(); } }))),
      dropzone({ accept: 'image/*', label: 'Upload a selfie', hint: 'Front-facing, good light, nothing covering your face', onFile: async (f) => { const r = await addFace(f); if (r) { faceId = r.id; drawPickers(); } } }));
    videosCol.replaceChildren(
      h('h3', {}, '2. The video'),
      videos.length > 0 && h('div', { class: 'thumb-grid', style: { marginBottom: '14px' } },
        videos.map(v => videoTile(v, { selected: v.id === videoId, onSelect: (x) => { videoId = x.id; drawPickers(); } }))),
      dropzone({ accept: 'video/*', label: 'Upload a video', hint: 'One clear face works best · up to 5 minutes', onFile: async (f) => { const r = await addSourceVideo(f); if (r) { videoId = r.id; drawPickers(); } } }));
    swapBtn.disabled = !(faceId && videoId);
  }

  swapBtn.addEventListener('click', async () => {
    editor?.destroy(); editor = null;
    ctrl?.abort(); ctrl = new AbortController();
    swapBtn.disabled = true;
    const project = await createProject({ sourceVideoId: videoId, faceId, name: 'Face swap' });
    const src = await get('videos', videoId);
    const bar = h('i');
    const msg = h('span', { class: 'small muted' }, 'Loading face detector…');
    result.replaceChildren(h('div', { class: 'card' }, h('h3', {}, api.mode === 'cloud' ? 'AI face swap in progress…' : 'Swapping…'), h('div', { class: 'progress' }, bar), h('p', { class: 'row', style: { marginTop: '10px' } }, h('span', { class: 'spinner' }), msg)));
    try {
      project.edit.fadeIn = 0; project.edit.fadeOut = 0;
      if (api.mode === 'cloud') {
        // Real generative swap on the AI server.
        await runCloudSwap(project, { signal: ctrl.signal, onProgress: (p, s) => { bar.style.width = `${Math.round(p * 100)}%`; msg.textContent = `${s || 'Working'} · ${Math.round(p * 100)}%`; } });
      } else {
        const det = await getDetector();
        msg.textContent = det ? 'Detecting and tracking the face in every frame…' : 'Automatic detection isn\'t available here. You\'ll place the face by clicking on it.';
        const v = await loadVideo(blobUrl(src.id, src.blob));
        try {
          project.edit.faceSwap.track = await analyzeVideo(v, { fps: src.duration > 60 ? 5 : 8, signal: ctrl.signal, onProgress: p => { bar.style.width = `${p * 100}%`; } });
        } finally { v.removeAttribute('src'); v.load(); }
      }
      await saveProject(project);

      const holder = h('div');
      const exportBtn = h('button', { class: 'btn primary' }, icon('download'), 'Export');
      result.replaceChildren(
        h('div', { class: 'page-head' },
          h('div', {}, h('h2', { style: { margin: 0 } }, 'Before / after'), h('p', { class: 'muted small' }, api.mode === 'cloud' ? 'Drag across the video to compare. Press play to watch the AI swap in motion.' : 'Drag across the video to compare. Fine-tune the blend on the right.')),
          h('div', { class: 'row' }, h('a', { class: 'btn ghost', href: `#/editor/${project.id}` }, icon('scissors', 16), 'Open in full editor'), exportBtn)),
        holder);
      editor = await mountEditor(holder, project, { initialTab: 'face' });
      result.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const p = editor.player;
      if (project.cloudSwapVideoId || project.edit.faceSwap.track?.coverage > 0.15) { p.split = 0.5; p.draw(); }
      exportBtn.addEventListener('click', () => {
        editor.player?.pause();
        modal('Export face swap', (close) => {
          const res = h('div');
          return h('div', { class: 'stack' },
            generateBlock(project, { label: 'Render & export', onDone: (rec) => res.replaceChildren(h('div', { class: 'stack' },
              h('video', { src: URL.createObjectURL(rec.blob), controls: true, style: { width: '100%', borderRadius: '12px' } }),
              h('div', { class: 'row' }, downloadButton(rec), h('button', { class: 'btn ghost', onclick: () => close() }, 'Close')))) }),
            res);
        }, { wide: true });
      });
    } catch (e) {
      if (e.name !== 'AbortError') result.replaceChildren(h('div', { class: 'empty' }, h('h3', {}, 'Couldn\'t swap this video'), h('p', {}, e.message)));
      else result.replaceChildren();
    } finally {
      swapBtn.disabled = false;
    }
  });

  app.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'AI Face Swap'), h('p', { class: 'muted' }, 'Put your face into any video. Movement, head tilt, lighting and lip movement come from the original.')),
      api.mode !== 'cloud' && h('div', { class: 'notice warn', style: { flexBasis: '100%' } }, icon('sparkle'), h('span', {}, 'You\'re using the instant in-browser preview, which overlays your face. For the real AI swap, ', h('a', { href: '#/dashboard/account' }, 'connect a face swap server'), '.')),
      swapBtn),
    h('div', { class: 'grid-2' }, facesCol, videosCol),
    result));
  await drawPickers();
  return () => { ctrl?.abort(); editor?.destroy(); };
}
