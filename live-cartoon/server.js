// Live Cartoon server. Run it on the computer you stream from:
//   npm start
// then open the control panel and the stage (see README.md).

import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { CommentQueue } from './src/filters.js';
import { createBrain, describeError, cleanForSpeech, claudeProvider, geminiProvider } from './src/brain.js';
import { createTts } from './src/tts.js';
import { TikTokLink } from './src/tiktok.js';

const here = fileURLToPath(new URL('.', import.meta.url));
try { process.loadEnvFile(join(here, '.env')); } catch { /* no .env file: use the real environment */ }

const env = process.env;
const config = {
  port: Number(env.PORT) || 3000,
  // Only this computer can open the pages unless you change HOST.
  host: env.HOST || '127.0.0.1',
  username: env.TIKTOK_USERNAME,
  cartoonName: env.CARTOON_NAME || 'Bobo',
  hostName: env.HOST_NAME || env.TIKTOK_USERNAME || 'the host',
  persona: env.CARTOON_PERSONA || undefined,
  // Which AI writes the replies: "gemini" or "claude". If unset, uses
  // whichever one has a key (Gemini when only GEMINI_API_KEY is filled in).
  provider: (env.AI_PROVIDER || (env.GEMINI_API_KEY && !env.ANTHROPIC_API_KEY ? 'gemini' : 'claude')).toLowerCase(),
  autoGapMs: (Number(env.AUTO_REPLY_GAP_SECONDS) || 4) * 1000,
  blocked: (env.BLOCKED_WORDS || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean),
  thankFollows: env.THANK_FOLLOWS !== 'false',
  thankGifts: env.THANK_GIFTS !== 'false',
};

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const isLoopbackOnly = LOOPBACK.has(config.host) || config.host === '::1';
if (!isLoopbackOnly && (env.CONTROL_KEY || '').length < 12) {
  console.error('\n  Set CONTROL_KEY to a long secret (12+ characters) before running with HOST=' + config.host + '.\n  Anyone who can reach this server could otherwise make the cartoon talk on your LIVE.\n');
  process.exit(1);
}

const ask = config.provider === 'gemini'
  ? geminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || undefined })
  : claudeProvider({ model: env.CLAUDE_MODEL || undefined, effort: env.CLAUDE_EFFORT || undefined });
const brain = createBrain({ ...config, ask });
const tts = createTts({ apiKey: env.ELEVENLABS_API_KEY, voiceId: env.ELEVENLABS_VOICE_ID });
const tiktok = new TikTokLink({ username: config.username, signApiKey: env.EULER_API_KEY });
const queue = new CommentQueue({ cartoonName: config.cartoonName, blocked: config.blocked });

// ---------------------------------------------------------------- state

const state = {
  auto: env.AUTO_REPLY !== 'false',
  busy: null,        // the line the cartoon is saying (or thinking about) right now
  lastDoneAt: 0,
  priority: [],      // guest questions and host requests: answered before chat
  shoutouts: [],     // quick thank-yous for follows and gifts
  aiError: '',
};
let lineId = 0;

// ---------------------------------------------------------------- websockets

const sockets = { stage: new Set(), control: new Set() };

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
function broadcast(role, msg) {
  for (const ws of sockets[role]) send(ws, msg);
}
function status() {
  return {
    type: 'status',
    tiktok: tiktok.status(),
    auto: state.auto,
    stages: sockets.stage.size,
    queue: queue.items.map(({ id, name, text }) => ({ id, name, text })),
    waiting: state.priority.length,
    busy: state.busy && { kind: state.busy.kind, name: state.busy.name, text: state.busy.text },
    aiError: state.aiError,
    voice: tts.enabled ? 'elevenlabs' : 'browser',
    cartoonName: config.cartoonName,
  };
}
const pushStatus = () => broadcast('control', status());

// ---------------------------------------------------------------- speaking loop

// Rough time to say a line, used when a stage never reports it finished.
const speakTimeout = (text) => 8000 + text.split(' ').length * 450;

