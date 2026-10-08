// Makes today's Bobo videos.
//
//   GEMINI_API_KEY=... node src/make.js            3 videos into out/<date>/
//   node src/make.js --fake --count 1              dry run: sample script, test tone voice
//
// Settings (environment variables):
//   BOBO_HANDLE    your TikTok handle shown on the video (default @clem22145)
//   BOBO_VOICE     Gemini voice name (default Orus)
//   GEMINI_MODEL   model that writes the scripts (default gemini-flash-latest)
//   VIDEOS_PER_DAY how many videos (default 3)

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { planFor, writeScript, sampleScript } from './script.js';
import { speak, spoken, DEFAULT_VOICE } from './voice.js';
import { fakeSpeech } from './audio.js';
import { build } from './timeline.js';
import { renderVideo } from './render.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const fake = flag('fake');
const count = Number(opt('count', process.env.VIDEOS_PER_DAY || 3));
const date = new Date(opt('date', new Date().toISOString().slice(0, 10)));
const day = date.toISOString().slice(0, 10);
const outDir = opt('out', join('out', day));
const handle = process.env.BOBO_HANDLE || '@clem22145';
const voice = process.env.BOBO_VOICE || DEFAULT_VOICE;
const scriptModel = process.env.GEMINI_MODEL || 'gemini-flash-latest';

if (!fake && !process.env.GEMINI_API_KEY) {
  console.error('Set GEMINI_API_KEY (free at https://aistudio.google.com/apikey), or use --fake for a dry run.');
  process.exit(1);
}
const ai = fake ? null : new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

await mkdir(outDir, { recursive: true });
const posts = [];

for (let slot = 0; slot < count; slot++) {
  const plan = planFor(date, slot);
  const n = slot + 1;
  console.log(`\n[${n}/${count}] ${plan.format.id}: ${plan.topic}`);

  const script = fake ? sampleScript() : await writeScript({ ai, model: scriptModel, plan });
  console.log(`  hook: ${script.hook}`);

  const lines = [];
  for (const text of script.lines) {
    const audio = fake ? fakeSpeech(spoken(text)) : await speak({ ai, text, voice });
    lines.push({ text, ...audio });
    console.log(`  voice: ${spoken(text)}`);
  }

  const timeline = build(lines, 30);
  const file = join(outDir, `bobo-${day}-${n}.mp4`);
  await renderVideo({
    timeline, hook: script.hook, handle, series: "Bobo's Daily Push", outPath: file, seed: n * 101,
    onProgress: (p) => process.stdout.write(`\r  rendering ${Math.round(p * 100)}%   `),
  });
  console.log(`\n  saved ${file} (${timeline.duration.toFixed(1)} s)`);

  const post = `${script.caption}\n\n${script.hashtags.join(' ')} #aigenerated`;
  await writeFile(file.replace(/\.mp4$/, '.txt'), `${post}\n`);
  posts.push({ file, hook: script.hook, post });
}

// One page with every caption, ready to copy when posting.
const notes = posts.map((p, i) => `### Video ${i + 1}: ${p.hook}\n\n${p.post}\n`).join('\n');
await writeFile(join(outDir, 'captions.md'), `# Bobo videos for ${day}\n\n${notes}`);
console.log(`\nDone: ${posts.length} videos in ${outDir}`);
