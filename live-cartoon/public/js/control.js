// Host control panel: watch chat, steer the cartoon, take guest questions.

import { getKey, askForKey } from './key.js';
import { openChannel, needsKey, transportName } from './channel.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let channel = null;

function send(msg) {
  channel?.send(msg);
}

// ---------------------------------------------------------------- status

const TIKTOK_LABEL = { off: 'TikTok: off', waiting: 'TikTok: waiting for LIVE', connecting: 'TikTok: connecting…', live: 'TikTok: LIVE', error: 'TikTok: error' };
const TIKTOK_CLASS = { off: 'bad', waiting: 'warn', connecting: 'warn', live: 'ok', error: 'bad' };

function renderStatus(s) {
  $('cartoonName').textContent = s.cartoonName;
  document.title = `${s.cartoonName} Control`;
  $('ask').textContent = `Ask ${s.cartoonName}`;

  const t = s.tiktok;
  const pill = $('tiktokPill');
  pill.textContent = t.username ? `${TIKTOK_LABEL[t.state]} · @${t.username}` : TIKTOK_LABEL.off;
  pill.className = `pill ${TIKTOK_CLASS[t.state] || ''}`;
  $('tiktokDetail').textContent = t.detail || '';
  $('viewers').hidden = !(t.state === 'live' && t.viewers);
  $('viewers').textContent = `👀 ${t.viewers}`;

  const voiceName = s.voice === 'elevenlabs' ? 'ElevenLabs voice'
    : s.stageVoice?.ok ? `voice: ${s.stageVoice.name || 'phone voice'}` : s.stageVoice ? 'no voice!' : 'checking voice…';
  $('stagePill').textContent = s.stages ? `Stage: on (${voiceName})` : 'Stage: not open';
  $('voiceWarn').hidden = !(s.stages && s.voice !== 'elevenlabs' && s.stageVoice && !s.stageVoice.ok);
  $('stagePill').className = `pill ${s.stages ? 'ok' : 'bad'}`;
  $('stageHelp').hidden = Boolean(s.stages);

  $('aiError').hidden = !s.aiError;
  $('aiError').textContent = s.aiError ? `⚠️ ${s.aiError}` : '';

  $('auto').checked = s.auto;
  trackCartoon(s);

  const now = $('nowText');
  if (s.busy) {
    const who = s.busy.kind === 'guest' ? `🎤 ${s.busy.name || 'Guest'}` : s.busy.kind === 'comment' ? `💬 ${s.busy.name}` : '📣';
    now.innerHTML = '';
    now.append(Object.assign(document.createElement('b'), { textContent: `${who}: ` }), s.busy.text);
    now.classList.remove('muted');
  } else {
    now.textContent = s.auto ? 'Listening to chat…' : 'Auto-reply is off. Click a comment to answer it.';
    now.classList.add('muted');
  }
  const parts = [`${s.queue.length} comment${s.queue.length === 1 ? '' : 's'} waiting`];
  if (s.waiting) parts.push(`${s.waiting} question${s.waiting === 1 ? '' : 's'} up next`);
  $('queueInfo').textContent = parts.join(' · ');

  const queued = new Set(s.queue.map((c) => c.id));
  for (const li of $('comments').children) {
    const isQueued = queued.has(li.dataset.id);
    li.classList.toggle('queued', isQueued);
    if (!li.classList.contains('done')) li.querySelector('.tag').textContent = isQueued ? 'in queue' : '';
  }
}

// ---------------------------------------------------------------- chat feed

function addComment(c) {
  $('noComments').hidden = true;
  const li = document.createElement('li');
  li.dataset.id = c.id;
  li.title = 'Answer this next';
  const who = Object.assign(document.createElement('span'), { className: 'who', textContent: c.name });
  const text = Object.assign(document.createElement('span'), { className: 'text', textContent: c.text });
  const tag = Object.assign(document.createElement('span'), { className: 'tag', textContent: c.queued ? 'in queue' : 'skipped' });
  li.append(who, text, tag);
  li.addEventListener('click', () => {
    send({ type: 'answer', id: c.id, name: c.name, text: c.text });
    li.classList.add('done');
    tag.textContent = 'up next';
  });
  const list = $('comments');
  list.prepend(li);
  while (list.children.length > 150) list.lastChild.remove();
}

