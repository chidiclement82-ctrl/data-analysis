// Turns a timeline into an MP4: draws every frame of render/scene.html in a
// headless browser, pipes the frames into ffmpeg and adds the voice track.

import { spawn } from 'node:child_process';
import { writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { toWav } from './audio.js';
import { frameState, blinkTimes } from './timeline.js';

const SCENE = fileURLToPath(new URL('../render/scene.html', import.meta.url));

function launch() {
  // Use the pinned Playwright browser when installed, else a system Chromium.
  const opts = {};
  if (process.env.CHROMIUM_PATH) opts.executablePath = process.env.CHROMIUM_PATH;
  return chromium.launch(opts);
}

function ffmpeg(args) {
  const p = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
  const done = new Promise((resolve, reject) => {
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${err}`))));
  });
  return { stdin: p.stdin, done };
}

export async function renderVideo({ timeline, hook, handle, series, outPath, seed = 7, onProgress = () => {} }) {
  const wavPath = outPath.replace(/\.mp4$/, '.wav');
  await writeFile(wavPath, toWav(timeline.pcm, timeline.rate));

  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    await page.goto(`file://${SCENE}`);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate((s) => window.scene.draw(s), { hook, handle, series });

    const { fps } = timeline;
    const total = Math.ceil(timeline.duration * fps);
    const blinks = blinkTimes(timeline.duration, seed);
    const enc = ffmpeg([
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
      '-i', wavPath,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart',
      outPath,
    ]);

    for (let f = 0; f < total; f++) {
      await page.evaluate((s) => window.scene.draw(s), frameState(timeline, f, blinks));
      const jpg = await page.screenshot({ type: 'jpeg', quality: 88 });
      if (!enc.stdin.write(jpg)) await new Promise((r) => enc.stdin.once('drain', r));
      if (f % fps === 0) onProgress(f / total);
    }
    enc.stdin.end();
    await enc.done;
    onProgress(1);
  } finally {
    await browser.close();
    await rm(wavPath, { force: true }); // the voice is inside the MP4 now
  }
  return outPath;
}
