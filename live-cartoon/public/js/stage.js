// Cartoon stage: animates the character and speaks what the server sends.
//
// URL options (add to /stage?...):
//   bg=transparent | green   background for overlays or chroma key
//   autostart=1              skip the "tap to start" screen (OBS browser source)
//   voice=Samantha           part of a browser voice name to use
//   pitch=1.3  rate=1.05     browser voice pitch and speed
//   listen=0                 don't listen on this phone (e.g. a second phone does it)

import { getKey, askForKey } from './key.js';
import { openChannel, needsKey } from './channel.js';
import { createListener, canListen } from './listener.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const svg = document.querySelector('.cartoon svg');
const cartoon = $('cartoon');

if (params.get('bg')) document.body.classList.add(`bg-${params.get('bg')}`);

// ---------------------------------------------------------------- face

const EMOTIONS = {
  // brow tilt (deg, left brow; right is mirrored), brow lift (px), smile (-1..1)
  happy:     { tilt: -6,  lift: 0,   smile: 0.8 },
  excited:   { tilt: -12, lift: -14, smile: 1, wave: true },
  thinking:  { tilt: 12,  lift: -6,  smile: -0.1, asym: true },
  surprised: { tilt: 0,   lift: -22, smile: 0.1 },
  laughing:  { tilt: -10, lift: -8,  smile: 1, wave: true },
  sad:       { tilt: -18, lift: 4,   smile: -0.8 },
  cool:      { tilt: 8,   lift: 0,   smile: 0.5 },
  love:      { tilt: -8,  lift: -6,  smile: 0.9 },
};
let emotion = 'happy';

function setEmotion(name) {
  emotion = EMOTIONS[name] ? name : 'happy';
  const e = EMOTIONS[emotion];
  for (const k of Object.keys(EMOTIONS)) svg.classList.toggle(`e-${k}`, k === emotion);
  cartoon.classList.toggle('wave', Boolean(e.wave));
  $('browL').style.transform = `translateY(${e.lift}px) rotate(${e.tilt}deg)`;
  $('browR').style.transform = `translateY(${e.asym ? e.lift - 12 : e.lift}px) rotate(${e.asym ? 6 : -e.tilt}deg)`;
}

// Mouth shape from how open it is (0..1) and the current smile.
let open = 0;
let target = 0;
function drawMouth() {
  const smile = EMOTIONS[emotion].smile;
  const w = 46 + open * 8 + Math.max(0, smile) * 10;
  const curve = smile * 22;
  const drop = curve + 6 + open * 70 + (emotion === 'surprised' ? 30 : 0);
  const top = `M ${-w} 0 Q 0 ${curve * 0.6 - open * 6} ${w} 0`;
  const d = `${top} Q 0 ${Math.max(drop, curve * 0.6 + 4)} ${-w} 0 Z`;
  $('mouth').setAttribute('d', d);
  $('mouthClipPath').setAttribute('d', d);
  $('tongue').setAttribute('cy', String(20 + open * 40));
}

// Blinking and looking around.
function blinkLoop() {
  svg.classList.add('blink');
  setTimeout(() => svg.classList.remove('blink'), 120);
  setTimeout(blinkLoop, 2200 + Math.random() * 3500);
}
function lookLoop() {
  const x = emotion === 'thinking' ? 10 : (Math.random() - 0.5) * 16;
  const y = emotion === 'thinking' ? -14 : (Math.random() - 0.5) * 10;
  $('pupils').style.transform = `translate(${x}px, ${y}px)`;
  setTimeout(lookLoop, 1200 + Math.random() * 2500);
}

// ---------------------------------------------------------------- speaking

let audioCtx = null;
let analyser = null;
let levels = null;
let current = null; // { id, stop() }

function loop() {
  if (analyser && current?.audio) {
    analyser.getByteTimeDomainData(levels);
    let sum = 0;
    for (const v of levels) sum += ((v - 128) / 128) ** 2;
    target = Math.min(1, Math.sqrt(sum / levels.length) * 5);
  }
  open += (target - open) * 0.35;
  drawMouth();
  requestAnimationFrame(loop);
}

let flapTimer = 0;
function flap(on) {
  clearInterval(flapTimer);
  if (on) flapTimer = setInterval(() => { target = 0.15 + Math.random() * 0.75; }, 95);
  else target = 0;
}

const synth = window.speechSynthesis || null;
const keep = new Set(); // Chrome forgets utterances it isn't holding on to, and they go silent

// The phone's voices load a moment after the page; wait up to 2 s for them.
function voicesReady() {
  if (!synth) return Promise.resolve([]);
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(synth.getVoices());
    synth.addEventListener?.('voiceschanged', done, { once: true });
    setTimeout(done, 2000);
  });
}

