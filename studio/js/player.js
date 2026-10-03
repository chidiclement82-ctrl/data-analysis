// Timeline player and renderer. One project spec drives both the live preview
// and the HD export, so what users preview is exactly what they download.

import { compositeFace, trackAt } from './faceswap.js';
import { drawAiLabel } from './safety.js';
import { loadVideo, seek } from './ui.js';

export function defaultProject(duration) {
  return {
    segments: [{ start: 0, end: duration }],
    transition: 'fade',
    fadeIn: 0.4,
    fadeOut: 0.6,
    faceSwap: { enabled: false, preserveMouth: true, strength: 1, colorMatch: true, track: null },
    subtitles: [],
    subtitleStyle: 'boxed',
    texts: [],
    sfx: [],
    videoVolume: 1,
    musicVolume: 0.35,
    voiceVolume: 1,
    duckOriginal: true,
  };
}

export const timelineDuration = (segs) => segs.reduce((s, g) => s + Math.max(0, g.end - g.start), 0);

export function tlToSrc(segs, tl) {
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    const len = segs[i].end - segs[i].start;
    if (tl < acc + len || i === segs.length - 1) return { src: segs[i].start + Math.min(len, Math.max(0, tl - acc)), index: i };
    acc += len;
  }
  return { src: 0, index: 0 };
}

export function srcToTl(segs, src, index) {
  let acc = 0;
  for (let i = 0; i < index; i++) acc += segs[i].end - segs[i].start;
  return acc + (src - segs[index].start);
}

function joins(segs) {
  const out = [];
  let acc = 0;
  for (let i = 0; i < segs.length - 1; i++) { acc += segs[i].end - segs[i].start; out.push(acc); }
  return out;
}

// --- Synthesized sound effects (no asset files needed, and they export cleanly) ---
export const SFX = { whoosh: 'Whoosh', pop: 'Pop', ding: 'Ding', boom: 'Boom', click: 'Click' };

function playSfx(ac, out, kind, when = ac.currentTime) {
  const g = ac.createGain();
  g.connect(out);
  const noise = () => {
    const len = Math.floor(ac.sampleRate * 0.8);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const s = ac.createBufferSource();
    s.buffer = buf;
    return s;
  };
  if (kind === 'whoosh') {
    const s = noise(), f = ac.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, when); f.frequency.exponentialRampToValueAtTime(3500, when + 0.45);
    g.gain.setValueAtTime(0.001, when); g.gain.exponentialRampToValueAtTime(0.7, when + 0.2); g.gain.exponentialRampToValueAtTime(0.001, when + 0.6);
    s.connect(f).connect(g); s.start(when); s.stop(when + 0.7);
  } else if (kind === 'boom') {
    const o = ac.createOscillator();
    o.frequency.setValueAtTime(120, when); o.frequency.exponentialRampToValueAtTime(35, when + 0.6);
    g.gain.setValueAtTime(1, when); g.gain.exponentialRampToValueAtTime(0.001, when + 0.8);
    o.connect(g); o.start(when); o.stop(when + 0.85);
  } else if (kind === 'ding') {
    [880, 1320].forEach((fq, i) => {
      const o = ac.createOscillator(), og = ac.createGain();
      o.type = 'sine'; o.frequency.value = fq;
      og.gain.setValueAtTime(0.35 / (i + 1), when); og.gain.exponentialRampToValueAtTime(0.001, when + 1.2);
      o.connect(og).connect(g); o.start(when); o.stop(when + 1.25);
    });
  } else if (kind === 'pop') {
    const o = ac.createOscillator();
    o.frequency.setValueAtTime(600, when); o.frequency.exponentialRampToValueAtTime(140, when + 0.08);
    g.gain.setValueAtTime(0.6, when); g.gain.exponentialRampToValueAtTime(0.001, when + 0.12);
    o.connect(g); o.start(when); o.stop(when + 0.15);
  } else {
    const s = noise(), f = ac.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 2000;
    g.gain.setValueAtTime(0.5, when); g.gain.exponentialRampToValueAtTime(0.001, when + 0.03);
    s.connect(f).connect(g); s.start(when); s.stop(when + 0.05);
  }
}

