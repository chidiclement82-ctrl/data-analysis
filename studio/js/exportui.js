// Generate + download UI shared by the editor page and the wizard.

import { h, icon, toast, fmtBytes } from './ui.js';
import { getSettings } from './store.js';
import { generateProject, recordExport, downloadBlob, maxExportHeight } from './projects.js';

export function qualityPicker(initial = 720, onPick) {
  let value = Math.min(initial, maxExportHeight());
  const wrap = h('div', { class: 'chips' });
  const draw = () => wrap.replaceChildren(...[[720, 'HD 720p'], [1080, 'Full HD 1080p']].map(([v, l]) => {
    const locked = v > maxExportHeight();
    return h('button', { type: 'button', class: `chip${value === v ? ' on' : ''}`, disabled: locked, title: locked ? 'Available on Creator and Studio plans' : null,
      onclick: () => { value = v; draw(); onPick?.(v); } }, l, locked && h('span', { class: 'badge', style: { marginLeft: '4px' } }, 'Creator'));
  }));
  draw();
  return { el: wrap, get value() { return value; } };
}

/**
 * A "Generate" block: quality choice, progress bar, cancel. Resolves via
 * onDone(videoRecord) when the render finishes.
 */
export function generateBlock(project, { onDone, label = 'Generate video' } = {}) {
  const q = qualityPicker(+getSettings().exportQuality || 720);
  const bar = h('i');
  const progress = h('div', { class: 'progress', hidden: true }, bar);
  const stage = h('span', { class: 'small muted' });
  const go = h('button', { class: 'btn primary lg' }, icon('sparkle'), label);
  const cancel = h('button', { class: 'btn ghost', hidden: true }, 'Cancel');
  let ctrl = null;

  go.addEventListener('click', async () => {
    ctrl = new AbortController();
    go.disabled = true; cancel.hidden = false; progress.hidden = false;
    stage.textContent = 'Starting…';
    try {
      const rec = await generateProject(project, {
        height: q.value,
        signal: ctrl.signal,
        onProgress: (p, s) => { bar.style.width = `${Math.round(p * 100)}%`; stage.textContent = `${s || 'Rendering'} · ${Math.round(p * 100)}% · keep this tab open`; },
      });
      stage.textContent = `Done · ${rec.width}×${rec.height} · ${fmtBytes(rec.blob.size)}`;
      toast('Your video is ready.', 'success');
      onDone?.(rec);
    } catch (e) {
      if (e.name !== 'AbortError') { console.error(e); toast(e.message, 'error'); stage.textContent = e.message; }
      else stage.textContent = 'Cancelled.';
      progress.hidden = true;
    } finally {
      go.disabled = false; cancel.hidden = true; bar.style.width = '0';
    }
  });
  cancel.addEventListener('click', () => ctrl?.abort());

  return h('div', { class: 'stack' },
    h('div', { class: 'field' }, h('span', {}, 'Quality'), q.el),
    h('div', { class: 'row' }, go, cancel),
    progress, stage);
}

export function downloadButton(video, { label = 'Download' } = {}) {
  return h('button', { class: 'btn primary', onclick: async () => {
    downloadBlob(video.blob, video.name);
    await recordExport(video);
    toast('Download started. It\'s saved in your export history.', 'success');
  } }, icon('download'), label);
}
