// Small helpers for 16-bit mono PCM audio: silence, joining, WAV files, and
// the loudness envelope that drives Bobo's mouth.

export function silence(seconds, rate) {
  return Buffer.alloc(Math.round(seconds * rate) * 2);
}

export function pcmDuration(pcm, rate) {
  return pcm.length / 2 / rate;
}

export function toWav(pcm, rate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);      // fmt chunk size
  header.writeUInt16LE(1, 20);       // PCM
  header.writeUInt16LE(1, 22);       // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); // bytes per second
  header.writeUInt16LE(2, 32);       // bytes per sample
  header.writeUInt16LE(16, 34);      // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// Loudness (0..1) for each video frame, normalised so the loudest speech is ~1.
export function envelope(pcm, rate, fps) {
  const samples = pcm.length / 2;
  const per = rate / fps;
  const frames = Math.ceil(samples / per);
  const out = new Float32Array(frames);
  let peak = 0;
  for (let f = 0; f < frames; f++) {
    const start = Math.floor(f * per);
    const end = Math.min(samples, Math.floor((f + 1) * per));
    let sum = 0;
    for (let i = start; i < end; i++) {
      const v = pcm.readInt16LE(i * 2) / 32768;
      sum += v * v;
    }
    const rms = end > start ? Math.sqrt(sum / (end - start)) : 0;
    out[f] = rms;
    if (rms > peak) peak = rms;
  }
  if (peak > 0) for (let f = 0; f < frames; f++) out[f] = Math.min(1, out[f] / (peak * 0.8));
  return out;
}

// A stand-in "voice" for tests and dry runs: syllable-like tone bursts.
export function fakeSpeech(text, rate = 24000) {
  const words = text.split(/\s+/).filter(Boolean).length || 1;
  const seconds = 0.35 + words * 0.32;
  const pcm = Buffer.alloc(Math.round(seconds * rate) * 2);
  for (let i = 0; i < pcm.length / 2; i++) {
    const t = i / rate;
    const syllable = Math.max(0, Math.sin(t * Math.PI * 6)); // ~6 syllables per second
    const v = Math.sin(2 * Math.PI * 160 * t) * syllable * 0.5;
    pcm.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  return { pcm, rate };
}