function wrap(ctx, text, maxW) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export class Player {
  constructor(canvas, { onTime, onEnd, exporting = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.onTime = onTime;
    this.onEnd = onEnd;
    this.exporting = exporting;
    this.playing = false;
    this.split = null; // before/after divider position (0–1), or null
    this.tl = 0;
    this.lastTl = 0;
  }

  /** assets: { videoUrl, face, narrationUrl, musicUrl, contentId } */
  async load(project, assets) {
    this.project = project;
    this.assets = assets;
    this.video = await loadVideo(assets.videoUrl, { muted: !this.exporting });
    this.video.muted = false;
    this.video.volume = 1;
    this.narration = assets.narrationUrl ? Object.assign(new Audio(assets.narrationUrl), { preload: 'auto' }) : null;
    this.music = assets.musicUrl ? Object.assign(new Audio(assets.musicUrl), { preload: 'auto', loop: true }) : null;
    // Original footage for the "Before" side when the main video is an AI-swapped copy.
    this.before = assets.beforeUrl ? await loadVideo(assets.beforeUrl, { muted: true }) : null;
    this.vw = this.video.videoWidth;
    this.vh = this.video.videoHeight;
    if (!this.canvas.width || this.exporting === false) { this.canvas.width = this.vw; this.canvas.height = this.vh; }
    await this.seek(0);
  }

  setProject(project) { this.project = project; if (!this.playing) this.draw(); }

  get duration() { return timelineDuration(this.project.segments); }

  ensureAudio() {
    if (this.ac) return;
    const ac = this.ac = new AudioContext();
    this.master = ac.createGain();
    if (this.exporting) {
      this.streamDest = ac.createMediaStreamDestination();
      this.master.connect(this.streamDest);
    } else {
      this.master.connect(ac.destination);
    }
    const hook = (el) => { const g = ac.createGain(); ac.createMediaElementSource(el).connect(g).connect(this.master); return g; };
    this.videoGain = hook(this.video);
    if (this.narration) this.voiceGain = hook(this.narration);
    if (this.music) this.musicGain = hook(this.music);
    this.sfxOut = ac.createGain();
    this.sfxOut.connect(this.master);
  }

  applyVolumes() {
    if (!this.ac) return;
    const p = this.project;
    const narrating = this.narration && !this.narration.paused && !this.narration.ended;
    const duck = p.duckOriginal && (narrating || (this.speaking && !this.exporting)) ? 0.3 : 1;
    this.videoGain.gain.value = p.videoVolume * duck;
    if (this.voiceGain) this.voiceGain.gain.value = p.voiceVolume;
    if (this.musicGain) this.musicGain.gain.value = p.musicVolume * (narrating ? 0.6 : 1);
  }

  async seek(tl) {
    const segs = this.project.segments;
    this.tl = Math.max(0, Math.min(tl, this.duration - 0.001));
    this.lastTl = this.tl;
    const { src, index } = tlToSrc(segs, this.tl);
    this.segIndex = index;
    await Promise.all([seek(this.video, src), this.before && seek(this.before, src)]);
    this.syncAux();
    this.draw();
    this.onTime?.(this.tl);
  }

  syncAux() {
    const off = this.project.narrationOffset || 0;
    if (this.narration) {
      const nt = this.tl - off;
      if (nt < 0 || (this.narration.duration && nt >= this.narration.duration)) { this.narration.pause(); }
      else {
        if (Math.abs(this.narration.currentTime - nt) > 0.25) this.narration.currentTime = nt;
        if (this.playing && this.narration.paused) this.narration.play().catch(() => {});
      }
    }
    if (this.music && this.music.duration) {
      const mt = this.tl % this.music.duration;
      if (Math.abs(this.music.currentTime - mt) > 0.3) this.music.currentTime = mt;
      if (this.playing && this.music.paused) this.music.play().catch(() => {});
    }
  }

  async play() {
    if (this.playing) return;
    this.ensureAudio();
    await this.ac.resume();
    if (this.tl >= this.duration - 0.05) await this.seek(0);
    this.playing = true;
    this.applyVolumes();
    await this.video.play();
    this.before?.play().catch(() => {});
    this.syncAux();
    if (!this.exporting && this.assets.browserSpeech && this.tl < 0.3) {
      this.speaking = true;
      this.assets.browserSpeech().then(() => { this.speaking = false; });
    }
    const loop = () => {
      if (!this.playing) return;
      this.tick();
      this.raf = requestAnimationFrame(loop);
    };
    if (this.exporting && this.video.requestVideoFrameCallback) {
      const vloop = () => { if (!this.playing) return; this.tick(); this.video.requestVideoFrameCallback(vloop); };
      this.video.requestVideoFrameCallback(vloop);
      // Timer backup in case frame callbacks stall (e.g. a static video segment).
      this.timer = setInterval(() => this.playing && this.tick(), 100);
    } else {
      this.raf = requestAnimationFrame(loop);
    }
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    clearInterval(this.timer);
    this.video.pause();
    this.before?.pause();
    this.narration?.pause();
    this.music?.pause();
    if (this.speaking) { speechSynthesis.cancel(); this.speaking = false; }
  }

  tick() {
    const segs = this.project.segments;
    let seg = segs[this.segIndex];
    if (!seg) return;
    if (this.video.currentTime >= seg.end - 0.03 || this.video.ended) {
      if (this.segIndex < segs.length - 1) {
        this.segIndex++;
        this.video.currentTime = segs[this.segIndex].start;
        if (this.before) this.before.currentTime = segs[this.segIndex].start;
        seg = segs[this.segIndex];
      } else {
        this.tl = this.duration;
        this.draw();
        this.pause();
        this.onTime?.(this.tl);
        this.onEnd?.();
        return;
      }
    }
    this.tl = srcToTl(segs, Math.max(seg.start, this.video.currentTime), this.segIndex);
    // Fire sound effects that fall inside this tick.
    if (this.ac) {
      for (const fx of this.project.sfx) if (fx.t > this.lastTl && fx.t <= this.tl) playSfx(this.ac, this.sfxOut, fx.kind);
    }
    this.lastTl = this.tl;
    if (this.before && Math.abs(this.before.currentTime - this.video.currentTime) > 0.12) this.before.currentTime = this.video.currentTime;
    this.syncAux();
    this.applyVolumes();
    this.draw();
    this.onTime?.(this.tl);
  }

  draw() {
    const { ctx, canvas, project: p, video } = this;
    if (!video) return;
    const W = canvas.width, H = canvas.height;
    const sx = W / this.vw, sy = H / this.vh;
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(video, 0, 0, W, H);

    const fs = p.faceSwap;
    if (fs?.enabled && fs.track && this.assets.face) {
      const pos = trackAt(fs.track, video.currentTime);
      compositeFace(ctx, video, this.assets.face, pos, { sx, sy, preserveMouth: fs.preserveMouth, strength: fs.strength, colorMatch: fs.colorMatch });
    }

    if (this.split != null) {
      const x = W * this.split;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, x, H); ctx.clip();
      ctx.drawImage(this.before || video, 0, 0, W, H);
      ctx.restore();
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - 1, 0, 2, H);
      const f = Math.max(12, H * 0.028);
      ctx.font = `600 ${f}px Inter, system-ui, sans-serif`;
      ctx.textBaseline = 'bottom';
      const tag = (t, tx, align) => {
        ctx.textAlign = align;
        const tw = ctx.measureText(t).width;
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        const bx = align === 'left' ? tx : tx - tw - f;
        ctx.beginPath(); ctx.roundRect(bx, H - f * 2.6, tw + f, f * 1.8, f * 0.4); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(t, align === 'left' ? tx + f / 2 : tx - f / 2, H - f * 1.15);
      };
      tag('Before', f * 0.8, 'left');
      tag('After', W - f * 0.8, 'right');
      ctx.textAlign = 'left';
    }

    const tl = this.tl;
    const D = this.duration;
    this.drawTexts(tl, W, H);
    this.drawSubtitle(tl, W, H);

    // Transitions: fade from/to black, and a dip at each cut.
    let dim = 0, flash = 0;
    if (p.fadeIn > 0 && tl < p.fadeIn) dim = Math.max(dim, 1 - tl / p.fadeIn);
    if (p.fadeOut > 0 && tl > D - p.fadeOut) dim = Math.max(dim, (tl - (D - p.fadeOut)) / p.fadeOut);
    if (p.transition !== 'none') {
      for (const j of joins(p.segments)) {
        const d = Math.abs(tl - j);
        if (d < 0.3) {
          const a = 1 - d / 0.3;
          if (p.transition === 'flash') flash = Math.max(flash, a); else dim = Math.max(dim, a * 0.95);
        }
      }
    }
    if (dim > 0) { ctx.fillStyle = `rgba(0,0,0,${Math.min(1, dim)})`; ctx.fillRect(0, 0, W, H); }
    if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash * 0.85})`; ctx.fillRect(0, 0, W, H); }

    drawAiLabel(ctx, W, H, this.assets.contentId);
  }

  drawTexts(tl, W, H) {
    const ctx = this.ctx;
    for (const t of this.project.texts) {
      if (tl < t.start || tl > t.end || !t.text) continue;
      const age = tl - t.start, left = t.end - tl;
      const a = Math.min(1, age / 0.3, left / 0.3);
      const size = H * (t.size || 0.07);
      ctx.save();
      ctx.globalAlpha = Math.max(0, a);
      ctx.font = `800 ${size}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const y = t.position === 'top' ? H * 0.15 : t.position === 'bottom' ? H * 0.72 : H * 0.5;
      let dy = 0, scale = 1;
      if (t.anim === 'slide') dy = (1 - Math.min(1, age / 0.4)) * H * 0.06;
      if (t.anim === 'pop') scale = 0.7 + 0.3 * Math.min(1, age / 0.25) + Math.sin(Math.min(1, age / 0.25) * Math.PI) * 0.08;
      ctx.translate(W / 2, y + dy);
      ctx.scale(scale, scale);
      const lines = wrap(ctx, t.text, W * 0.86);
      lines.forEach((ln, i) => {
        const ly = (i - (lines.length - 1) / 2) * size * 1.15;
        ctx.lineWidth = size * 0.14;
        ctx.strokeStyle = 'rgba(0,0,0,.55)';
        ctx.lineJoin = 'round';
        ctx.strokeText(ln, 0, ly);
        ctx.fillStyle = t.color || '#ffffff';
        ctx.fillText(ln, 0, ly);
      });
      ctx.restore();
    }
  }

  drawSubtitle(tl, W, H) {
    const sub = this.project.subtitles.find(s => tl >= s.start && tl <= s.end);
    if (!sub?.text) return;
    const ctx = this.ctx;
    const size = Math.max(14, H * 0.045);
    ctx.save();
    ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = wrap(ctx, sub.text, W * 0.8);
    const lh = size * 1.3;
    const top = H * 0.9 - lines.length * lh;
    if (this.project.subtitleStyle === 'boxed') {
      const bw = Math.max(...lines.map(l => ctx.measureText(l).width)) + size * 1.2;
      ctx.fillStyle = 'rgba(0,0,0,.62)';
      ctx.beginPath(); ctx.roundRect((W - bw) / 2, top - size * 0.35, bw, lines.length * lh + size * 0.5, size * 0.35); ctx.fill();
    }
    lines.forEach((ln, i) => {
      const y = top + lh * i + lh / 2 - size * 0.1;
      if (this.project.subtitleStyle !== 'boxed') { ctx.lineWidth = size * 0.18; ctx.strokeStyle = '#000'; ctx.strokeText(ln, W / 2, y); }
      ctx.fillStyle = this.project.subtitleStyle === 'yellow' ? '#ffd84d' : '#fff';
      ctx.fillText(ln, W / 2, y);
    });
    ctx.restore();
  }

  destroy() {
    this.pause();
    this.ac?.close();
    for (const v of [this.video, this.before]) { v?.removeAttribute('src'); v?.load(); }
  }
}