async function say(job) {
  const id = ++lineId;
  state.busy = { ...job, id };
  pushStatus();
  try {
    let reply;
    if (job.kind === 'direct' || job.kind === 'shoutout') {
      reply = { emotion: job.emotion || 'happy', say: cleanForSpeech(job.text) };
    } else {
      broadcast('stage', { type: 'think', id, kind: job.kind, name: job.name, text: job.text });
      reply = await brain.reply(job);
      state.aiError = '';
    }
    if (state.busy?.id !== id) return; // host pressed Stop while the AI was thinking

    let audio = null;
    try {
      audio = await tts.speak(reply.say);
    } catch (err) {
      console.warn('[voice]', err.message); // falls back to the browser voice
    }
    if (state.busy?.id !== id) return;

    const line = { type: 'say', id, kind: job.kind, name: job.name, question: job.text, emotion: reply.emotion, text: reply.say, audio };
    broadcast('stage', line);
    broadcast('control', { ...line, type: 'said', at: Date.now() });
    state.busy.timer = setTimeout(() => finish(id), speakTimeout(reply.say));
  } catch (err) {
    state.aiError = describeError(err);
    console.error('[ai]', err);
    broadcast('stage', { type: 'idle' });
    finish(id, err?.status === 429 ? 15000 : 3000);
  }
}

function finish(id, pauseMs = 0) {
  if (state.busy?.id !== id) return;
  clearTimeout(state.busy.timer);
  state.busy = null;
  state.lastDoneAt = Date.now() + pauseMs;
  pushStatus();
  setTimeout(tick, 50);
}

function stopTalking() {
  if (state.busy) clearTimeout(state.busy.timer);
  state.busy = null;
  state.lastDoneAt = Date.now();
  broadcast('stage', { type: 'stop' });
  pushStatus();
}

function tick() {
  if (state.busy || sockets.stage.size === 0) return;
  const now = Date.now();
  if (state.priority.length) return say(state.priority.shift());
  if (now < state.lastDoneAt) return;
  if (state.shoutouts.length) return say(state.shoutouts.shift());
  if (!state.auto || now - state.lastDoneAt < config.autoGapMs) return;
  const c = queue.next(now);
  if (c) {
    queue.markAnswered(c.userId, now);
    say({ kind: 'comment', name: c.name, text: c.text, userId: c.userId });
  }
}
setInterval(tick, 500);

// ---------------------------------------------------------------- TikTok events

function onComment(c) {
  const queued = queue.add(c);
  broadcast('control', { type: 'comment', ...c, queued });
  pushStatus();
}

tiktok.on('status', pushStatus);
tiktok.on('comment', onComment);
tiktok.on('follow', ({ name }) => {
  broadcast('stage', { type: 'event', kind: 'follow', name });
  if (config.thankFollows && state.shoutouts.length < 3) {
    state.shoutouts.push({ kind: 'shoutout', emotion: 'love', name, text: `Thanks for the follow, ${name}!` });
  }
});
tiktok.on('gift', ({ name, gift, count }) => {
  broadcast('stage', { type: 'event', kind: 'gift', name, gift, count });
  if (config.thankGifts && state.shoutouts.length < 3) {
    const what = count > 1 ? `${count} ${gift}s` : gift;
    state.shoutouts.push({ kind: 'shoutout', emotion: 'excited', name, text: `Wow, ${name}, thank you for the ${what}!` });
  }
});

// ---------------------------------------------------------------- control panel commands

function onControlMessage(msg) {
  const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, 1000) : '';
  const name = typeof msg.name === 'string' ? msg.name.trim().slice(0, 40) : '';
  switch (msg.type) {
    case 'ask': // a guest's question (spoken or typed) or the host's own
      if (text) state.priority.push({ kind: 'guest', name, text });
      break;
    case 'say': // make the cartoon say exactly this
      if (text) state.priority.push({ kind: 'direct', name: '', text, emotion: msg.emotion });
      break;
    case 'answer': { // answer this chat comment next
      // Comments that were skipped or already left the queue can still be answered.
      const c = queue.remove(String(msg.id)) ?? (text && { name, text });
      if (c) state.priority.push({ kind: 'comment', name: c.name, text: c.text });
      break;
    }
    case 'dismiss':
      queue.remove(String(msg.id));
      break;
    case 'clear':
      queue.clear();
      state.priority = [];
      break;
    case 'auto':
      state.auto = Boolean(msg.on);
      break;
    case 'stop':
      stopTalking();
      break;
    case 'test-comment': // pretend a viewer typed this, for practice without going live
      if (text) onComment({ id: `test-${Date.now()}`, userId: `test-${name || 'viewer'}`, name: name || 'TestViewer', handle: '', text, ts: Date.now() });
      break;
    case 'reconnect':
      tiktok.stop().then(() => tiktok.start());
      break;
    default:
      return;
  }
  pushStatus();
  tick();
}

