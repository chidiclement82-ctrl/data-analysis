// Cartoon stage: animates the character and speaks what the server sends.
//
// URL options (add to /stage?...):
//   bg=transparent | green   background for overlays or chroma key
//   autostart=1              skip the "tap to start" screen (OBS browser source)
//   voice=Samantha           part of a browser voice name to use
//   pitch=1.3  rate=1.05     browser voice pitch and speed

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

function pickVoice() {
  const voices = speechSynthesis.getVoices();
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

function speakBrowser(text, onWord) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) { flap(true); return setTimeout(() => { flap(false); resolve(); }, 300 * text.split(' ').length); }
    speechSynthesis.cancel();
    const parts = sentences(text);
    const voice = pickVoice();
    let spoken = 0;
    parts.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part);
      if (voice) u.voice = voice;
      u.pitch = Number(params.get('pitch')) || 1.35;
      u.rate = Number(params.get('rate')) || 1.05;
      const offset = spoken;
      u.onboundary = (e) => { if (e.name === 'word') onWord(offset + part.slice(0, e.charIndex).split(/\s+/).filter(Boolean).length + 1); };
      u.onstart = () => flap(true);
      u.onend = u.onerror = () => { if (i === parts.length - 1) { flap(false); resolve(); } };
      spoken += part.split(/\s+/).length;
      speechSynthesis.speak(u);
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
  hideTimer = setTimeout(() => { $('bubble').hidden = true; setEmotion('happy'); }, 4000);
}

function think(msg) {
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
  if ('speechSynthesis' in window) speechSynthesis.cancel();
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

let ws;
function send(msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?role=stage`);
  ws.onopen = () => { $('offline').hidden = true; };
  ws.onclose = () => { $('offline').hidden = false; setTimeout(connect, 2000); };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'hello') $('nameplate').textContent = msg.cartoonName;
    else if (msg.type === 'think') think(msg);
    else if (msg.type === 'say') say(msg);
    else if (msg.type === 'stop' || msg.type === 'idle') { stopAll(); $('bubble').hidden = true; setEmotion('happy'); }
    else if (msg.type === 'event') celebrate(msg);
  };
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
  window.speechSynthesis?.getVoices();
  audioCtx?.resume?.();
  connect();
}

setEmotion('happy');
drawMouth();
blinkLoop();
lookLoop();
requestAnimationFrame(loop);

if (params.get('autostart') === '1') start();
else $('start').addEventListener('click', start, { once: true });
