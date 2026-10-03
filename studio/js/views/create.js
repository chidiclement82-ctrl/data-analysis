// Guided creation flow: Upload → Face → Voice → Edit → Generate → Preview → Export.

import { h, icon, toast, dropzone, fmtTime, fmtBytes, loadVideo } from '../ui.js';
import { get, all, blobUrl } from '../store.js';
import { addSourceVideo, addFace, faceTile, videoTile, sourceVideos } from '../library.js';
import { createProject, saveProject, subtitlesFromScript, projectAssets } from '../projects.js';
import { analyzeVideo, getDetector } from '../faceswap.js';
import { Player, defaultProject } from '../player.js';
import { mountEditor } from '../editor.js';
import { generateBlock, downloadButton } from '../exportui.js';
import { speechPanel, pickOrCreateVoice, voiceKind } from './voice.js';
import { startRecording, drawWave, decode, peaks, generateSpeech } from '../voice.js';
import { openReportDialog } from '../safety.js';
import { navigate } from '../app.js';

const STEPS = ['Upload', 'Choose face', 'Choose voice', 'Edit', 'Generate', 'Preview', 'Export'];

export async function renderCreate(app, { args }) {
  let project = args[0] ? await get('projects', args[0]) : null;
  let step = project ? Math.min(project.step || 0, STEPS.length - 1) : 0;
  let maxStep = project?.maxStep ?? step;
  let teardown = [];

  const stepsEl = h('nav', { class: 'steps', 'aria-label': 'Progress' });
  const body = h('div');
  const foot = h('div', { class: 'wizard-foot' });
  const title = h('h1', {}, project?.name || 'Create a video');
  app.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, title, h('p', { class: 'muted' }, 'Follow the steps. You can go back at any time; your work saves automatically.'))),
    stepsEl, body, foot));

  function cleanupStep() { teardown.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); teardown = []; }

  async function go(n) {
    cleanupStep();
    step = n;
    maxStep = Math.max(maxStep, n);
    if (project) { project.step = n; project.maxStep = maxStep; await saveProject(project); if (!location.hash.includes(project.id)) history.replaceState(null, '', `#/create/${project.id}`); }
    draw();
  }

  function drawSteps() {
    stepsEl.replaceChildren(...STEPS.map((s, i) => h('button', {
      class: `step${i === step ? ' current' : ''}${i < maxStep && i !== step ? ' done' : ''}`,
      disabled: i > maxStep || (!project && i > 0),
      'aria-current': i === step ? 'step' : null,
      onclick: () => i !== step && go(i),
    }, h('span', { class: 'num' }, i < maxStep && i !== step ? icon('check', 12) : i + 1), s)));
  }

  function footer({ next = 'Continue', canNext = true, onNext, hideNext = false } = {}) {
    const nextBtn = h('button', { class: 'btn primary', disabled: !canNext }, next, icon('arrow', 16));
    nextBtn.addEventListener('click', async () => {
      nextBtn.disabled = true;
      try { if (onNext) { const ok = await onNext(); if (ok === false) return; } await go(step + 1); }
      finally { nextBtn.disabled = false; }
    });
    foot.replaceChildren(
      step > 0 ? h('button', { class: 'btn ghost', onclick: () => go(step - 1) }, icon('back', 16), 'Back') : h('span'),
      hideNext ? h('span') : nextBtn);
    return nextBtn;
  }

  async function draw() {
    drawSteps();
    body.replaceChildren();
    title.textContent = project?.name || 'Create a video';
    await [stepUpload, stepFace, stepVoice, stepEdit, stepGenerate, stepPreview, stepExport][step]();
  }

  // ---------- 1. Upload ----------
  async function stepUpload() {
    const videos = await sourceVideos();
    const choose = async (v) => {
      if (project && project.sourceVideoId === v.id) return;
      if (project) {
        project.sourceVideoId = v.id;
        project.thumb = v.thumb;
        project.cloudSwapVideoId = null;
        const fresh = defaultProject(v.duration);
        fresh.faceSwap.enabled = !!project.faceId;
        project.edit = fresh;
        await saveProject(project);
      } else {
        project = await createProject({ sourceVideoId: v.id });
        history.replaceState(null, '', `#/create/${project.id}`);
      }
      draw();
    };
    body.append(h('div', { class: 'grid-2' },
      h('div', { class: 'card' },
        h('h3', {}, 'Upload the video you want to star in'),
        h('p', { class: 'muted small' }, 'Best results: one main face, well lit, facing the camera for most of the clip.'),
        dropzone({ accept: 'video/*', label: 'Drop a video here or click to browse', hint: 'MP4, MOV or WebM · up to 5 minutes · 500 MB', onFile: async (f) => { const v = await addSourceVideo(f); if (v) choose(v); } })),
      h('div', { class: 'card' },
        h('h3', {}, 'Or pick one you uploaded before'),
        videos.length
          ? h('div', { class: 'thumb-grid' }, videos.map(v => videoTile(v, { selected: project?.sourceVideoId === v.id, onSelect: choose })))
          : h('p', { class: 'muted small' }, 'Your uploaded videos will appear here.'))));
    footer({ canNext: !!project?.sourceVideoId });
  }

  // ---------- 2. Face ----------
  async function stepFace() {
    const faces = await all('faces');
    const fs = project.edit.faceSwap;
    const preview = h('div');
    const select = async (faceId) => {
      if (project.faceId !== faceId) { project.faceId = faceId; project.cloudSwapVideoId = null; }
      fs.enabled = !!faceId;
      await saveProject(project);
      draw();
    };

    body.append(h('div', { class: 'split' },
      h('div', { class: 'card' },
        h('h3', {}, 'Whose face should appear in the video?'),
        h('div', { class: 'thumb-grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' } },
          faces.map(f => faceTile(f, { selected: fs.enabled && project.faceId === f.id, onSelect: (face) => select(face.id) })),
          h('div', { class: `tile selectable${!fs.enabled ? ' selected' : ''}`, role: 'button', tabindex: '0', onclick: () => select(null) },
            h('span', { class: 'check-mark' }, icon('check', 14)),
            h('div', { class: 'media' }, h('span', { class: 'muted small', style: { padding: '12px', textAlign: 'center' } }, 'Keep the original faces')),
            h('div', { class: 'body' }, h('span', { class: 'title' }, 'No face swap')))),
        h('div', { style: { marginTop: '16px' } },
          dropzone({ accept: 'image/*', label: 'Upload a selfie', hint: 'Front-facing, eyes visible, even light, no sunglasses', onFile: async (f) => { const rec = await addFace(f); if (rec) select(rec.id); } }))),
      preview));

    if (fs.enabled && project.faceId) {
      await facePreview(preview);
    } else {
      preview.append(h('div', { class: 'card' }, h('h3', {}, 'Preview'), h('p', { class: 'muted small' }, 'Pick or upload a face to see it swapped into your video.')));
    }
    footer({ canNext: true });
  }

  async function facePreview(container) {
    const fs = project.edit.faceSwap;
    const card = h('div', { class: 'card' });
    container.append(card);
    if (!fs.track) {
      const bar = h('i');
      const msg = h('span', { class: 'small muted' }, 'Loading face detector…');
      card.append(h('h3', {}, 'Finding the face in your video'), h('div', { class: 'progress' }, bar), h('p', { class: 'row', style: { marginTop: '10px' } }, h('span', { class: 'spinner' }), msg));
      const ctrl = new AbortController();
      teardown.push(() => ctrl.abort());
      const det = await getDetector();
      msg.textContent = det ? 'Tracking head movement frame by frame…' : 'Automatic detection isn\'t available in this browser. You can place your face by hand in the Edit step.';
      const src = await get('videos', project.sourceVideoId);
      const v = await loadVideo(blobUrl(src.id, src.blob));
      try {
        fs.track = await analyzeVideo(v, { fps: src.duration > 60 ? 5 : 8, signal: ctrl.signal, onProgress: p => { bar.style.width = `${p * 100}%`; } });
        await saveProject(project);
      } catch (e) {
        if (e.name === 'AbortError') return;
        throw e;
      } finally { v.removeAttribute('src'); v.load(); }
      card.replaceChildren();
    }
    const cov = fs.track.coverage;
    const canvas = h('canvas');
    const stage = h('div', { class: 'stage' }, canvas);
    card.append(
      h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, 'Before / after'),
        cov > 0.15 ? h('span', { class: 'badge ok' }, `Face found in ${Math.round(cov * 100)}% of frames`) : h('span', { class: 'badge warn' }, 'No face detected')),
      h('p', { class: 'muted small' }, cov > 0.15 ? 'Drag across the video to compare. Press play to see the face follow the movement.' : 'We couldn\'t detect a face automatically. Continue, then use "Place manually" in the Face swap tab of the editor.'),
      stage);
    const playBtn = h('button', { class: 'icon-btn', 'aria-label': 'Play' }, icon('play'));
    const time = h('span', { class: 'time' });
    card.append(h('div', { class: 'transport' }, playBtn, time));
    const player = new Player(canvas, { onTime: t => { time.textContent = `${fmtTime(t)} / ${fmtTime(player.duration)}`; }, onEnd: () => playBtn.replaceChildren(icon('play')) });
    teardown.push(() => player.destroy());
    await player.load({ ...project.edit, subtitles: [], texts: [], sfx: [], fadeIn: 0, fadeOut: 0 }, await projectAssets({ ...project, voiceMode: 'none', narration: null, music: null }));
    stage.classList.toggle('portrait', player.vh > player.vw);
    player.split = 0.5;
    player.draw();
    playBtn.addEventListener('click', async () => { if (player.playing) { player.pause(); playBtn.replaceChildren(icon('play')); } else { await player.play(); playBtn.replaceChildren(icon('pause')); } });
    let drag = false;
    const at = (e) => { const r = canvas.getBoundingClientRect(); player.split = Math.min(0.98, Math.max(0.02, (e.clientX - r.left) / r.width)); player.draw(); };
    canvas.addEventListener('pointerdown', (e) => { drag = true; canvas.setPointerCapture(e.pointerId); at(e); });
    canvas.addEventListener('pointermove', (e) => drag && at(e));
    canvas.addEventListener('pointerup', () => { drag = false; });
  }

  // ---------- 3. Voice ----------
  async function stepVoice() {
    const voices = await all('voices');
    const voice = voices.find(v => v.id === project.voiceId) || null;
    const left = h('div', { class: 'card' });
    const right = h('div', { class: 'card' });
    body.append(h('div', { class: 'split' }, left, right));

    const mode = project.voiceMode;
    const setMode = async (m) => { project.voiceMode = m; if (m !== 'record' && project.narrationSource === 'recorded') project.narration = null; await saveProject(project); draw(); };
    left.append(
      h('h3', {}, 'What should the video sound like?'),
      h('div', { class: 'chips', style: { marginBottom: '16px' } },
        [['clone', 'My AI voice reads a script'], ['record', 'I\'ll record the narration'], ['none', 'Keep the original audio']].map(([m, l]) =>
          h('button', { class: `chip${mode === m ? ' on' : ''}`, onclick: () => setMode(m) }, l))));

    if (mode === 'clone') {
      left.append(
        h('div', { class: 'field' }, h('span', {}, 'Voice model'),
          h('div', { class: 'thumb-grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' } },
            voices.map(v => h('div', { class: `tile selectable${v.id === project.voiceId ? ' selected' : ''}`, role: 'button', tabindex: '0',
              onclick: async () => { project.voiceId = v.id; project.narration = null; await saveProject(project); draw(); } },
              h('span', { class: 'check-mark' }, icon('check', 14)),
              h('div', { class: 'body' }, h('span', { class: 'title' }, icon('mic', 14), ' ', v.name), h('span', { class: 'small muted' }, voiceKind(v))))),
            h('button', { class: 'tile selectable', style: { alignItems: 'center', justifyContent: 'center', padding: '14px', color: 'var(--accent)' },
              onclick: async () => { const v = await pickOrCreateVoice(); if (v) { project.voiceId = v.id; await saveProject(project); draw(); } } },
              icon('plus'), h('span', { class: 'small' }, 'Create a new voice')))));
    } else if (mode === 'record') {
      left.append(narrationRecorder());
    } else {
      left.append(h('p', { class: 'muted' }, 'The video keeps its original soundtrack. You can still add music, subtitles and sound effects in the next step.'));
    }

    // Script + speech settings
    if (mode === 'clone' && voice) {
      const panel = speechPanel(voice, { script: project.script, onGenerated: async (res) => {
        project.script = res.text;
        project.speech = res.opts;
        if (res.blob) { project.narration = res.blob; project.narrationSource = 'ai'; }
        await saveProject(project);
        if (res.blob) toast('Narration generated and added to your video.', 'success');
      } });
      panel.text.addEventListener('input', () => { project.script = panel.text.value; project.narration = null; saveProject(project); });
      teardown.push(() => panel.stop());
      right.append(h('h3', {}, 'Script'), panel.el);
      if (!voice.remoteId) {
        right.append(h('div', { class: 'notice warn', style: { marginTop: '14px' } }, icon('mic'), h('span', {}, 'This is a preview voice, so it plays live in previews but isn\'t saved into the exported file. ', h('a', { href: '#/dashboard/account' }, 'Add an ElevenLabs key'), ' and create a real clone, or choose "I\'ll record the narration".')));
      } else {
        right.append(h('p', { class: 'small muted', style: { marginTop: '12px' } }, 'When you continue, your cloned voice reads the script and the speech is added to the video.'));
      }
    } else if (mode === 'record') {
      const text = h('textarea', { rows: 8, placeholder: 'Write what you\'ll say. It becomes your subtitles too.' }, project.script);
      text.addEventListener('input', () => { project.script = text.value; saveProject(project); });
      right.append(h('h3', {}, 'Script (for subtitles)'), text);
    } else {
      const text = h('textarea', { rows: 6, placeholder: 'Optional: text for subtitles.' }, project.script);
      text.addEventListener('input', () => { project.script = text.value; saveProject(project); });
      right.append(h('h3', {}, 'Subtitles text (optional)'), text);
    }

    footer({
      canNext: mode !== 'clone' || !!voice,
      onNext: async () => {
        // A real clone: make the narration now so it's in the edit and the export.
        if (mode === 'clone' && voice?.remoteId && project.script?.trim() && !project.narration) {
          toast('Generating your voice…');
          try {
            const res = await generateSpeech(voice, project.script.trim(), project.speech);
            if (res.blob) { project.narration = res.blob; project.narrationSource = 'ai'; project.edit.subtitles = []; await saveProject(project); }
          } catch (e) {
            toast(`Couldn't generate the voice: ${e.message}`, 'error');
            return false;
          }
        }
        if (project.script?.trim() && !project.edit.subtitles.length) {
          let dur = null;
          if (project.narration) { try { dur = (await decode(project.narration)).duration; } catch { /* estimate instead */ } }
          project.edit.subtitles = subtitlesFromScript(project.script, { duration: dur, speed: project.speech?.speed || 1 });
          await saveProject(project);
        }
      },
    });
  }

  function narrationRecorder() {
    const wrap = h('div', { class: 'stack' });
    const btn = h('button', { class: 'btn primary' }, icon('record'), project.narration && project.narrationSource === 'recorded' ? 'Record again' : 'Start recording');
    const status = h('div', { class: 'row small muted' });
    const wave = h('canvas', { class: 'wave' });
    const audio = h('audio', { controls: true, hidden: !project.narration, style: { width: '100%' } });
    if (project.narration) audio.src = blobUrl(project.id + ':narration', project.narration);
    let rec = null, timer = null;
    btn.addEventListener('click', async () => {
      if (rec) {
        clearInterval(timer);
        const blob = await rec.stop();
        rec = null;
        project.narration = blob; project.narrationSource = 'recorded';
        await saveProject(project);
        audio.src = URL.createObjectURL(blob); audio.hidden = false;
        try { drawWave(wave, peaks(await decode(blob))); } catch { /* still playable */ }
        btn.replaceChildren(icon('record'), 'Record again');
        status.textContent = 'Saved. It plays over your video and is included in the export.';
        return;
      }
      try { rec = await startRecording(); } catch { toast('Microphone access was blocked.', 'error'); return; }
      btn.replaceChildren(icon('stop'), 'Stop');
      timer = setInterval(() => status.replaceChildren(h('span', { class: 'rec-dot' }), `Recording ${fmtTime(rec.elapsed())}`), 200);
    });
    teardown.push(() => { clearInterval(timer); rec?.cancel(); });
    wrap.append(h('p', { class: 'muted small', style: { margin: 0 } }, 'Read your script while watching the video. Your recording replaces the AI voice.'), btn, status, wave, audio);
    return wrap;
  }

  // ---------- 4. Edit ----------
  async function stepEdit() {
    const holder = h('div');
    body.append(holder);
    const editor = await mountEditor(holder, project, { initialTab: project.edit.faceSwap.enabled && !project.edit.faceSwap.track ? 'face' : 'subs' });
    teardown.push(() => editor.destroy());
    footer({ next: 'Continue to generate' });
  }

  // ---------- 5. Generate ----------
  async function stepGenerate() {
    const fs = project.edit.faceSwap;
    const voice = project.voiceId ? await get('voices', project.voiceId) : null;
    const face = project.faceId ? await get('faces', project.faceId) : null;
    const src = await get('videos', project.sourceVideoId);
    const summary = (k, v) => h('div', { class: 'list-item' }, h('span', { class: 'muted' }, k), h('b', {}, v));
    const willSpeakLive = project.voiceMode === 'clone' && !project.narration;
    body.append(h('div', { class: 'split' },
      h('div', { class: 'card' },
        h('h3', {}, 'Ready to generate'),
        h('div', { class: 'list' },
          summary('Video', `${src.name} · ${fmtTime(project.edit.segments.reduce((s, g) => s + g.end - g.start, 0))}`),
          summary('Face', fs.enabled && face ? face.name : 'Original'),
          summary('Voice', project.voiceMode === 'clone' ? (voice?.name || '—') + (willSpeakLive ? ' (preview only)' : '') : project.voiceMode === 'record' ? (project.narration ? 'Your recording' : 'Not recorded yet') : 'Original audio'),
          summary('Subtitles', project.edit.subtitles.length ? `${project.edit.subtitles.length} lines` : 'None'),
          summary('Content ID', project.contentId)),
        fs.enabled && !fs.track && h('div', { class: 'notice warn', style: { marginTop: '12px' } }, icon('face'), h('span', {}, 'The face hasn\'t been placed yet. Go back to Edit → Face swap and press "Detect & swap face".')),
        willSpeakLive && h('div', { class: 'notice warn', style: { marginTop: '12px' } }, icon('mic'), h('span', {}, 'The AI voice can only be previewed live in this mode, so it won\'t be in the exported file. Your subtitles will be.'))),
      h('div', { class: 'card' },
        h('h3', {}, 'Generate'),
        h('p', { class: 'muted small' }, 'We render every frame with your face, voice and edits. It takes about as long as the video plays.'),
        generateBlock(project, { onDone: () => go(5) }))));
    footer({ hideNext: !project.outputVideoId, next: 'See preview' });
  }

  // ---------- 6. Preview ----------
  async function stepPreview() {
    const out = project.outputVideoId ? await get('videos', project.outputVideoId) : null;
    if (!out) { body.append(h('div', { class: 'empty' }, h('h3', {}, 'Nothing generated yet'), h('button', { class: 'btn primary', onclick: () => go(4) }, 'Generate now'))); footer({ hideNext: true }); return; }
    const src = await get('videos', project.sourceVideoId);
    body.append(h('div', { class: 'split' },
      h('div', {},
        h('div', { class: 'stage' }, h('video', { src: blobUrl(out.id, out.blob), controls: true, playsinline: true, autoplay: true })),
        h('p', { class: 'small muted', style: { marginTop: '10px' } }, `${out.width}×${out.height} · ${fmtBytes(out.blob.size)} · labeled AI-generated · ${out.contentId}`)),
      h('div', { class: 'card' },
        h('h3', {}, 'Original'),
        h('div', { class: 'stage' }, h('video', { src: blobUrl(src.id, src.blob), controls: true, muted: true, playsinline: true })),
        h('p', { class: 'muted small', style: { marginTop: '12px' } }, 'Not quite right? Go back to Edit to adjust the face blend, subtitles or audio, then generate again.'),
        h('button', { class: 'btn', onclick: () => go(3) }, icon('scissors', 16), 'Back to edit'))));
    footer({ next: 'Looks good, export' });
  }

  // ---------- 7. Export ----------
  async function stepExport() {
    const out = project.outputVideoId ? await get('videos', project.outputVideoId) : null;
    if (!out) { await go(4); return; }
    const fmt = (out.mime || out.blob.type).includes('mp4') ? 'MP4' : 'WebM';
    body.append(h('div', { class: 'grid-2' },
      h('div', { class: 'card' },
        h('h3', {}, 'Your video is ready'),
        h('div', { class: 'list', style: { margin: '12px 0 18px' } },
          h('div', { class: 'list-item' }, h('span', { class: 'muted' }, 'Format'), h('b', {}, fmt)),
          h('div', { class: 'list-item' }, h('span', { class: 'muted' }, 'Resolution'), h('b', {}, `${out.width}×${out.height}${out.height >= 720 ? ' HD' : ''}`)),
          h('div', { class: 'list-item' }, h('span', { class: 'muted' }, 'Size'), h('b', {}, fmtBytes(out.blob.size))),
          h('div', { class: 'list-item' }, h('span', { class: 'muted' }, 'Content ID'), h('b', {}, out.contentId))),
        h('div', { class: 'row' }, downloadButton(out, { label: 'Download video' }), h('a', { class: 'btn ghost', href: '#/dashboard/videos' }, 'View in dashboard'))),
      h('div', { class: 'card' },
        h('h3', {}, 'Sharing responsibly'),
        h('ul', { class: 'muted small', style: { paddingLeft: '18px', margin: '0 0 14px' } },
          h('li', {}, 'Keep the "AI-generated" label visible. Cropping it out to mislead viewers breaks our policy.'),
          h('li', {}, 'Say it\'s AI in your caption too. Most platforms require it for realistic synthetic media.'),
          h('li', {}, 'Only post videos of other people if they\'ve agreed to it.')),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => navigate('create') }, icon('plus', 16), 'Make another'),
          h('button', { class: 'btn ghost', onclick: () => openReportDialog(out.contentId) }, icon('flag', 16), 'Report a problem')))));
    footer({ hideNext: true });
  }

  await draw();
  return cleanupStep;
}
