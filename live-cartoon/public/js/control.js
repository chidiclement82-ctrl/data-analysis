// Host control panel: watch chat, steer the cartoon, take guest questions.

import { getKey, askForKey, wsUrl } from './key.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let ws;

function send(msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
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

  $('stagePill').textContent = s.stages ? `Stage: on (${s.voice === 'elevenlabs' ? 'ElevenLabs voice' : 'browser voice'})` : 'Stage: not open';
  $('stagePill').className = `pill ${s.stages ? 'ok' : 'bad'}`;
  $('stageHelp').hidden = Boolean(s.stages);

  $('aiError').hidden = !s.aiError;
  $('aiError').textContent = s.aiError ? `⚠️ ${s.aiError}` : '';

  $('auto').checked = s.auto;

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

// ---------------------------------------------------------------- other controls

$('auto').addEventListener('change', (e) => send({ type: 'auto', on: e.target.checked }));
$('stop').addEventListener('click', () => send({ type: 'stop' }));
$('clear').addEventListener('click', () => send({ type: 'clear' }));
$('reconnect').addEventListener('click', () => send({ type: 'reconnect' }));

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
function connect() {
  ws = new WebSocket(wsUrl('control', key));
  ws.onopen = () => { document.querySelector('main').hidden = false; };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'status') renderStatus(msg);
    else if (msg.type === 'comment') addComment(msg);
    else if (msg.type === 'said') addSaid(msg);
  };
  ws.onclose = (e) => {
    const pill = $('tiktokPill');
    pill.className = 'pill bad';
    if (e.code === 4003) {
      pill.textContent = 'Locked: enter your access key';
      document.querySelector('main').hidden = true;
      askForKey($('keyForm'), (k) => { key = k; connect(); }, Boolean(key));
      return;
    }
    pill.textContent = `Can't reach the server (code ${e.code}). Reconnecting…`;
    setTimeout(connect, 2000);
  };
}
connect();