function addSaid(m) {
  const li = document.createElement('li');
  if (m.question && m.kind !== 'direct' && m.kind !== 'shoutout') {
    const label = m.kind === 'guest' ? `🎤 ${m.name || 'Guest'}` : `💬 ${m.name}`;
    li.append(Object.assign(document.createElement('div'), { className: 'q', textContent: `${label}: ${m.question}` }));
  }
  li.append(Object.assign(document.createElement('div'), { className: 'a', textContent: m.text }));
  $('said').prepend(li);
  while ($('said').children.length > 50) $('said').lastChild.remove();
}

// ---------------------------------------------------------------- guest mic

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let finalText = '';

function setMic(on, note = '') {
  $('listen').classList.toggle('on', on);
  $('listen').textContent = on ? '■ Stop listening' : '🎤 Listen';
  $('micState').textContent = note;
}

function askGuest() {
  const text = $('guestText').value.trim();
  if (!text) return;
  send({ type: 'ask', name: $('guestName').value.trim(), text });
  $('guestText').value = '';
  finalText = '';
}

function startListening() {
  if (!Recognition) {
    $('micState').textContent = 'Voice typing needs Google Chrome or Microsoft Edge. You can still type the question.';
    return;
  }
  rec = new Recognition();
  rec.lang = params.get('lang') || navigator.language || 'en-US';
  rec.interimResults = true;
  // With auto-ask on, recognition stops by itself when the guest pauses.
  rec.continuous = !$('autoAsk').checked;
  finalText = $('guestText').value.trim();
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText = `${finalText} ${r[0].transcript}`.trim();
      else interim += r[0].transcript;
    }
    $('guestText').value = `${finalText} ${interim}`.trim();
  };
  rec.onerror = (e) => setMic(false, e.error === 'not-allowed' ? 'Allow the microphone for this page, then try again.' : `Mic problem: ${e.error}`);
  rec.onend = () => {
    const auto = $('autoAsk').checked && $('listen').classList.contains('on');
    setMic(false);
    rec = null;
    if (auto) askGuest();
  };
  rec.start();
  setMic(true, 'Listening…');
}

$('listen').addEventListener('click', () => {
  if (rec) { rec.stop(); return; }
  startListening();
});
$('ask').addEventListener('click', () => {
  if (rec) { $('listen').classList.remove('on'); rec.stop(); }
  askGuest();
});

// ---------------------------------------------------------------- hands-free guests
// Listens all the time and sends each thing a guest says to the cartoon once
// they pause. While the cartoon is thinking or talking (and a moment after),
// whatever the mic hears is ignored, so it never answers its own voice.

const ECHO_GUARD_MS = 1800; // keep ignoring the mic this long after the cartoon stops
const MIN_WORDS = 3;        // "ok", "yes", "hmm" aren't questions
let handsFree = false;
let hfRec = null;
let hfHeard = '';
let cartoonBusy = false;
let quietUntil = 0;
let hfWake = null;

function hfNote(text) { $('hfState').textContent = text; }
function hfListening() { return handsFree && !cartoonBusy && Date.now() >= quietUntil; }

// Called with every status update from the server.
function trackCartoon(s) {
  const busy = Boolean(s.busy) || s.waiting > 0;
  if (cartoonBusy && !busy) {
    quietUntil = Date.now() + ECHO_GUARD_MS;
    if (handsFree) setTimeout(hfStart, ECHO_GUARD_MS); // listen again once the cartoon's voice has died down
  }
  if (!cartoonBusy && busy && hfRec) { try { hfRec.abort(); } catch { /* stopped */ } } // don't hear the cartoon
  cartoonBusy = busy;
  if (handsFree) hfNote(busy ? `🔇 ${s.cartoonName} is answering… (not listening)` : '🎧 Listening for your guests…');
}

function hfSend() {
  const text = hfHeard.trim();
  hfHeard = '';
  if (!text || text.split(/\s+/).length < MIN_WORDS || !hfListening()) return;
  send({ type: 'ask', name: $('guestName').value.trim(), text });
  cartoonBusy = true; // until the server says otherwise
  $('guestText').value = text;
  hfNote(`🎤 Sent: "${text}"`);
}

