import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../src/timeline.js';
import { fakeSpeech } from '../src/audio.js';
import { renderVideo } from '../src/render.js';

test('renders a TikTok-shaped MP4 with sound', { timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bobo-'));
  const out = join(dir, 'test.mp4');
  const tl = build([{ text: 'Start *today*.', ...fakeSpeech('Start today.') }], 30);
  await renderVideo({ timeline: tl, hook: 'Test', handle: '@clem22145', series: 'Test', outPath: out });
  const info = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'csv=p=0', out]).toString();
  assert.match(info, /video,1080,1920/);
  assert.match(info, /audio/);
  assert.equal(existsSync(out.replace('.mp4', '.wav')), false, 'temporary audio removed');
});
