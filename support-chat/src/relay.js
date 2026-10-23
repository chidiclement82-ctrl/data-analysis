// The support chat relay: a small HTTP API plus a live event stream.
// It passes sealed envelopes between customers and the support team and keeps
// them until the chat is deleted or goes quiet for RETENTION_DAYS. It holds no
// keys and cannot read messages (see ../../assets/js/e2ee.js).

import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createStore } from './store.js';

const ID = /^[A-Za-z0-9_-]{16,64}$/;
const B64 = /^[A-Za-z0-9_-]+$/;
const SESSION_MS = 12 * 3600000;

const sha = (s) => createHash('sha256').update(s).digest();
const token = () => randomBytes(32).toString('base64url');

function sameSecret(a, b) {
  // Compare hashes so the time taken says nothing about the secret.
  return timingSafeEqual(sha(String(a)), sha(String(b)));
}

export function validPublicKey(jwk) {
  if (!jwk || typeof jwk !== 'object') return false;
  const keys = Object.keys(jwk).sort().join(',');
  return keys === 'crv,kty,x,y' && jwk.kty === 'EC' && jwk.crv === 'P-256'
    && B64.test(jwk.x) && jwk.x.length === 43 && B64.test(jwk.y) && jwk.y.length === 43;
}

export function createRelay(options = {}) {
  const config = {
    agentPassword: options.agentPassword || '',
    agentKeyId: options.agentKeyId || '',
    allowedOrigins: options.allowedOrigins || [],
    maxMessageBytes: options.maxMessageBytes || 2_500_000,
    retentionDays: options.retentionDays || 30,
    trustProxy: Boolean(options.trustProxy),
    dataDir: options.dataDir,
  };
  const store = options.store || createStore({ dataDir: config.dataDir, retentionDays: config.retentionDays });
  const sessions = new Map(); // sha(agent token) hex -> expiry
  const streams = new Set();  // { res, role, conv }
  const buckets = new Map();  // rate limits: key -> { count, reset }

  // Rate limits ------------------------------------------------------------
  function allow(key, limit, windowMs) {
    const t = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset <= t) { b = { count: 0, reset: t + windowMs }; buckets.set(key, b); }
    b.count++;
    return b.count <= limit;
  }

  const housekeeping = setInterval(() => {
    const t = Date.now();
    for (const [k, b] of buckets) if (b.reset <= t) buckets.delete(k);
    for (const [k, exp] of sessions) if (exp <= t) sessions.delete(k);
    const before = new Set(store.list().map((c) => c.id));
    store.prune();
    for (const id of before) if (!store.get(id)) broadcast(id, 'deleted', { conv: id });
  }, 60000);
  housekeeping.unref();

  // Live events (Server-Sent Events) ---------------------------------------
  function send(stream, event, data) {
    stream.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  // To the team, and to the customer of that one conversation. `except` skips
  // the role that caused the event (it already knows).
  function broadcast(conv, event, data, except) {
    for (const s of streams) {
      if (s.role === except) continue;
      if (s.role === 'agent' || s.conv === conv) send(s, event, data);
    }
  }

  const ping = setInterval(() => {
    for (const s of streams) s.res.write(': ping\n\n');
  }, 25000);
  ping.unref();

  // HTTP helpers -----------------------------------------------------------
  function clientIp(req) {
    if (config.trustProxy) {
      const fwd = req.headers['x-forwarded-for'];
      if (fwd) return String(fwd).split(',')[0].trim();
    }
    return req.socket.remoteAddress || '?';
  }

  function originAllowed(origin) {
    if (!origin) return true; // not a browser page (curl, server, tests)
    if (config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin)) return true;
    return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) && config.allowedOrigins.includes('localhost');
  }

  function headers(req) {
    const h = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      Vary: 'Origin',
    };
    const origin = req.headers.origin;
    if (origin && originAllowed(origin)) {
      h['Access-Control-Allow-Origin'] = origin;
      h['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
      h['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS';
      h['Access-Control-Max-Age'] = '600';
    }
    return h;
  }

  function reply(req, res, status, body) {
    res.writeHead(status, { ...headers(req), 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  }

  async function readJson(req, limit) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw Object.assign(new Error('too big'), { status: 413 });
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      throw Object.assign(new Error('bad json'), { status: 400 });
    }
  }

  // Who is calling: { role: 'agent' } or { role: 'customer', conv } or null.
  function who(req) {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
    if (!m) return null;
    const value = m[1];
    if (value.startsWith('a.')) {
      const key = sha(value).toString('hex');
      const exp = sessions.get(key);
      return exp && exp > Date.now() ? { role: 'agent', sessionKey: key } : null;
    }
    if (value.startsWith('c.')) {
      const [, id, secret] = value.split('.');
      const c = id && store.get(id);
      if (!c || !secret) return null;
      return timingSafeEqual(sha(secret), Buffer.from(c.tokenHash, 'hex')) ? { role: 'customer', conv: id } : null;
    }
    return null;
  }

  function validEnvelope(env, conv, from) {
    return env && typeof env === 'object'
      && env.v === 1
      && typeof env.id === 'string' && ID.test(env.id)
      && env.conv === conv
      && env.from === from
      && Number.isSafeInteger(env.ts) && env.ts > 0
      && typeof env.iv === 'string' && B64.test(env.iv) && env.iv.length === 16
      && typeof env.ct === 'string' && B64.test(env.ct) && env.ct.length >= 22;
  }

  // Routes -----------------------------------------------------------------
  async function handle(req, res) {
    const url = new URL(req.url, 'http://relay');
    const path = url.pathname;
    const ip = clientIp(req);

    if (req.headers.origin && !originAllowed(req.headers.origin)) {
      return reply(req, res, 403, { error: 'This website may not use the support chat.' });
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, headers(req));
      return res.end();
    }

    if (path === '/healthz') return reply(req, res, 200, { ok: true });
    if (path === '/') {
      return reply(req, res, 200, { service: 'Ogarider support chat relay', note: 'Open support.html on the website to chat.' });
    }

    // Team sign-in ---------------------------------------------------------
    if (path === '/api/agent/login' && req.method === 'POST') {
      if (!config.agentPassword) return reply(req, res, 503, { error: 'The relay has no AGENT_PASSWORD set yet.' });
      if (!allow('login:' + ip, 10, 15 * 60000)) return reply(req, res, 429, { error: 'Too many tries. Wait 15 minutes.' });
      const body = await readJson(req, 4096);
      if (typeof body.password !== 'string' || !sameSecret(body.password, config.agentPassword)) {
        return reply(req, res, 401, { error: "That password isn't right." });
      }
      const t = 'a.' + token();
      sessions.set(sha(t).toString('hex'), Date.now() + SESSION_MS);
      return reply(req, res, 200, { token: t, expiresIn: SESSION_MS });
    }

    const caller = who(req);

    if (path === '/api/agent/logout' && req.method === 'POST') {
      if (caller?.role === 'agent') sessions.delete(caller.sessionKey);
      return reply(req, res, 200, { ok: true });
    }

    if (path === '/api/agent/conversations' && req.method === 'GET') {
      if (caller?.role !== 'agent') return reply(req, res, 401, { error: 'Sign in again.' });
      return reply(req, res, 200, { conversations: store.list().map(store.summary) });
    }

    // A customer starts a chat ---------------------------------------------
    if (path === '/api/conversations' && req.method === 'POST') {
      if (!allow('create:' + ip, 20, 3600000)) return reply(req, res, 429, { error: 'Too many new chats from here. Try again later.' });
      const body = await readJson(req, 4096);
      if (!validPublicKey(body.customerKey)) return reply(req, res, 400, { error: 'Bad customer key.' });
      if (typeof body.agentKeyId !== 'string' || !B64.test(body.agentKeyId) || body.agentKeyId.length !== 43) {
        return reply(req, res, 400, { error: 'Bad team key id.' });
      }
      if (config.agentKeyId && body.agentKeyId !== config.agentKeyId) {
        return reply(req, res, 409, { error: "The support team's security key has changed. Reload the page." });
      }
      const id = randomBytes(16).toString('base64url');
      const secret = token();
      const c = store.create({ id, customerKey: body.customerKey, agentKeyId: body.agentKeyId, tokenHash: sha(secret).toString('hex') });
      broadcast(id, 'conversation', store.summary(c), 'customer');
      return reply(req, res, 201, { id, token: `c.${id}.${secret}` });
    }

    // Live events ----------------------------------------------------------
    if (path === '/api/events' && req.method === 'GET') {
      if (!caller) return reply(req, res, 401, { error: 'Sign in again.' });
      res.writeHead(200, {
        ...headers(req),
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const stream = { res, role: caller.role, conv: caller.conv };
      streams.add(stream);
      send(stream, 'ready', { role: caller.role });
      req.on('close', () => streams.delete(stream));
      return;
    }

    // One conversation -----------------------------------------------------
    const m = /^\/api\/conversations\/([A-Za-z0-9_-]+)(?:\/(messages|read|typing|status))?$/.exec(path);
    if (!m) return reply(req, res, 404, { error: 'Not found.' });
    const [, id, action] = m;
    if (!caller || (caller.role === 'customer' && caller.conv !== id)) return reply(req, res, 401, { error: 'Not your chat.' });
    const c = store.get(id);
    if (!c) return reply(req, res, 404, { error: 'This chat was deleted.' });
    const role = caller.role;

    if (!action && req.method === 'GET') return reply(req, res, 200, store.summary(c));

    if (!action && req.method === 'DELETE') {
      store.remove(id);
      broadcast(id, 'deleted', { conv: id });
      return reply(req, res, 200, { ok: true });
    }

    if (action === 'messages' && req.method === 'GET') {
      const after = Number(url.searchParams.get('after')) || 0;
      return reply(req, res, 200, { messages: store.after(c, after), read: c.read, status: c.status });
    }

    if (action === 'messages' && req.method === 'POST') {
      if (!allow(`msg:${id}:${role}`, 60, 60000)) return reply(req, res, 429, { error: 'Slow down a little.' });
      const env = await readJson(req, config.maxMessageBytes);
      if (!validEnvelope(env, id, role)) return reply(req, res, 400, { error: 'Bad message.' });
      const wasClosed = c.status === 'closed';
      const { message, duplicate } = store.append(c, env);
      if (!duplicate) {
        broadcast(id, 'message', { conv: id, message }, null);
        if (wasClosed && c.status === 'open') broadcast(id, 'status', { conv: id, status: c.status }, null);
        broadcast(id, 'conversation', store.summary(c), 'customer');
      }
      return reply(req, res, duplicate ? 200 : 201, { seq: message.seq, at: message.at });
    }

    if (action === 'read' && req.method === 'POST') {
      const body = await readJson(req, 1024);
      if (!Number.isFinite(body.seq)) return reply(req, res, 400, { error: 'Bad seq.' });
      if (store.markRead(c, role, body.seq)) broadcast(id, 'read', { conv: id, role, seq: c.read[role] }, null);
      return reply(req, res, 200, { read: c.read });
    }

    if (action === 'typing' && req.method === 'POST') {
      if (allow(`typing:${id}:${role}`, 30, 60000)) broadcast(id, 'typing', { conv: id, role }, role);
      return reply(req, res, 200, { ok: true });
    }

    if (action === 'status' && req.method === 'POST') {
      if (role !== 'agent') return reply(req, res, 403, { error: 'Only the team can close a chat.' });
      const body = await readJson(req, 1024);
      if (body.status !== 'open' && body.status !== 'closed') return reply(req, res, 400, { error: 'Bad status.' });
      if (store.setStatus(c, body.status)) {
        broadcast(id, 'status', { conv: id, status: c.status }, null);
        broadcast(id, 'conversation', store.summary(c), 'customer');
      }
      return reply(req, res, 200, { status: c.status });
    }

    return reply(req, res, 405, { error: 'Method not allowed.' });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) reply(req, res, err.status || 500, { error: err.status ? err.message : 'Something went wrong.' });
      else res.end();
      if (!err.status) console.error(err);
    });
  });

  server.on('close', () => {
    clearInterval(ping);
    clearInterval(housekeeping);
    store.flush();
  });

  // Close open event streams too, so server.close() can finish.
  const close = server.close.bind(server);
  server.close = (cb) => {
    for (const s of streams) s.res.end();
    streams.clear();
    return close(cb);
  };

  return { server, store };
}