function pickVoice() {
  const voices = synth.getVoices();
  const want = (params.get('voice') || '').toLowerCase();
  return (want && voices.find((v) => v.name.toLowerCase().includes(want)))
    || voices.find((v) => /en[-_]US/i.test(v.lang) && /google|natural|samantha|aria|jenny/i.test(v.name))
    || voices.find((v) => /^en/i.test(v.lang))
    || null;
}

// Chrome cuts off long utterances, so speak sentence by sentence.
function sentences(text) {
  return text.match(/[^.!?…]+[.!?…]*\s*/g)?.map((s) => s.trim()).filter(Boolean) || [text];
}

// A voice the browser rejects shouldn't stop the cartoon; it just uses the default.
function useVoice(u, voice) {
  try { if (voice) u.voice = voice; } catch { /* default voice */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Stops any speech. On Android Chrome, speaking straight after cancel() is
// silently dropped, so callers that speak next wait a moment after this.
async function quiet() {
  if (synth && (synth.speaking || synth.pending)) {
    synth.cancel();
    await sleep(250);
  }
}

async function speakBrowser(text, onWord) {
  if (!synth) { // no speech at all in this browser: just move the mouth
    flap(true);
    await sleep(300 * text.split(' ').length);
    flap(false);
    return;
  }
  await quiet();
  if (synth.paused) synth.resume();
  return new Promise((resolve) => {
    let finished = false;
    const end = () => {
      if (finished) return;
      finished = true;
      clearTimeout(safety);
      clearInterval(nudge);
      flap(false);
      resolve();
    };
    // Some phones never report the end of speech; don't stay stuck talking.
    const safety = setTimeout(end, 6000 + text.split(' ').length * 700);
    // Android Chrome can pause speech by itself; nudge it along.
    const nudge = setInterval(() => { if (synth.paused) synth.resume(); }, 1000);
    const parts = sentences(text);
    const voice = pickVoice();
    let spoken = 0;
    parts.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part);
      useVoice(u, voice);
      u.pitch = Number(params.get('pitch')) || 1.35;
      u.rate = Number(params.get('rate')) || 1.05;
      const offset = spoken;
      u.onboundary = (e) => { if (e.name === 'word') onWord(offset + part.slice(0, e.charIndex).split(/\s+/).filter(Boolean).length + 1); };
      u.onstart = () => flap(true);
      u.onend = u.onerror = () => { keep.delete(u); if (i === parts.length - 1) end(); };
      spoken += part.split(/\s+/).length;
      keep.add(u);
      synth.speak(u);
    });
  });
}

function speakAudio(url) {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    current.audio = audio;
    if (audioCtx) {
      const src = audioCtx.createMediaElementSource(audio);
      src.connect(analyser);
    } else {
      flap(true);
    }
    audio.onended = audio.onerror = () => { flap(false); target = 0; resolve(audio.duration); };
    audio.play().catch(() => resolve(0));
  });
}

// Reveal the answer word by word, roughly in time with the voice.
function showWords(text) {
  const el = $('answer');
  el.replaceChildren(...text.split(/\s+/).map((w) => {
    const s = document.createElement('span');
    s.className = 'w';
    s.textContent = `${w} `;
    return s;
  }));
  const words = [...el.children];
  let shown = 0;
  const reveal = (n) => {
    for (; shown < Math.min(n, words.length); shown++) words[shown].classList.add('on');
  };
  const timer = setInterval(() => reveal(shown + 1), 330);
  return { reveal, done: () => { clearInterval(timer); reveal(words.length); } };
}

function showBubble({ kind, name, question }) {
  const asker = $('asker');
  asker.classList.toggle('guest', kind === 'guest');
  asker.textContent = kind === 'guest' ? `🎤 ${name || 'Our guest'} asks` : kind === 'comment' ? `💬 ${name}` : '';
  $('question').textContent = kind === 'guest' || kind === 'comment' ? question || '' : '';
  $('bubble').hidden = false;
}

let hideTimer = 0;
async function say(msg) {
  ears.setBusy(true);
  stopAll();
  clearTimeout(hideTimer);
  const token = { id: msg.id, audio: null };
  current = token;

  setEmotion(msg.emotion);
  showBubble({ kind: msg.kind, name: msg.name, question: msg.question });
  $('dots').hidden = true;
  const words = showWords(msg.text);
  cartoon.classList.add('talking');

  if (msg.audio) await speakAudio(msg.audio);
  else await speakBrowser(msg.text, words.reveal);

  if (current !== token) return; // replaced or stopped
  words.done();
  cartoon.classList.remove('talking');
  current = null;
  send({ type: 'done', id: msg.id });
  ears.setBusy(false);
  hideTimer = setTimeout(() => { $('bubble').hidden = true; setEmotion('happy'); }, 4000);
}