// ---------------------------------------------------------------- web server

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const ROUTES = { '/': '/index.html', '/stage': '/stage.html', '/control': '/control.html' };
const publicDir = join(here, 'public');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/healthz') return res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
  const audio = url.pathname.match(/^\/audio\/([\w-]+)\.mp3$/);
  if (audio) {
    const buf = tts.get(audio[1]);
    if (!buf) return res.writeHead(404).end();
    return res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': buf.length, 'Cache-Control': 'no-store' }).end(buf);
  }
  const path = normalize(ROUTES[url.pathname] || url.pathname);
  const file = join(publicDir, path);
  if (!file.startsWith(publicDir)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
});

// Browsers let any website open a WebSocket to localhost, so only accept our
// own pages: the Origin must match the address the page was loaded from.
// Online (or on your Wi-Fi), both pages also need the CONTROL_KEY.
function sameKey(a, b) {
  const hash = (s) => createHash('sha256').update(String(s)).digest();
  return timingSafeEqual(hash(a), hash(b));
}
// Hosting proxies may add the default port (":443") to one header and not the other.
const bareHost = (h) => String(h || '').toLowerCase().replace(/:(80|443)$/, '');
function originHost(origin) {
  try { return bareHost(new URL(origin).host); } catch { return null; }
}

// Returns null when allowed, otherwise the reason it isn't (for the logs).
function refusal(req, key) {
  const host = bareHost(req.headers.host);
  const origin = req.headers.origin;
  if (origin && originHost(origin) !== host) return `page address ${origin} doesn't match server ${host}`;
  if (isLoopbackOnly) return LOOPBACK.has(host.replace(/:\d+$/, '')) ? null : `unexpected host ${host}`; // blocks DNS rebinding
  if (!key) return 'no access key yet';
  return sameKey(key, env.CONTROL_KEY) ? null : 'wrong access key';
}

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const role = params.get('role') === 'control' ? 'control' : 'stage';
  ws.on('error', (err) => console.warn(`[ws] ${role} connection error:`, err.message)); // never crash the server
  const why = refusal(req, params.get('key'));
  if (why) {
    console.log(`[ws] ${role} refused: ${why}`);
    return ws.close(4003, 'Not allowed');
  }
  console.log(`[ws] ${role} connected`);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  sockets[role].add(ws);
  if (role === 'stage') send(ws, { type: 'hello', cartoonName: config.cartoonName });
  else send(ws, status());
  pushStatus();

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (role === 'control') onControlMessage(msg);
    else if (msg.type === 'done') finish(Number(msg.id), 0);
  });
  ws.on('close', (code) => {
    console.log(`[ws] ${role} disconnected (${code})`);
    sockets[role].delete(ws);
    pushStatus();
  });
});

// Ping every page every 25 s. Hosting proxies close connections that stay
// quiet, and a page that stops answering (phone asleep, lost signal) is dropped.
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* closing anyway */ }
  }
}, 25_000).unref();

server.listen(config.port, config.host, () => {
  const base = env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
  console.log(`\n  ${config.cartoonName} is ready!\n`);
  console.log(`  Control panel:  ${base}/control`);
  console.log(`  Cartoon stage:  ${base}/stage   (capture this in TikTok LIVE Studio or OBS)\n`);
  const keyName = config.provider === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY';
  console.log(`  AI: ${config.provider === 'gemini' ? 'Google Gemini' : 'Claude'}`);
  if (!env[keyName]) console.log(`  ! ${keyName} is not set, so the cartoon can't answer yet. See README.md.\n`);
  tiktok.start();
});

// A hiccup in the TikTok connector or a network error must not take the
// cartoon off air: log it and keep running.
process.on('unhandledRejection', (err) => console.error('[error]', err));
process.on('uncaughtException', (err) => console.error('[error] kept running after:', err));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await tiktok.stop();
    process.exit(0);
  });
}
