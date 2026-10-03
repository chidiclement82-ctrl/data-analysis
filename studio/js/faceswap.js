// In-browser face swap engine.
//
// 1. Detects faces with MediaPipe (loaded on demand from a CDN), falling back to the
//    browser's built-in FaceDetector, and finally to a box the user places by hand.
// 2. Tracks the target face through the video and smooths the track so the new
//    face follows head movement and tilt without jitter.
// 3. Composites the user's face onto each frame with a feathered mask, per-frame
//    color/lighting matching, and an optional cut-out that keeps the original
//    mouth so speech and expressions still come through.
//
// This is the instant preview engine. When a cloud provider is configured
// (Account → AI provider), the full-quality generative swap runs there instead.

import { seek } from './ui.js';

const MP_VERSION = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

let detectorPromise;

export function getDetector() {
  if (detectorPromise) return detectorPromise;
  detectorPromise = (async () => {
    try {
      const vision = await import(/* @vite-ignore */ `${MP_BASE}/vision_bundle.mjs`);
      const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
      const fd = await vision.FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MP_MODEL },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.45,
      });
      return {
        kind: 'mediapipe',
        async detect(src) {
          const { width, height } = sourceSize(src);
          return fd.detect(src).detections.map(d => {
            const b = d.boundingBox;
            const kp = (d.keypoints || []).map(k => ({ x: k.x * width, y: k.y * height }));
            return {
              x: b.originX, y: b.originY, w: b.width, h: b.height,
              score: d.categories?.[0]?.score ?? 1,
              // MediaPipe keypoints: 0 right eye, 1 left eye, 2 nose, 3 mouth
              eyes: kp.length >= 2 ? [kp[0], kp[1]] : null,
              mouth: kp[3] || null,
            };
          });
        },
      };
    } catch (e) {
      console.warn('MediaPipe face detector unavailable:', e);
    }
    if ('FaceDetector' in window) {
      try {
        const fd = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 6 });
        return {
          kind: 'native',
          async detect(src) {
            const faces = await fd.detect(src);
            return faces.map(f => {
              const lm = f.landmarks || [];
              const eyes = lm.filter(l => l.type === 'eye').map(l => l.locations[0]);
              const mouth = lm.find(l => l.type === 'mouth')?.locations[0] || null;
              return { x: f.boundingBox.x, y: f.boundingBox.y, w: f.boundingBox.width, h: f.boundingBox.height, score: 1,
                eyes: eyes.length === 2 ? eyes.sort((a, b) => a.x - b.x) : null, mouth };
            });
          },
        };
      } catch (e) { console.warn('Native FaceDetector failed:', e); }
    }
    return null;
  })();
  return detectorPromise;
}

function sourceSize(src) {
  return {
    width: src.videoWidth || src.naturalWidth || src.width,
    height: src.videoHeight || src.naturalHeight || src.height,
  };
}

function eyeAngle(face) {
  if (!face.eyes) return 0;
  const [a, b] = face.eyes[0].x < face.eyes[1].x ? face.eyes : [face.eyes[1], face.eyes[0]];
  return Math.atan2(b.y - a.y, b.x - a.x);
}

const EXPAND = 1.3; // crop margin around the detected face box

/**
 * Turns a face photo into a reusable source face: a crop around the face plus
 * its average color and head tilt. Returns null for `face` if none was found.
 */
export async function prepareSourceFace(img) {
  const detector = await getDetector();
  const { width, height } = sourceSize(img);
  let face = null;
  if (detector) {
    const faces = await detector.detect(img);
    face = faces.sort((a, b) => b.w * b.h - a.w * a.h)[0] || null;
  }
  const detected = !!face;
  if (!face) {
    // Assume a centered portrait selfie.
    const s = Math.min(width, height) * 0.5;
    face = { x: (width - s) / 2, y: (height - s * 1.15) / 2.2, w: s, h: s * 1.15, eyes: null, mouth: null };
  }
  const cw = face.w * EXPAND;
  const ch = face.h * EXPAND;
  const cx = face.x + face.w / 2;
  const cy = face.y + face.h / 2;
  const out = Math.min(512, Math.max(cw, ch));
  const crop = document.createElement('canvas');
  crop.width = Math.round(out * cw / Math.max(cw, ch));
  crop.height = Math.round(out * ch / Math.max(cw, ch));
  const c = crop.getContext('2d', { willReadFrequently: true });
  c.drawImage(img, cx - cw / 2, cy - ch / 2, cw, ch, 0, 0, crop.width, crop.height);
  return { crop, angle: eyeAngle(face), mean: meanColor(c, crop.width, crop.height), detected, aspect: face.h / face.w };
}