function think(msg) {
  ears.setBusy(true);
  stopAll();
  clearTimeout(hideTimer);
  setEmotion('thinking');
  showBubble({ kind: msg.kind, name: msg.name, question: msg.text });
  $('answer').replaceChildren();
  $('dots').hidden = false;
}

function stopAll() {
  if (current?.audio) current.audio.pause();
  current = null;
  if (synth && (synth.speaking || synth.pending)) synth.cancel();
  flap(false);
  cartoon.classList.remove('talking');
}

let toastTimer = 0;
function celebrate({ kind, name, gift, count }) {
  const t = $('toast');
  t.textContent = kind === 'follow' ? `💖 ${name} followed!` : `🎁 ${name} sent ${count > 1 ? `${count}× ` : ''}${gift}!`;
  t.hidden = false;
  cartoon.classList.remove('jump');
  void cartoon.offsetWidth;
  cartoon.classList.add('jump');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; cartoon.classList.remove('jump'); }, 4000);
}

// ---------------------------------------------------------------- server connection

let channel = null;
let key = getKey();
function send(msg) {
  channel?.send(msg);
}

async function connect() {
  // Online, ask for the key straight away instead of waiting for a refusal.
  if (!key && await needsKey()) {
    askForKey($('keyForm'), (k) => { key = k; connect(); });
    return;
  }
  channel = openChannel('stage', key, {
    onOpen: () => { $('offline').hidden = true; },
    onClose: (code) => {
      channel = null;
      if (code === 4003) {
        $('offline').hidden = true;
        askForKey($('keyForm'), (k) => { key = k; connect(); }, Boolean(key));
        return;
      }
      $('offline').hidden = false;
      setTimeout(connect, 2000);
    },
    onMessage,
  });
}

function onMessage(msg) {
  if (msg.type === 'hello') { $('nameplate').textContent = msg.cartoonName; reportVoice(); }
  else if (msg.type === 'think') think(msg);
  else if (msg.type === 'say') say(msg);
  else if (msg.type === 'stop' || msg.type === 'idle') { stopAll(); ears.setBusy(false); $('bubble').hidden = true; setEmotion('happy'); }
  else if (msg.type === 'event') celebrate(msg);
}

function start() {
  $('start').hidden = true;
  try {
    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    levels = new Uint8Array(analyser.fftSize);
    analyser.connect(audioCtx.destination);
  } catch { audioCtx = null; }
  keepAwake();
  audioCtx?.resume?.();
  unlockSpeech();
  startListening();
  connect();
}

// Phones only let a page talk after it has spoken once in response to a tap,
// so say hello right away. It doubles as a sound check.
function unlockSpeech() {
  if (!synth) return;
  const hello = new SpeechSynthesisUtterance(`Hi! I'm ${$('nameplate').textContent || 'Bobo'}. Let's go live!`);
  hello.pitch = Number(params.get('pitch')) || 1.35;
  hello.rate = Number(params.get('rate')) || 1.05;
  const voice = pickVoice();
  useVoice(hello, voice);
  hello.onstart = () => flap(true);
  ears.setBusy(true); // don't hear the hello
  const done = () => { keep.delete(hello); flap(false); ears.setBusy(false); };
  hello.onend = hello.onerror = done;
  setTimeout(() => { if (keep.has(hello)) done(); }, 6000); // some phones never report the end
  keep.add(hello);
  synth.speak(hello);
}

// ---------------------------------------------------------------- listening
// The streaming phone listens to the people on the LIVE and Bobo answers them.

const ears = createListener({
  lang: params.get('lang') || navigator.language || 'en-US',
  onHeard: (text) => send({ type: 'ask', name: '', text }),
  onState: (st) => {
    const el = $('ears');
    el.hidden = st === 'off';
    el.className = `ears ${st}`;
    el.textContent = st === 'listening' ? '👂' : '🔇';
  },
});

function startListening() {
  if (params.get('listen') === '0' || !canListen) return;
  ears.start();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') ears.resume();
});

// Tell the control panel whether this phone can actually talk.
async function reportVoice() {
  const voices = await voicesReady();
  const voice = synth ? pickVoice() : null;
  send({
    type: 'voice',
    ok: Boolean(synth) && voices.length > 0,
    count: voices.length,
    name: voice ? `${voice.name} (${voice.lang})` : '',
  });
}

// Stop a phone's screen from going dark mid-LIVE (needs https or localhost).
let wakeLock = null;
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeLock?.released !== false) keepAwake();
});

setEmotion('happy');
drawMouth();
blinkLoop();
lookLoop();
requestAnimationFrame(loop);

if (params.get('autostart') === '1') start();
else $('start').addEventListener('click', start, { once: true });