function hfStart() {
  if (!handsFree || hfRec || cartoonBusy) return;
  hfRec = new Recognition();
  hfRec.lang = params.get('lang') || navigator.language || 'en-US';
  hfRec.interimResults = true;
  hfRec.continuous = false; // one sentence per round; it stops by itself when they pause
  hfRec.onresult = (e) => {
    if (!hfListening()) { hfHeard = ''; return; } // the cartoon's own voice, or mid-answer
    let interim = '';
    let final = '';
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    hfHeard = final || interim;
    $('guestText').value = hfHeard;
  };
  hfRec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      stopHandsFree('Allow the microphone for this page (tap the lock icon in the address bar), then turn hands-free on again.');
    }
  };
  hfRec.onend = () => {
    hfRec = null;
    hfSend();
    if (handsFree && !cartoonBusy) setTimeout(hfStart, 250); // listen for the next thing they say
  };
  try { hfRec.start(); } catch { hfRec = null; setTimeout(hfStart, 1000); }
}

async function startHandsFree() {
  if (!Recognition) {
    $('handsFree').checked = false;
    hfNote('Hands-free needs Google Chrome (Android or computer) or Microsoft Edge.');
    return;
  }
  if (rec) rec.stop();
  handsFree = true;
  $('listen').disabled = true;
  document.querySelector('.handsfree').classList.add('on');
  hfNote('🎧 Listening for your guests…');
  try { hfWake = await navigator.wakeLock?.request('screen'); } catch { /* screen may sleep */ }
  hfStart();
}

function stopHandsFree(note = 'Hands-free is off.') {
  handsFree = false;
  $('handsFree').checked = false;
  $('listen').disabled = false;
  document.querySelector('.handsfree').classList.remove('on');
  hfNote(note);
  try { hfRec?.abort(); } catch { /* already stopped */ }
  hfRec = null;
  hfHeard = '';
  hfWake?.release?.().catch(() => {});
  hfWake = null;
}

$('handsFree').addEventListener('change', (e) => (e.target.checked ? startHandsFree() : stopHandsFree()));
document.addEventListener('visibilitychange', async () => {
  if (handsFree && document.visibilityState === 'visible') {
    try { hfWake = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ }
    hfStart();
  }
});

// ---------------------------------------------------------------- other controls

$('auto').addEventListener('change', (e) => send({ type: 'auto', on: e.target.checked }));
$('stop').addEventListener('click', () => send({ type: 'stop' }));
$('clear').addEventListener('click', () => send({ type: 'clear' }));
$('reconnect').addEventListener('click', () => {
  const btn = $('reconnect');
  send({ type: 'reconnect' });
  btn.disabled = true;
  btn.textContent = '↻ Reconnecting…';
  setTimeout(() => { btn.disabled = false; btn.textContent = '↻ Reconnect to TikTok'; }, 4000);
});

function wire(inputId, buttonId, type, extra = {}) {
  const go = () => {
    const text = $(inputId).value.trim();
    if (!text) return;
    send({ type, text, ...extra });
    $(inputId).value = '';
  };
  $(buttonId).addEventListener('click', go);
  $(inputId).addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}
wire('sayText', 'say', 'say');
wire('testText', 'test', 'test-comment', { name: 'TestViewer' });

// ---------------------------------------------------------------- connection

let key = getKey();
function locked(wrong) {
  const pill = $('tiktokPill');
  pill.className = 'pill bad';
  pill.textContent = 'Locked: enter your access key';
  document.querySelector('main').hidden = true;
  askForKey($('keyForm'), (k) => { key = k; connect(); }, wrong);
}

async function connect() {
  // Online, ask for the key straight away instead of waiting for a refusal.
  if (!key && await needsKey()) return locked(false);
  channel = openChannel('control', key, {
    onOpen: () => {
      document.querySelector('main').hidden = false;
      $('connection').textContent = `Connected (${transportName()})`;
    },
    onMessage: (msg) => {
      if (msg.type === 'status') renderStatus(msg);
      else if (msg.type === 'comment') addComment(msg);
      else if (msg.type === 'said') addSaid(msg);
    },
    onClose: (code) => {
      channel = null;
      if (code === 4003) return locked(Boolean(key));
      const pill = $('tiktokPill');
      pill.className = 'pill bad';
      pill.textContent = `Can't reach the server (code ${code}). Reconnecting…`;
      $('connection').textContent = '';
      setTimeout(connect, 2000);
    },
  });
}
connect();