function meanColor(ctx, w, hgt) {
  // Average of the central face area (skin), ignoring hair/background at the edges.
  const x0 = Math.floor(w * 0.3), y0 = Math.floor(hgt * 0.3);
  const data = ctx.getImageData(x0, y0, Math.max(1, Math.floor(w * 0.4)), Math.max(1, Math.floor(hgt * 0.4))).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 16) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
  return n ? [r / n, g / n, b / n] : [128, 128, 128];
}

/**
 * Scans the video and returns a smoothed track of the target face.
 * `pick` chooses which face on the first frame to follow: 'largest' or {x,y} in video pixels.
 */
export async function analyzeVideo(video, { fps = 8, pick = 'largest', onProgress, signal } = {}) {
  const detector = await getDetector();
  const duration = video.duration;
  const frames = [];
  const step = 1 / fps;
  let prev = null;
  const wasPaused = video.paused;
  video.pause();
  const total = Math.max(1, Math.ceil(duration / step));
  for (let i = 0; i <= total; i++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const t = Math.min(duration - 0.01, i * step);
    await seek(video, t);
    let face = null;
    if (detector) {
      const faces = await detector.detect(video);
      face = choose(faces, prev, pick);
    }
    frames.push(face ? { t, ...toTrackPoint(face) } : { t, missing: true });
    if (face) prev = face;
    onProgress?.(i / total);
  }
  if (!wasPaused) video.play();
  const found = frames.filter(f => !f.missing).length;
  return { frames: smooth(fillGaps(frames)), coverage: frames.length ? found / frames.length : 0, detector: detector?.kind || 'manual' };
}

function choose(faces, prev, pick) {
  if (!faces.length) return null;
  if (prev) {
    // Follow the face closest to where the target was last seen.
    const pc = { x: prev.x + prev.w / 2, y: prev.y + prev.h / 2 };
    return faces.reduce((best, f) => {
      const d = Math.hypot(f.x + f.w / 2 - pc.x, f.y + f.h / 2 - pc.y);
      return !best || d < best.d ? { f, d } : best;
    }, null).f;
  }
  if (pick && typeof pick === 'object') {
    return faces.reduce((best, f) => {
      const d = Math.hypot(f.x + f.w / 2 - pick.x, f.y + f.h / 2 - pick.y);
      return !best || d < best.d ? { f, d } : best;
    }, null).f;
  }
  return faces.sort((a, b) => b.w * b.h - a.w * a.h)[0];
}

function toTrackPoint(face) {
  const cx = face.x + face.w / 2;
  const cy = face.y + face.h / 2;
  return {
    cx, cy, w: face.w, h: face.h,
    angle: eyeAngle(face),
    // Mouth position relative to the face box, for the expression cut-out.
    mx: face.mouth ? (face.mouth.x - cx) / face.w : 0,
    my: face.mouth ? (face.mouth.y - cy) / face.h : 0.3,
  };
}

const KEYS = ['cx', 'cy', 'w', 'h', 'angle', 'mx', 'my'];

// Interpolates short gaps (≤ 0.75s) where detection missed a frame; longer gaps stay empty.
function fillGaps(frames) {
  const out = frames.map(f => ({ ...f }));
  let i = 0;
  while (i < out.length) {
    if (!out[i].missing) { i++; continue; }
    let j = i;
    while (j < out.length && out[j].missing) j++;
    const a = out[i - 1], b = out[j];
    if (a && b && b.t - a.t <= 0.75) {
      for (let k = i; k < j; k++) {
        const u = (out[k].t - a.t) / (b.t - a.t);
        const p = { t: out[k].t };
        for (const key of KEYS) p[key] = a[key] + (b[key] - a[key]) * u;
        out[k] = p;
      }
    }
    i = j;
  }
  return out;
}

// Centered moving average to remove detector jitter.
function smooth(frames, radius = 2) {
  return frames.map((f, i) => {
    if (f.missing) return f;
    const p = { t: f.t };
    for (const key of KEYS) {
      let sum = 0, n = 0;
      for (let k = i - radius; k <= i + radius; k++) {
        const g = frames[k];
        if (g && !g.missing) { sum += g[key]; n++; }
      }
      p[key] = sum / n;
    }
    return p;
  });
}

/** Face position at time t (seconds in the source video), or null. */
export function trackAt(track, t) {
  const f = track?.frames;
  if (!f?.length) return null;
  if (t <= f[0].t) return f[0].missing ? null : f[0];
  let lo = 0, hi = f.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (f[mid].t <= t) lo = mid; else hi = mid; }
  const a = f[lo], b = f[hi];
  if (a.missing || b.missing) return a.missing ? null : (t - a.t < 0.15 ? a : null);
  const u = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t || 1)));
  const p = {};
  for (const key of KEYS) p[key] = a[key] + (b[key] - a[key]) * u;
  return p;
}

