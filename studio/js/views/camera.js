// Live camera: the webcam with a saved (consented) face following your head in
// real time, and the "AI-generated" label burned into the bottom-right corner of
// every frame. Clips can be recorded to the dashboard. It runs only on this
// page: there's no virtual webcam for other apps.

import { h, icon, toast, fmtTime, fmtBytes, dropzone } from '../ui.js';
import { all, put, uid } from '../store.js';
import { addFace, faceTile, preparedFace } from '../library.js';
import { getDetector, compositeFace, toTrackPoint } from '../faceswap.js';
import { getSegmenter } from '../segment.js';
import { drawAiLabel, newContentId, checkRateLimit } from '../safety.js';
import { pickRecorderMime } from '../player.js';
import { downloadButton } from '../exportui.js';

const MAX_RECORD_SECONDS = 5 * 60;
const DETECT_EVERY_MS = 60;
const KEYS = ['cx', 'cy', 'w', 'h', 'angle', 'mx', 'my'];

export async function renderCamera(app) {
  const canvas = h('canvas', { width: 1280, height: 720, 'aria-label': 'Live camera preview' });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const stage = h('div', { class: 'stage' }, canvas,
    h('div', { class: 'stage-overlay', id: 'cam-idle' },
      h('div', { class: 'stack', style: { alignItems: 'center' } },
        h('span', { class: 'dz-icon' }, icon('face', 26)),
        h('strong', {}, 'Your camera is off'),
        h('span', { class: 'muted small' }, 'Pick a face on the right, then start the camera.'))));
  const camBtn = h('button', { class: 'btn primary' }, icon('play'), 'Start camera');
  const recBtn = h('button', { class: 'btn', disabled: true }, icon('record'), 'Record');
  const recInfo = h('span', { class: 'row small muted' });
  const status = h('span', { class: 'small muted' });
  const faceGrid = h('div', { class: 'thumb-grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' } });
  const result = h('div', { class: 'stack' });

  const opts = {
    swap: true, strength: 1, preserveMouth: true, colorMatch: true, mirror: true,
    bg: 'none', bgColor: '#1d1640', outline: false, outlineColor: '#8b7bff',
  };
  // Background effects: the person is cut out with a live segmentation mask.
  let segmenter = null, segState = 'off', bgImage = null;
  const fg = document.createElement('canvas');
  const fctx = fg.getContext('2d');
  const sil = document.createElement('canvas');
  const sctx = sil.getContext('2d');
  let faceId = null, source = null;
  let stream = null, video = null, raf = 0, detector = null, busy = false, lastDetect = 0;
  let target = null, point = null, seenAt = 0;
  let manualBox = null;
  let contentId = newContentId();
  let recorder = null, recTimer = 0, recStart = 0;

  // ---------- faces ----------
  async function drawFaces() {
    const faces = await all('faces');
    if (!faceId && faces[0]) await selectFace(faces[0].id, false);
    faceGrid.replaceChildren(...faces.map(f => faceTile(f, { selected: f.id === faceId, onSelect: (x) => selectFace(x.id) })));
    if (!faces.length) faceGrid.replaceChildren(h('p', { class: 'muted small', style: { gridColumn: '1 / -1', margin: 0 } }, 'No saved faces yet. Upload one below.'));
  }
  async function selectFace(id, redraw = true) {
    faceId = id;
    source = await preparedFace(id);
    if (redraw) drawFaces();
  }

  // ---------- camera ----------
  async function startCamera() {
    camBtn.disabled = true;
    status.textContent = 'Asking for camera access…';
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (e) {
      try { stream = await navigator.mediaDevices.getUserMedia({ video: true }); }
      catch {
        status.textContent = '';
        toast(e.name === 'NotAllowedError' ? 'Camera access was blocked. Allow it in your browser\'s site settings.' : 'No camera was found.', 'error');
        camBtn.disabled = false;
        return;
      }
      toast('Microphone unavailable: recordings will have no sound.');
    }
    video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, srcObject: stream });
    await video.play();
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    stage.classList.toggle('portrait', canvas.height > canvas.width);
    stage.querySelector('#cam-idle').hidden = true;
    status.textContent = 'Loading face tracking…';
    detector = await getDetector();
    status.textContent = detector ? 'Face tracking is on.' : 'Automatic tracking isn\'t available in this browser. Click your face in the preview to place the swap.';
    camBtn.disabled = false;
    camBtn.replaceChildren(icon('stop'), 'Stop camera');
    recBtn.disabled = false;
    loop();
  }

  function stopCamera() {
    if (recorder) stopRecording();
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach(t => t.stop());
    stream = null; video = null; point = null; target = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    stage.querySelector('#cam-idle').hidden = false;
    camBtn.replaceChildren(icon('play'), 'Start camera');
    recBtn.disabled = true;
    status.textContent = '';
  }

  function detect(now) {
    if (!detector || busy || now - lastDetect < DETECT_EVERY_MS) return;
    busy = true;
    lastDetect = now;
    Promise.resolve(detector.detect(video)).then(faces => {
      if (faces.length) {
        // Follow the face nearest the last one, so a passer-by doesn't steal the swap.
        const pick = point
          ? faces.reduce((a, f) => Math.hypot(f.x + f.w / 2 - point.cx, f.y + f.h / 2 - point.cy) < Math.hypot(a.x + a.w / 2 - point.cx, a.y + a.h / 2 - point.cy) ? f : a)
          : faces.reduce((a, f) => f.w * f.h > a.w * a.h ? f : a);
        target = toTrackPoint(pick);
        seenAt = performance.now();
      }
    }).catch(() => {}).finally(() => { busy = false; });
  }

  function loop() {
    if (!video) return;
    const now = performance.now();
    const W = canvas.width, H = canvas.height;
    const vw = video.videoWidth || W, vh = video.videoHeight || H;
    detect(now);
    if (!detector && manualBox) { target = manualBox; seenAt = now; }
    // Smooth the head position between detections.
    if (target) {
      if (!point) point = { ...target };
      else for (const k of KEYS) point[k] += (target[k] - point[k]) * 0.45;
    }
    const showFace = opts.swap && source && point && now - seenAt < 600;
    const faceOpts = { sx: W / vw, sy: H / vh, preserveMouth: opts.preserveMouth, strength: opts.strength, colorMatch: opts.colorMatch };
    const effects = segmenter && (opts.bg !== 'none' || opts.outline);
    const mirror = (c) => { if (opts.mirror) { c.translate(W, 0); c.scale(-1, 1); } };

    if (!effects) {
      ctx.save();
      mirror(ctx);
      ctx.drawImage(video, 0, 0, W, H);
      if (showFace) compositeFace(ctx, video, source, point, faceOpts);
      ctx.restore();
    } else {
      const mask = segmenter.update(video, vw, vh);
      // You (with the swapped face), cut out by the mask.
      if (fg.width !== W || fg.height !== H) { fg.width = sil.width = W; fg.height = sil.height = H; }
      fctx.globalCompositeOperation = 'source-over';
      fctx.clearRect(0, 0, W, H);
      fctx.drawImage(video, 0, 0, W, H);
      if (showFace) compositeFace(fctx, video, source, point, faceOpts);
      fctx.globalCompositeOperation = 'destination-in';
      fctx.drawImage(mask, 0, 0, W, H);
      fctx.globalCompositeOperation = 'source-over';

      drawBackground(W, H, mirror);
      ctx.save();
      mirror(ctx);
      if (opts.outline) {
        // A glowing silhouette behind you makes the outline.
        sctx.globalCompositeOperation = 'source-over';
        sctx.clearRect(0, 0, W, H);
        sctx.fillStyle = opts.outlineColor;
        sctx.fillRect(0, 0, W, H);
        sctx.globalCompositeOperation = 'destination-in';
        sctx.drawImage(mask, 0, 0, W, H);
        ctx.shadowColor = opts.outlineColor;
        ctx.shadowBlur = Math.max(12, W / 50);
        ctx.drawImage(sil, 0, 0);
        ctx.drawImage(sil, 0, 0);
        ctx.shadowBlur = 0;
      }
      ctx.drawImage(fg, 0, 0);
      ctx.restore();
    }
    drawAiLabel(ctx, W, H, contentId, { position: 'bottom-right' });
    raf = requestAnimationFrame(loop);
  }

  function drawBackground(W, H, mirror) {
    if (opts.bg === 'color') {
      ctx.fillStyle = opts.bgColor;
      ctx.fillRect(0, 0, W, H);
    } else if (opts.bg === 'image' && bgImage) {
      // Cover-fit, never mirrored, so text in the picture reads correctly.
      const k = Math.max(W / bgImage.naturalWidth, H / bgImage.naturalHeight);
      const iw = bgImage.naturalWidth * k, ih = bgImage.naturalHeight * k;
      ctx.drawImage(bgImage, (W - iw) / 2, (H - ih) / 2, iw, ih);
    } else {
      ctx.save();
      mirror(ctx);
      if (opts.bg === 'blur') {
        const pad = W / 40;
        ctx.filter = `blur(${Math.round(W / 70)}px)`;
        ctx.drawImage(video, -pad, -pad, W + pad * 2, H + pad * 2);
        ctx.filter = 'none';
      } else {
        ctx.drawImage(video, 0, 0, W, H);
      }
      ctx.restore();
    }
  }

  async function ensureSegmenter() {
    if (segmenter || segState === 'loading') return;
    segState = 'loading';
    drawBgStatus();
    segmenter = await getSegmenter();
    segState = segmenter ? 'ready' : 'failed';
    drawBgStatus();
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!video || detector) return;
    const r = canvas.getBoundingClientRect();
    let x = (e.clientX - r.left) / r.width;
    if (opts.mirror) x = 1 - x;
    const y = (e.clientY - r.top) / r.height;
    const w = video.videoWidth * 0.22;
    manualBox = { cx: x * video.videoWidth, cy: y * video.videoHeight, w, h: w * 1.2, angle: 0, mx: 0, my: 0.3 };
  });

  // ---------- recording ----------
  async function startRecording() {
    const limit = await checkRateLimit();
    if (!limit.ok) { toast(`You've reached today's limit of ${limit.limit} videos on your plan.`, 'error'); return; }
    const out = canvas.captureStream(30);
    stream.getAudioTracks().forEach(t => out.addTrack(t));
    const mimeType = pickRecorderMime();
    const chunks = [];
    recorder = new MediaRecorder(out, { mimeType: mimeType || undefined, videoBitsPerSecond: 5_000_000 });
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => saveRecording(new Blob(chunks, { type: (recorder?.mimeType || mimeType || 'video/webm').split(';')[0] }));
    recorder.start(500);
    recStart = Date.now();
    recBtn.replaceChildren(icon('stop'), 'Stop recording');
    recBtn.classList.add('danger');
    recTimer = setInterval(() => {
      const s = (Date.now() - recStart) / 1000;
      recInfo.replaceChildren(h('span', { class: 'rec-dot' }), `Recording ${fmtTime(s)}`);
      if (s >= MAX_RECORD_SECONDS) stopRecording();
    }, 250);
  }

  function stopRecording() {
    clearInterval(recTimer);
    recInfo.replaceChildren();
    recBtn.replaceChildren(icon('record'), 'Record');
    recBtn.classList.remove('danger');
    if (recorder?.state !== 'inactive') recorder?.stop();
  }

  async function saveRecording(blob) {
    const duration = (Date.now() - recStart) / 1000;
    recorder = null;
    const thumbCanvas = h('canvas', { width: 480, height: Math.round(480 * canvas.height / canvas.width) });
    thumbCanvas.getContext('2d').drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const rec = await put('videos', {
      id: uid('vid'),
      kind: 'generated',
      source: 'camera',
      name: `Live camera ${new Date().toLocaleString().replace(/[/:]/g, '-')}.${ext}`,
      blob,
      mime: blob.type,
      duration,
      width: canvas.width,
      height: canvas.height,
      thumb: thumbCanvas.toDataURL('image/jpeg', 0.8),
      contentId,
      faceId: opts.swap ? faceId : null,
    });
    contentId = newContentId(); // every clip gets its own traceable ID
    toast('Clip saved to your dashboard.', 'success');
    result.replaceChildren(
      h('h3', { style: { margin: 0 } }, 'Last clip'),
      h('video', { src: URL.createObjectURL(blob), controls: true, playsinline: true, style: { width: '100%', borderRadius: '12px' } }),
      h('p', { class: 'small muted', style: { margin: 0 } }, `${fmtTime(duration)} · ${fmtBytes(blob.size)} · labeled AI-generated · ${rec.contentId}`),
      h('div', { class: 'row' }, downloadButton(rec), h('a', { class: 'btn ghost', href: '#/dashboard/videos' }, 'All clips')));
  }

  camBtn.addEventListener('click', () => (stream ? stopCamera() : startCamera()));
  recBtn.addEventListener('click', () => (recorder ? stopRecording() : startRecording()));

  // ---------- controls ----------
  const toggle = (label, key) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: opts[key], onchange: (e) => { opts[key] = e.target.checked; } }), h('span', {}, label));
  const blendOut = h('output', {}, '100%');
  const bgChips = h('div', { class: 'chips' });
  const bgExtra = h('div');
  const bgStatus = h('p', { class: 'small muted', style: { margin: 0 } });
  function drawBgStatus() {
    bgStatus.textContent = {
      off: '',
      loading: 'Loading body tracking…',
      ready: 'Body tracking is on. Your body stays your own; only what\'s behind you changes.',
      failed: 'Background effects aren\'t available in this browser. Try the latest Chrome, Edge or Safari.',
    }[segState];
  }
  function drawBgControls() {
    bgChips.replaceChildren(...[['none', 'Off'], ['blur', 'Blur'], ['color', 'Colour'], ['image', 'Image']].map(([k, l]) =>
      h('button', { type: 'button', class: `chip${opts.bg === k ? ' on' : ''}`, onclick: () => { opts.bg = k; if (k !== 'none') ensureSegmenter(); drawBgControls(); } }, l)));
    bgExtra.replaceChildren(
      opts.bg === 'color' ? h('label', { class: 'row small' }, 'Colour', h('input', { type: 'color', value: opts.bgColor, oninput: (e) => { opts.bgColor = e.target.value; } })) : '',
      opts.bg === 'image' ? dropzone({ accept: 'image/*', label: bgImage ? 'Change background image' : 'Choose a background image', hint: 'Stays on this device', onFile: (f) => {
        const img = new Image();
        img.onload = () => { bgImage = img; drawBgControls(); };
        img.onerror = () => toast('That image couldn\'t be opened.', 'error');
        img.src = URL.createObjectURL(f);
      } }) : '');
  }
  drawBgControls();

  app.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Live camera'), h('p', { class: 'muted' }, 'See a saved face follow your head live on your webcam, and record clips. Every frame carries the AI-generated label.'))),
    h('div', { class: 'split' },
      h('div', {},
        stage,
        h('div', { class: 'transport', style: { flexWrap: 'wrap' } }, camBtn, recBtn, recInfo, h('span', { style: { flex: 1 } }), status),
        h('div', { class: 'card', style: { marginTop: '16px' } }, result)),
      h('div', { class: 'card stack' },
        h('h3', { style: { margin: 0 } }, 'Face'),
        faceGrid,
        dropzone({ accept: 'image/*', label: 'Add a face', hint: 'Yours, or someone who gave you written permission', onFile: async (f) => { const r = await addFace(f); if (r) { await selectFace(r.id); } } }),
        toggle('Swap the face', 'swap'),
        h('div', { class: 'kv' }, h('span', {}, 'Blend'),
          h('input', { type: 'range', min: '0.5', max: '1', step: '0.01', value: '1', oninput: (e) => { opts.strength = +e.target.value; blendOut.textContent = `${Math.round(opts.strength * 100)}%`; } }), blendOut),
        toggle('Keep my real mouth movement', 'preserveMouth'),
        toggle('Match lighting and skin tone', 'colorMatch'),
        toggle('Mirror the preview', 'mirror'),
        h('h3', { style: { margin: '8px 0 0' } }, 'Background'),
        bgChips,
        bgExtra,
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', onchange: (e) => { opts.outline = e.target.checked; if (opts.outline) ensureSegmenter(); } }),
          h('span', {}, 'Glowing outline around me'),
          h('input', { type: 'color', value: opts.outlineColor, 'aria-label': 'Outline colour', style: { marginLeft: 'auto' }, oninput: (e) => { opts.outlineColor = e.target.value; } })),
        bgStatus,
        h('div', { class: 'notice' }, icon('shield'), h('span', {}, 'The "AI-generated" label and a content ID are drawn into the bottom-right corner of every frame and every recording. The camera only works on this page and isn\'t shared with other apps.')))),
  ));
  result.append(h('p', { class: 'muted small', style: { margin: 0 } }, 'Recorded clips appear here and in Dashboard → Generated videos.'));
  await drawFaces();

  return () => { stopCamera(); };
}
