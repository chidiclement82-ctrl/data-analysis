// Live person segmentation (MediaPipe selfie segmenter) for background effects:
// returns a soft mask canvas where alpha = how likely each pixel is the person.

import { loadVision } from './faceswap.js';

const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
const INPUT_W = 256; // segment a small copy of the frame: fast, and the soft upscale smooths edges

let segmenterPromise;

/** Resolves with a segmenter, or null if it can't run in this browser. */
export function getSegmenter() {
  segmenterPromise ??= (async () => {
    try {
      const { vision, fileset } = await loadVision();
      const seg = await vision.ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL },
        runningMode: 'VIDEO',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
      return createRunner(seg);
    } catch (e) {
      console.warn('Person segmentation unavailable:', e);
      return null;
    }
  })();
  return segmenterPromise;
}

function createRunner(seg) {
  const input = document.createElement('canvas');
  const ictx = input.getContext('2d', { willReadFrequently: true });
  const mask = document.createElement('canvas');
  const mctx = mask.getContext('2d');
  let lastTs = 0;
  let img = null;

  return {
    mask,
    /** Segments the frame; updates and returns `mask` (sized like the small input). */
    update(frame, fw, fh) {
      const iw = INPUT_W, ih = Math.max(1, Math.round(INPUT_W * fh / fw));
      if (input.width !== iw || input.height !== ih) { input.width = mask.width = iw; input.height = mask.height = ih; img = null; }
      ictx.drawImage(frame, 0, 0, iw, ih);
      const ts = Math.max(lastTs + 1, performance.now());
      lastTs = ts;
      const res = seg.segmentForVideo(input, ts);
      const m = res.confidenceMasks?.[0];
      if (m) {
        const conf = m.getAsFloat32Array();
        img ??= mctx.createImageData(iw, ih);
        const d = img.data;
        for (let i = 0, j = 3; i < conf.length; i++, j += 4) {
          // Sharpen the edge a little: below 0.3 is background, above 0.7 fully person.
          const a = Math.min(1, Math.max(0, (conf[i] - 0.3) / 0.4));
          d[j] = a * 255;
        }
        mctx.putImageData(img, 0, 0);
      }
      res.confidenceMasks?.forEach(x => x.close());
      return mask;
    },
  };
}