export function pickRecorderMime() {
  const options = [
    'video/mp4;codecs=avc1.640028,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return options.find(m => window.MediaRecorder?.isTypeSupported?.(m)) || '';
}

/**
 * Renders the project to a video file in real time (the browser plays the
 * timeline once while recording). height: 720 or 1080.
 */
export async function exportVideo(project, assets, { height = 720, onProgress, signal } = {}) {
  const canvas = document.createElement('canvas');
  const player = new Player(canvas, { exporting: true });
  await player.load(project, assets);
  const outH = Math.min(height, player.vh * 2);
  const outW = Math.round(player.vw * outH / player.vh / 2) * 2;
  canvas.width = outW;
  canvas.height = Math.round(outH / 2) * 2;
  await player.seek(0);

  player.ensureAudio();
  const stream = canvas.captureStream(30);
  player.streamDest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
  const mimeType = pickRecorderMime();
  const bitrate = canvas.height >= 1080 ? 8_000_000 : 5_000_000;
  const rec = new MediaRecorder(stream, { mimeType: mimeType || undefined, videoBitsPerSecond: bitrate, audioBitsPerSecond: 160_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  return new Promise((resolve, reject) => {
    const finish = () => {
      rec.onstop = () => {
        player.destroy();
        stream.getTracks().forEach(t => t.stop());
        const type = (rec.mimeType || mimeType || 'video/webm').split(';')[0];
        resolve({ blob: new Blob(chunks, { type }), width: canvas.width, height: canvas.height, mime: type });
      };
      rec.stop();
    };
    player.onTime = (t) => onProgress?.(Math.min(1, t / player.duration));
    player.onEnd = () => setTimeout(finish, 250);
    signal?.addEventListener('abort', () => {
      player.onEnd = null;
      rec.onstop = () => { player.destroy(); stream.getTracks().forEach(t => t.stop()); reject(new DOMException('Export cancelled', 'AbortError')); };
      player.pause();
      rec.stop();
    });
    rec.start(500);
    player.play().catch(reject);
  });
}
