// The video editor component: stage + transport + timeline + tool tabs.
// Used by the standalone Editor page and the Edit step of the Create wizard.

import { h, icon, toast, fmtTime, loadVideo, dropzone } from './ui.js';
import { all, blobUrl } from './store.js';
import { Player, SFX, timelineDuration, tlToSrc } from './player.js';
import { analyzeVideo, manualTrack, getDetector } from './faceswap.js';
import { addFace, faceTile } from './library.js';
import { projectAssets, saveProject, subtitlesFromScript, runCloudSwap } from './projects.js';
import { api } from './api.js';

const TABS = [
  ['trim', 'scissors', 'Trim & cut'],
  ['face', 'face', 'Face swap'],
  ['text', 'text', 'Text'],
  ['subs', 'text', 'Subtitles'],
  ['audio', 'music', 'Audio'],
  ['fx', 'sparkle', 'Transitions'],
];

const round = (n) => Math.round(n * 100) / 100;

export async function mountEditor(root, project, { initialTab = 'trim', onChange } = {}) {
  const edit = project.edit;
  const canvas = h('canvas', { 'aria-label': 'Video preview' });
  const stage = h('div', { class: 'stage' }, canvas);
  const timeLabel = h('span', { class: 'time' }, '0:00 / 0:00');
  const playBtn = h('button', { class: 'icon-btn', 'aria-label': 'Play' }, icon('play'));
  const compareBtn = h('button', { class: 'btn sm', type: 'button' }, 'Before / after');
  const timeline = h('div', { class: 'timeline', role: 'slider', 'aria-label': 'Timeline', tabindex: '0' });
  const tabBar = h('div', { class: 'tabs', role: 'tablist' });
  const panel = h('div', { class: 'stack' });
  let tab = initialTab;
  let player = null;
  let assets = null;
  // No face found automatically: start in click-to-place mode.
  let manualMode = !!(edit.faceSwap.enabled && edit.faceSwap.track && edit.faceSwap.track.coverage < 0.15 && !edit.faceSwap.manual);
  let saveTimer = null;
  let destroyed = false;
  let swapCtrl = null;

  function changed({ redrawPanel = false } = {}) {
    player?.setProject(edit);
    drawTimeline();
    if (redrawPanel) drawPanel();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveProject(project), 400);
    onChange?.(project);
  }

  async function buildPlayer() {
    const wasAt = player?.tl || 0;
    player?.destroy();
    assets = await projectAssets(project);
    if (destroyed) return;
    player = new Player(canvas, {
      onTime: (t) => { timeLabel.textContent = `${fmtTime(t)} / ${fmtTime(player.duration)}`; drawPlayhead(); },
      onEnd: () => playBtn.replaceChildren(icon('play')),
    });
    await player.load(edit, assets);
    stage.classList.toggle('portrait', player.vh > player.vw);
    if (wasAt) await player.seek(Math.min(wasAt, player.duration - 0.05));
    compareBtn.hidden = !((edit.faceSwap.enabled && edit.faceSwap.track) || assets.beforeUrl);
    drawTimeline();
  }

  playBtn.addEventListener('click', async () => {
    if (!player) return;
    if (player.playing) { player.pause(); playBtn.replaceChildren(icon('play')); }
    else { await player.play(); playBtn.replaceChildren(icon('pause')); }
  });

  compareBtn.addEventListener('click', () => {
    player.split = player.split == null ? 0.5 : null;
    compareBtn.classList.toggle('primary', player.split != null);
    player.draw();
  });

  // Stage pointer: drag the before/after divider, or place the face manually.
  const stagePoint = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  let dragging = false;
  canvas.addEventListener('pointerdown', (e) => {
    const p = stagePoint(e);
    if (manualMode) {
      const size = edit.faceSwap.manualSize || 0.22;
      const w = player.vw * size;
      edit.faceSwap.track = manualTrack(assets.video.duration, { cx: p.x * player.vw, cy: p.y * player.vh, w, h: w * 1.2 });
      edit.faceSwap.manual = { x: p.x, y: p.y };
      changed();
      return;
    }
    if (player?.split != null) { dragging = true; canvas.setPointerCapture(e.pointerId); player.split = p.x; player.draw(); }
  });
  canvas.addEventListener('pointermove', (e) => { if (dragging) { player.split = Math.min(0.98, Math.max(0.02, stagePoint(e).x)); player.draw(); } });
  canvas.addEventListener('pointerup', () => { dragging = false; });

  // ---- timeline ----
  const playhead = h('div', { class: 'playhead' });
  function drawPlayhead() {
    if (!player) return;
    playhead.style.left = `${(player.tl / Math.max(0.01, player.duration)) * 100}%`;
  }
  function drawTimeline() {
    const D = timelineDuration(edit.segments) || 1;
    const blocks = [];
    let acc = 0;
    for (const s of edit.segments) {
      const len = s.end - s.start;
      blocks.push(h('div', { class: 'seg-block', style: { left: `calc(${acc / D * 100}% + 2px)`, width: `calc(${len / D * 100}% - 4px)` } }));
      acc += len;
    }
    const subs = edit.subtitles.map(s => h('div', { class: 'sub-mark', style: { left: `${s.start / D * 100}%`, width: `${Math.max(0.5, (s.end - s.start) / D * 100)}%` } }));
    const fx = edit.sfx.map(s => h('div', { class: 'marker', title: SFX[s.kind], style: { left: `${s.t / D * 100}%` } }));
    timeline.replaceChildren(...blocks, ...subs, ...fx, playhead);
    drawPlayhead();
  }
  let scrubbing = false;
  const scrubTo = (e) => {
    const r = timeline.getBoundingClientRect();
    const u = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    player?.seek(u * player.duration);
  };
  timeline.addEventListener('pointerdown', (e) => { scrubbing = true; timeline.setPointerCapture(e.pointerId); if (player?.playing) { player.pause(); playBtn.replaceChildren(icon('play')); } scrubTo(e); });
  timeline.addEventListener('pointermove', (e) => scrubbing && scrubTo(e));
  timeline.addEventListener('pointerup', () => { scrubbing = false; });
  timeline.addEventListener('keydown', (e) => {
    if (!player) return;
    if (e.key === 'ArrowRight') player.seek(player.tl + 1);
    if (e.key === 'ArrowLeft') player.seek(player.tl - 1);
    if (e.key === ' ') { e.preventDefault(); playBtn.click(); }
  });

  // ---- panels ----
  const num = (value, onInput, { step = 0.1, min = 0, max } = {}) =>
    h('input', { type: 'number', step: String(step), min: String(min), max: max != null ? String(max) : null, value: String(round(value)), onchange: (e) => onInput(+e.target.value) });
  const slider = (label, value, min, max, step, fmt, onInput) => {
    const out = h('output', {}, fmt(value));
    return [h('span', {}, label), h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), oninput: (e) => { out.textContent = fmt(+e.target.value); onInput(+e.target.value); } }), out];
  };
  const toggle = (label, checked, onToggle) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked, onchange: (e) => onToggle(e.target.checked) }), h('span', {}, label));
  const now = () => player?.tl || 0;

  function trimPanel() {
    const srcDur = assets.video.duration;
    const split = () => {
      const { src, index } = tlToSrc(edit.segments, now());
      const s = edit.segments[index];
      if (src - s.start < 0.2 || s.end - src < 0.2) { toast('Move the playhead away from the edge of a clip to split it.'); return; }
      edit.segments.splice(index, 1, { start: s.start, end: src }, { start: src, end: s.end });
      changed({ redrawPanel: true });
    };
    const trimStart = () => { const { src, index } = tlToSrc(edit.segments, now()); edit.segments = edit.segments.slice(index); edit.segments[0] = { ...edit.segments[0], start: src }; changed({ redrawPanel: true }); player.seek(0); };
    const trimEnd = () => { const { src, index } = tlToSrc(edit.segments, now()); edit.segments = edit.segments.slice(0, index + 1); edit.segments[index] = { ...edit.segments[index], end: Math.max(edit.segments[index].start + 0.2, src) }; changed({ redrawPanel: true }); };
    return [
      h('p', { class: 'muted small', style: { margin: 0 } }, 'Move the playhead, then split or trim. Delete a clip to cut it out. Times are in seconds of the original video.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', onclick: trimStart }, '⇤ Trim start here'),
        h('button', { class: 'btn sm', onclick: split }, icon('scissors', 14), 'Split at playhead'),
        h('button', { class: 'btn sm', onclick: trimEnd }, 'Trim end here ⇥'),
        h('button', { class: 'btn sm ghost', onclick: () => { edit.segments = [{ start: 0, end: srcDur }]; changed({ redrawPanel: true }); } }, 'Reset')),
      h('div', { class: 'list' }, edit.segments.map((s, i) => h('div', { class: 'list-item' },
        h('div', { class: 'inline' }, h('b', {}, `Clip ${i + 1}`),
          num(s.start, v => { s.start = Math.min(Math.max(0, v), s.end - 0.2); changed(); }, { max: srcDur }), '→',
          num(s.end, v => { s.end = Math.max(Math.min(srcDur, v), s.start + 0.2); changed(); }, { max: srcDur }),
          h('span', { class: 'dim small' }, fmtTime(s.end - s.start))),
        h('button', { class: 'icon-btn', 'aria-label': `Delete clip ${i + 1}`, disabled: edit.segments.length < 2, onclick: () => { edit.segments.splice(i, 1); changed({ redrawPanel: true }); player.seek(0); } }, icon('trash', 16))))),
    ];
  }

  function facePanel() {
    const fs = edit.faceSwap;
    const faceGrid = h('div', { class: 'thumb-grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' } });
    all('faces').then(faces => {
      faceGrid.replaceChildren(...faces.map(f => faceTile(f, { selected: f.id === project.faceId, onSelect: async (face) => {
        if (project.faceId === face.id && fs.enabled) return;
        project.faceId = face.id; fs.enabled = true; project.cloudSwapVideoId = null;
        changed({ redrawPanel: true }); await buildPlayer();
      } })));
    });
    return [
      h('div', { class: 'field' }, h('span', {}, 'Your face'), faceGrid,
        dropzone({ accept: 'image/*', label: 'Add a face photo', hint: 'Clear, front-facing, good light', onFile: async (f) => { const rec = await addFace(f); if (rec) { project.faceId = rec.id; fs.enabled = true; project.cloudSwapVideoId = null; changed({ redrawPanel: true }); await buildPlayer(); } } })),
      toggle('Swap the face in this video', fs.enabled, async (v) => { fs.enabled = v; changed({ redrawPanel: true }); await buildPlayer(); }),
      ...(api.mode === 'cloud' ? cloudSwapControls() : localSwapControls()),
    ];
  }

  // Generative swap on the AI server.
  function cloudSwapControls() {
    const fs = edit.faceSwap;
    if (!fs.enabled || !project.faceId) return [];
    const ready = project.cloudSwapVideoId && project.cloudSwapFaceId === project.faceId;
    const bar = h('i');
    const prog = h('div', { class: 'progress', hidden: true }, bar);
    const stage = h('span', { class: 'small muted' });
    const run = h('button', { class: 'btn primary sm' }, icon('sparkle', 14), ready ? 'Redo AI face swap' : 'Generate AI face swap');
    run.addEventListener('click', async () => {
      swapCtrl?.abort();
      swapCtrl = new AbortController();
      run.disabled = true; prog.hidden = false;
      try {
        await runCloudSwap(project, { signal: swapCtrl.signal, onProgress: (p, s) => { bar.style.width = `${Math.round(p * 100)}%`; stage.textContent = `${s || 'Working'} · ${Math.round(p * 100)}%`; } });
        changed({ redrawPanel: true });
        await buildPlayer();
        player.split = 0.5; compareBtn.hidden = false; compareBtn.classList.add('primary'); player.draw();
        toast('AI face swap ready. Drag across the video to compare.', 'success');
      } catch (e) {
        if (e.name !== 'AbortError') { toast(e.message, 'error'); stage.textContent = e.message; }
        prog.hidden = true;
      } finally {
        run.disabled = false;
      }
    });
    return [
      h('div', { class: 'row' }, run, ready && h('span', { class: 'badge ok' }, icon('check', 12), 'AI face swap applied')),
      prog, stage,
      h('div', { class: 'notice' }, icon('sparkle'), h('span', {}, 'Runs on your AI server. The model redraws your face in every frame, keeping the original expressions, lip movement, head turns and lighting.')),
    ];
  }

  // Instant in-browser overlay.
  function localSwapControls() {
    const fs = edit.faceSwap;
    const t = fs.track;
    const status = h('div', { class: 'stack' });
    const prog = h('div', { class: 'progress', hidden: true }, h('i'));
    const analyze = async () => {
      if (!project.faceId) { toast('Choose a face first.'); return; }
      prog.hidden = false;
      status.replaceChildren(h('span', { class: 'row small muted' }, h('span', { class: 'spinner' }), 'Loading face detector…'));
      const det = await getDetector();
      status.replaceChildren(h('span', { class: 'row small muted' }, h('span', { class: 'spinner' }), det ? 'Finding and tracking the face in every frame…' : 'No automatic detector available in this browser.'));
      const v = await loadVideo(blobUrl(assets.video.id, assets.video.blob));
      try {
        const track = await analyzeVideo(v, { fps: assets.video.duration > 60 ? 5 : 8, onProgress: (p) => { prog.firstChild.style.width = `${p * 100}%`; } });
        fs.track = track; fs.enabled = true;
        manualMode = track.coverage < 0.15;
        changed({ redrawPanel: true });
        compareBtn.hidden = false;
        if (!manualMode) { player.split = 0.5; compareBtn.classList.add('primary'); player.draw(); }
        toast(manualMode ? 'We couldn\'t find a face automatically. Click on the video where the face is.' : `Face tracked in ${Math.round(track.coverage * 100)}% of frames.`, manualMode ? 'info' : 'success');
      } finally {
        v.removeAttribute('src'); v.load();
      }
    };
    return [
      fs.enabled && h('div', { class: 'row' },
        h('button', { class: 'btn primary sm', onclick: analyze }, icon('face', 14), t ? 'Re-detect face' : 'Detect & swap face'),
        t && h('span', { class: 'badge ok' }, t.detector === 'manual' ? 'Placed by hand' : `Tracked in ${Math.round(t.coverage * 100)}% of frames`),
        h('button', { class: `btn sm${manualMode ? ' primary' : ''}`, onclick: () => { manualMode = !manualMode; drawPanel(); } }, manualMode ? 'Done placing' : 'Place manually')),
      prog, status,
      manualMode && h('div', { class: 'notice' }, icon('face'), h('span', {}, 'Click on the face in the video to place your face there. Use the size slider to fit it.')),
      manualMode && h('div', { class: 'kv' }, ...slider('Face size', fs.manualSize || 0.22, 0.08, 0.6, 0.01, v => `${Math.round(v * 100)}%`, v => {
        fs.manualSize = v;
        if (fs.manual) { const w = player.vw * v; fs.track = manualTrack(assets.video.duration, { cx: fs.manual.x * player.vw, cy: fs.manual.y * player.vh, w, h: w * 1.2 }); changed(); }
      })),
      fs.enabled && t && h('div', { class: 'kv' },
        ...slider('Blend', fs.strength, 0.5, 1, 0.01, v => `${Math.round(v * 100)}%`, v => { fs.strength = v; changed(); })),
      fs.enabled && t && toggle('Keep original mouth movement (most natural lip-sync and expressions)', fs.preserveMouth, v => { fs.preserveMouth = v; changed(); }),
      fs.enabled && t && toggle('Match lighting and skin tone frame by frame', fs.colorMatch, v => { fs.colorMatch = v; changed(); }),
      h('div', { class: 'notice' }, icon('sparkle'), h('span', {}, 'Instant in-browser preview: your face is overlaid and follows head movement. For the real AI swap that redraws your face with the original expressions, ', h('a', { href: '#/dashboard/account' }, 'connect a face swap server'), '.')),
    ];
  }

  function textPanel() {
    const add = () => { edit.texts.push({ text: 'Your title', start: round(now()), end: round(Math.min(player.duration, now() + 3)), position: 'center', anim: 'pop', color: '#ffffff', size: 0.07 }); changed({ redrawPanel: true }); };
    return [
      h('div', { class: 'row' }, h('button', { class: 'btn sm primary', onclick: add }, icon('plus', 14), 'Add text at playhead')),
      edit.texts.length ? h('div', { class: 'list' }, edit.texts.map((t, i) => h('div', { class: 'list-item' },
        h('div', { class: 'stack', style: { gap: '8px' } },
          h('input', { type: 'text', value: t.text, oninput: (e) => { t.text = e.target.value; changed(); } }),
          h('div', { class: 'inline small' },
            num(t.start, v => { t.start = v; changed(); }), '→', num(t.end, v => { t.end = Math.max(t.start + 0.2, v); changed(); }),
            h('select', { onchange: (e) => { t.position = e.target.value; changed(); } }, ['top', 'center', 'bottom'].map(p => h('option', { value: p, selected: t.position === p }, p))),
            h('select', { onchange: (e) => { t.anim = e.target.value; changed(); } }, [['fade', 'Fade'], ['pop', 'Pop'], ['slide', 'Slide up']].map(([v, l]) => h('option', { value: v, selected: t.anim === v }, l))),
            h('input', { type: 'color', value: t.color, 'aria-label': 'Text color', oninput: (e) => { t.color = e.target.value; changed(); } }),
            h('select', { onchange: (e) => { t.size = +e.target.value; changed(); } }, [[0.05, 'S'], [0.07, 'M'], [0.1, 'L'], [0.14, 'XL']].map(([v, l]) => h('option', { value: v, selected: t.size === v }, l))))),
        h('button', { class: 'icon-btn', 'aria-label': 'Delete text', onclick: () => { edit.texts.splice(i, 1); changed({ redrawPanel: true }); } }, icon('trash', 16)))))
        : h('p', { class: 'muted small' }, 'No text yet. Titles, captions and call-outs appear here.'),
    ];
  }

  function subsPanel() {
    const fromScript = () => {
      if (!project.script?.trim()) { toast('Add a script in the Voice step first, or add subtitles by hand.'); return; }
      const dur = player.narration?.duration || null;
      edit.subtitles = subtitlesFromScript(project.script, { duration: dur, offset: project.narrationOffset || 0, speed: project.speech?.speed || 1 });
      changed({ redrawPanel: true });
    };
    return [
      h('div', { class: 'row' },
        h('button', { class: 'btn sm primary', onclick: fromScript }, icon('sparkle', 14), 'Auto-generate from script'),
        h('button', { class: 'btn sm', onclick: () => { edit.subtitles.push({ start: round(now()), end: round(now() + 2.5), text: '' }); edit.subtitles.sort((a, b) => a.start - b.start); changed({ redrawPanel: true }); } }, icon('plus', 14), 'Add at playhead'),
        edit.subtitles.length > 0 && h('button', { class: 'btn sm ghost', onclick: () => { edit.subtitles = []; changed({ redrawPanel: true }); } }, 'Clear all')),
      h('div', { class: 'field' }, h('span', {}, 'Style'), h('div', { class: 'chips' }, [['boxed', 'Boxed'], ['outline', 'Outline'], ['yellow', 'Yellow']].map(([v, l]) =>
        h('button', { class: `chip${edit.subtitleStyle === v ? ' on' : ''}`, onclick: () => { edit.subtitleStyle = v; changed({ redrawPanel: true }); } }, l)))),
      h('div', { class: 'list' }, edit.subtitles.map((s, i) => h('div', { class: 'list-item' },
        h('div', { class: 'inline' },
          num(s.start, v => { s.start = v; changed(); }), '→', num(s.end, v => { s.end = Math.max(s.start + 0.2, v); changed(); }),
          h('input', { type: 'text', value: s.text, placeholder: 'Subtitle text', style: { flex: '1', minWidth: '160px' }, oninput: (e) => { s.text = e.target.value; changed(); } })),
        h('button', { class: 'icon-btn', 'aria-label': 'Delete subtitle', onclick: () => { edit.subtitles.splice(i, 1); changed({ redrawPanel: true }); } }, icon('trash', 16))))),
    ];
  }

  function audioPanel() {
    const pct = v => `${Math.round(v * 100)}%`;
    return [
      h('div', { class: 'kv' },
        ...slider('Original audio', edit.videoVolume, 0, 1.5, 0.05, pct, v => { edit.videoVolume = v; changed(); }),
        ...(project.narration ? slider('Voice', edit.voiceVolume, 0, 1.5, 0.05, pct, v => { edit.voiceVolume = v; changed(); }) : []),
        ...(project.music ? slider('Music', edit.musicVolume, 0, 1, 0.05, pct, v => { edit.musicVolume = v; changed(); }) : [])),
      toggle('Lower the original audio while the voice is speaking', edit.duckOriginal, v => { edit.duckOriginal = v; changed(); }),
      project.music
        ? h('div', { class: 'row between' }, h('span', { class: 'row small' }, icon('music', 16), project.musicName || 'Music track'),
            h('button', { class: 'btn sm ghost', onclick: async () => { project.music = null; project.musicName = ''; changed({ redrawPanel: true }); await buildPlayer(); } }, 'Remove music'))
        : dropzone({ accept: 'audio/*', label: 'Add background music', hint: 'MP3, WAV or M4A you have the rights to use. It loops to fit.', onFile: async (f) => { project.music = f; project.musicName = f.name; changed({ redrawPanel: true }); await buildPlayer(); } }),
      h('div', { class: 'field' }, h('span', {}, 'Sound effects (added at the playhead)'),
        h('div', { class: 'chips' }, Object.entries(SFX).map(([k, l]) => h('button', { class: 'chip', onclick: () => { edit.sfx.push({ t: round(now()), kind: k }); edit.sfx.sort((a, b) => a.t - b.t); changed({ redrawPanel: true }); } }, '+ ' + l)))),
      edit.sfx.length > 0 && h('div', { class: 'list' }, edit.sfx.map((s, i) => h('div', { class: 'list-item' },
        h('div', { class: 'inline' }, h('b', {}, SFX[s.kind]), 'at', num(s.t, v => { s.t = v; changed(); }), 's'),
        h('button', { class: 'icon-btn', 'aria-label': 'Delete sound effect', onclick: () => { edit.sfx.splice(i, 1); changed({ redrawPanel: true }); } }, icon('trash', 16))))),
    ];
  }

  function fxPanel() {
    const sec = v => `${v.toFixed(1)}s`;
    return [
      h('div', { class: 'field' }, h('span', {}, 'Transition between clips'), h('div', { class: 'chips' }, [['none', 'Hard cut'], ['fade', 'Dip to black'], ['flash', 'Flash']].map(([v, l]) =>
        h('button', { class: `chip${edit.transition === v ? ' on' : ''}`, onclick: () => { edit.transition = v; changed({ redrawPanel: true }); } }, l)))),
      h('div', { class: 'kv' },
        ...slider('Fade in', edit.fadeIn, 0, 3, 0.1, sec, v => { edit.fadeIn = v; changed(); }),
        ...slider('Fade out', edit.fadeOut, 0, 3, 0.1, sec, v => { edit.fadeOut = v; changed(); })),
      edit.segments.length < 2 && h('p', { class: 'muted small' }, 'Tip: split the video in Trim & cut to add transitions between clips.'),
    ];
  }

  function drawPanel() {
    tabBar.replaceChildren(...TABS.map(([id, ic, label]) => h('button', { role: 'tab', 'aria-selected': String(tab === id), class: tab === id ? 'on' : '', onclick: () => { tab = id; drawPanel(); } }, icon(ic, 15), label)));
    if (!assets) return;
    const builders = { trim: trimPanel, face: facePanel, text: textPanel, subs: subsPanel, audio: audioPanel, fx: fxPanel };
    panel.replaceChildren(...builders[tab]().flat().filter(Boolean));
  }

  root.append(h('div', { class: 'split' },
    h('div', {},
      stage,
      h('div', { class: 'transport' }, playBtn, timeLabel, h('span', { style: { flex: 1 } }), compareBtn),
      timeline),
    h('div', { class: 'card' }, tabBar, panel)));

  await buildPlayer();
  drawPanel();

  return {
    get player() { return player; },
    rebuild: buildPlayer,
    destroy() {
      destroyed = true;
      swapCtrl?.abort();
      clearTimeout(saveTimer);
      saveProject(project);
      player?.destroy();
    },
  };
}