/** A static track for videos where no face could be detected: the user positions the box. */
export function manualTrack(duration, box) {
  return { frames: [{ t: 0, ...box, angle: 0, mx: 0, my: 0.3 }, { t: duration, ...box, angle: 0, mx: 0, my: 0.3 }], coverage: 1, detector: 'manual' };
}

// Scratch canvases reused across frames.
const work = document.createElement('canvas');
const wctx = work.getContext('2d', { willReadFrequently: true });
const probe = document.createElement('canvas');
probe.width = probe.height = 12;
const pctx = probe.getContext('2d', { willReadFrequently: true });

/**
 * Draws the source face over the target face on ctx (already holding the frame).
 * `frame` is the video/canvas the frame came from (used to sample lighting);
 * sx/sy scale video pixels to canvas pixels.
 */
export function compositeFace(ctx, frame, source, p, { sx = 1, sy = 1, preserveMouth = true, strength = 1, colorMatch = true } = {}) {
  if (!p || !source) return;
  const dw = Math.max(8, Math.round(p.w * EXPAND * sx));
  const dh = Math.max(8, Math.round(p.w * EXPAND * sx * (source.crop.height / source.crop.width)));
  // Keep the work canvas small: quality is bounded by the source crop anyway.
  const k = Math.min(1, 360 / Math.max(dw, dh));
  const ww = Math.max(4, Math.round(dw * k)), wh = Math.max(4, Math.round(dh * k));
  if (work.width !== ww || work.height !== wh) { work.width = ww; work.height = wh; }
  wctx.globalCompositeOperation = 'source-over';
  wctx.clearRect(0, 0, ww, wh);
  wctx.drawImage(source.crop, 0, 0, ww, wh);

  if (colorMatch) {
    // Match the target face's lighting: sample the target skin and scale each channel.
    pctx.drawImage(frame, p.cx - p.w * 0.2, p.cy - p.h * 0.15, p.w * 0.4, p.h * 0.35, 0, 0, 12, 12);
    const d = pctx.getImageData(0, 0, 12, 12).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    const gain = [r / n, g / n, b / n].map((v, i) => Math.min(1.8, Math.max(0.55, (v + 6) / (source.mean[i] + 6))));
    const img = wctx.getImageData(0, 0, ww, wh);
    const px = img.data;
    const mix = 0.8; // keep a little of the source's own tone
    const gr = 1 + (gain[0] - 1) * mix, gg = 1 + (gain[1] - 1) * mix, gb = 1 + (gain[2] - 1) * mix;
    for (let i = 0; i < px.length; i += 4) { px[i] *= gr; px[i + 1] *= gg; px[i + 2] *= gb; }
    wctx.putImageData(img, 0, 0);
  }

  // Feathered oval mask so edges blend into the target's hairline and jaw.
  wctx.globalCompositeOperation = 'destination-in';
  const rx = ww * 0.36, ry = wh * 0.42;
  wctx.save();
  wctx.translate(ww / 2, wh / 2 + wh * 0.02);
  wctx.scale(1, ry / rx);
  const grad = wctx.createRadialGradient(0, 0, rx * 0.62, 0, 0, rx);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  wctx.fillStyle = grad;
  wctx.fillRect(-ww, -wh * 2, ww * 2, wh * 4);
  wctx.restore();

  if (preserveMouth) {
    // Let the original mouth show through so lip movement and expressions stay natural.
    wctx.globalCompositeOperation = 'destination-out';
    const mx = ww / 2 + p.mx * ww / EXPAND;
    const my = wh / 2 + p.my * wh / EXPAND;
    const mrx = ww * 0.15, mry = wh * 0.085;
    wctx.save();
    wctx.translate(mx, my);
    wctx.scale(1, mry / mrx);
    const mg = wctx.createRadialGradient(0, 0, mrx * 0.35, 0, 0, mrx);
    mg.addColorStop(0, 'rgba(0,0,0,0.92)');
    mg.addColorStop(1, 'rgba(0,0,0,0)');
    wctx.fillStyle = mg;
    wctx.fillRect(-mrx, -mrx, mrx * 2, mrx * 2);
    wctx.restore();
  }
  wctx.globalCompositeOperation = 'source-over';

  ctx.save();
  ctx.globalAlpha = strength;
  ctx.translate(p.cx * sx, p.cy * sy);
  ctx.rotate(p.angle - (source.angle || 0));
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(work, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}
