// Lays the spoken lines out in time and works out what Bobo looks like in
// every frame: mouth, blinks, head movement and the caption on screen.

import { silence, pcmDuration, envelope } from './audio.js';

export const INTRO = 0.35;   // seconds before the first word
export const GAP = 0.3;      // pause between lines
export const OUTRO = 1.6;    // "follow" card at the end
export const CHUNK_WORDS = 3;

// Splits a line into caption chunks of a few words, timed by their length.
export function chunks(line, start, end) {
  const words = line.split(/\s+/).filter(Boolean);
  const groups = [];
  for (let i = 0; i < words.length; i += CHUNK_WORDS) {
    let g = words.slice(i, i + CHUNK_WORDS);
    // Don't leave a single word dangling at the end.
    if (words.length - (i + CHUNK_WORDS) === 1) { g = words.slice(i, i + CHUNK_WORDS + 1); i += 1; }
    groups.push(g.join(' '));
  }
  const weight = (s) => s.replace(/\*/g, '').length + 2;
  const total = groups.reduce((n, g) => n + weight(g), 0);
  let t = start;
  return groups.map((text) => {
    const d = ((end - start) * weight(text)) / total;
    const c = { text, start: t, end: t + d };
    t += d;
    return c;
  });
}

// lines: [{ text, pcm, rate }] -> one audio track plus timings.
export function build(lines, fps = 30) {
  const rate = lines[0].rate;
  const parts = [silence(INTRO, rate)];
  const segments = [];
  let t = INTRO;
  for (const line of lines) {
    if (line.rate !== rate) throw new Error('All lines must share one sample rate.');
    const d = pcmDuration(line.pcm, rate);
    segments.push({ text: line.text, start: t, end: t + d, chunks: chunks(line.text, t, t + d) });
    parts.push(line.pcm, silence(GAP, rate));
    t += d + GAP;
  }
  parts.push(silence(OUTRO, rate));
  const pcm = Buffer.concat(parts);
  const duration = pcmDuration(pcm, rate);
  return { pcm, rate, segments, duration, fps, env: envelope(pcm, rate, fps), outroAt: t };
}

// Seeded random so a video always renders the same way.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export function blinkTimes(duration, seed = 7) {
  const r = rng(seed);
  const times = [];
  for (let t = 1 + r() * 2; t < duration; t += 2.5 + r() * 3) times.push(t);
  return times;
}

export function frameState(tl, frame, blinks, opts = {}) {
  const t = frame / tl.fps;
  const level = tl.env[Math.min(frame, tl.env.length - 1)] || 0;
  const prev = tl.env[Math.max(0, frame - 1)] || 0;
  const open = Math.min(1, Math.max(0, (level * 0.7 + prev * 0.3) * 1.1 - 0.05));
  const talking = level > 0.08;
  const seg = tl.segments.find((s) => t >= s.start - 0.05 && t < s.end + GAP);
  const chunk = seg?.chunks.find((c) => t >= c.start && t < c.end) || seg?.chunks.at(-1);
  const blink = blinks.some((b) => t >= b && t < b + 0.12);
  const outro = t >= tl.outroAt;
  return {
    t,
    open,
    smile: outro ? 0.9 : talking ? 0.35 : 0.6,
    blink,
    browUp: talking ? level * 0.6 : 0,
    tilt: Math.sin(t * 0.9) * 2.2,
    nod: talking ? Math.sin(t * 7) * level * 3 : 0,
    breath: Math.sin(t * 1.7) * 3,
    look: Math.sin(t * 0.37) * 0.6,
    caption: outro ? (opts.outro || 'Follow for your *daily push*') : chunk?.text || '',
  };
}

