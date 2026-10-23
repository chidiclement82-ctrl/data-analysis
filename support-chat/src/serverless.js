// The secure chat API for serverless hosting (Netlify Functions + Netlify
// Blobs). Same endpoints and rules as relay.js, but every request is handled
// on its own: nothing is kept in memory between requests, and there's no live
// event stream (the pages check for news every few seconds instead).
//
// Storage is a key/value store with get/setJSON/delete/list, like
// @netlify/blobs. Nothing is ever read, changed and written back where two
// people could write at once: each message is its own key, and "something
// changed" markers are new keys too.
//
//   team-key                       the team's public key (set from /team)
//   team-auth                      the team password, scrypt-hashed, and the
//                                  secret that signs sign-ins (when the
//                                  password was chosen on /team, not set
//                                  as AGENT_PASSWORD)
//   meta/<chat>                    customer key, token hash, status, created
//   msg/<chat>/<seq>-<msgId>       one sealed message
//   ids/<chat>/<msgId>             its seq (so a retried message isn't added twice)
//   read/<chat>/<role>             how far customer / team has read
//   typing/<chat>/<role>           when they last typed
//   act/<chat>/<time>              when the chat last changed (newest wins)

import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { keyId } from '../public/assets/e2ee.js';
import { validPublicKey, validEnvelope } from './relay.js';

const SESSION_MS = 12 * 3600000;
const B64 = /^[A-Za-z0-9_-]+$/;
const CHAT_ID = /^[A-Za-z0-9_-]{16,64}$/;
const sha = (s) => createHash('sha256').update(s).digest();
const pad = (n, w) => String(n).padStart(w, '0');
const scryptAsync = promisify(scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function createServerlessApi({ store, env = {}, now = () => Date.now() }) {
  const config = {
    agentPassword: env.AGENT_PASSWORD || '',
    pinnedTeamKey: env.TEAM_KEY ? JSON.parse(env.TEAM_KEY) : null,
    brand: {
      brandName: env.BRAND_NAME || 'Secure Support',
      replyTime: env.REPLY_TIME || 'We usually reply within a few minutes',
      contactUrl: env.CONTACT_URL || '',
      contactLabel: env.CONTACT_LABEL || '',
    },
    retentionDays: Number(env.RETENTION_DAYS) || 30,
    maxMessageBytes: Number(env.MAX_MESSAGE_BYTES) || 2_500_000,
    allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  };
  if (config.pinnedTeamKey && !validPublicKey(config.pinnedTeamKey)) throw new Error('TEAM_KEY is not a P-256 public key.');

  // Best effort only: each serverless instance counts on its own.
  const buckets = new Map();
  function allow(key, limit, windowMs) {
    const t = now();
    let b = buckets.get(key);
    if (!b || b.reset <= t) { b = { count: 0, reset: t + windowMs }; buckets.set(key, b); }
    return ++b.count <= limit;
  }

  // The team password: AGENT_PASSWORD if set, otherwise the one chosen on
  // /team the first time (stored only as a scrypt hash). Sign-in tokens are
  // signed, so any instance can check them.
  async function auth() {
    if (config.agentPassword) return { key: sha('secure-chat session|' + config.agentPassword), record: null };
    const record = await store.get('team-auth', { type: 'json' });
    return record ? { key: Buffer.from(record.secret, 'base64url'), record } : null;
  }
  async function passwordMatches(password, a) {
    if (typeof password !== 'string' || !password) return false;
    if (!a.record) return timingSafeEqual(sha(password), sha(config.agentPassword));
    const got = await scryptAsync(password.normalize('NFKC'), Buffer.from(a.record.salt, 'base64url'), 32, SCRYPT);
    return timingSafeEqual(got, Buffer.from(a.record.hash, 'base64url'));
  }
  function agentToken(a) {
    const exp = now() + SESSION_MS;
    const sig = createHmac('sha256', a.key).update('agent|' + exp).digest('base64url');
    return `a.${exp}.${sig}`;
  }
  async function validAgentToken(token) {
    const [, exp, sig] = token.split('.');
    if (!exp || !sig || !(Number(exp) > now())) return false;
    const a = await auth();
    if (!a) return false;
    const want = createHmac('sha256', a.key).update('agent|' + exp).digest();
    const got = Buffer.from(sig, 'base64url');
    return got.length === want.length && timingSafeEqual(got, want);
  }

  async function teamKey() {
    const jwk = config.pinnedTeamKey || await store.get('team-key', { type: 'json' });
    return jwk ? { key: jwk, id: await keyId(jwk) } : { key: null, id: null };
  }

  async function who(req) {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') || '');
    if (!m) return null;
    const value = m[1];
    if (value.startsWith('a.')) return (await validAgentToken(value)) ? { role: 'agent' } : null;
    if (value.startsWith('c.')) {
      const [, id, secret] = value.split('.');
      if (!id || !secret || !CHAT_ID.test(id)) return null;
      const meta = await store.get(`meta/${id}`, { type: 'json' });
      if (!meta) return null;
      return timingSafeEqual(sha(secret), Buffer.from(meta.tokenHash, 'hex')) ? { role: 'customer', conv: id } : null;
    }
    return null;
  }

  async function keys(prefix) {
    const { blobs } = await store.list({ prefix });
    return blobs.map((b) => b.key);
  }

  // Marks a chat as changed; older markers are removed.
  async function touch(id) {
    const t = now();
    await store.setJSON(`act/${id}/${pad(t, 13)}`, {});
    for (const k of await keys(`act/${id}/`)) if (k < `act/${id}/${pad(t, 13)}`) await store.delete(k);
  }

  // { chatId: lastChangedAt } for every chat.
  async function activity() {
    const out = {};
    for (const k of await keys('act/')) {
      const [, id, t] = k.split('/');
      out[id] = Math.max(out[id] || 0, Number(t));
    }
    return out;
  }

  async function readMarks(id) {
    const [customer, agent] = await Promise.all(['customer', 'agent'].map((r) => store.get(`read/${id}/${r}`, { type: 'json' })));
    return { customer: customer?.seq || 0, agent: agent?.seq || 0 };
  }

  async function typingMarks(id) {
    const [customer, agent] = await Promise.all(['customer', 'agent'].map((r) => store.get(`typing/${id}/${r}`, { type: 'json' })));
    return { customer: customer?.at || 0, agent: agent?.at || 0 };
  }

  async function messages(id, after = 0) {
    const wanted = (await keys(`msg/${id}/`))
      .map((k) => ({ k, seq: Number(k.slice(`msg/${id}/`.length).split('-')[0]) }))
      .filter((m) => m.seq > after)
      .sort((a, b) => a.seq - b.seq);
    const out = await Promise.all(wanted.map((m) => store.get(m.k, { type: 'json' })));
    return out.filter(Boolean);
  }

  async function summary(meta, lastAt) {
    const [read, typing] = await Promise.all([readMarks(meta.id), typingMarks(meta.id)]);
    return {
      id: meta.id, customerKey: meta.customerKey, agentKeyId: meta.agentKeyId,
      status: meta.status, createdAt: meta.createdAt, lastAt: lastAt || meta.createdAt, read, typing,
    };
  }

  async function removeChat(id) {
    const all = await Promise.all(['msg', 'ids', 'read', 'typing', 'act'].map((p) => keys(`${p}/${id}/`)));
    await Promise.all(all.flat().map((k) => store.delete(k)));
    await store.delete(`meta/${id}`);
  }

  // Deletes chats nobody has touched for retentionDays.
  async function prune() {
    const cutoff = now() - config.retentionDays * 86400000;
    let removed = 0;
    for (const [id, t] of Object.entries(await activity())) {
      if (t < cutoff) { await removeChat(id); removed++; }
    }
    return removed;
  }

  // HTTP ---------------------------------------------------------------------
  function originAllowed(req) {
    const origin = req.headers.get('origin');
    if (!origin) return true;
    try { if (new URL(origin).host === new URL(req.url).host) return true; } catch { return false; }
    return config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin);
  }

  function json(status, body, extra = {}) {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        ...extra,
      },
    });
  }

  async function body(req, limit) {
    const text = await req.text();
    if (Buffer.byteLength(text) > limit) throw Object.assign(new Error('too big'), { status: 413 });
    try { return JSON.parse(text || '{}'); } catch { throw Object.assign(new Error('bad json'), { status: 400 }); }
  }

  async function handle(req, ip = '?') {
    const url = new URL(req.url);
    const path = url.pathname;
    if (!originAllowed(req)) return json(403, { error: 'This website may not use the chat.' });

    if (path === '/healthz') return json(200, { ok: true });

    if (path === '/config.json' && req.method === 'GET') {
      const team = await teamKey();
      const needsSetup = !(await auth());
      return json(200, { ...config.brand, retentionDays: config.retentionDays, teamKey: team.key, teamKeyId: team.id, teamKeyPinned: Boolean(config.pinnedTeamKey), needsSetup, live: false });
    }

    // No event stream here: the pages fall back to checking every few seconds.
    if (path === '/api/events') return json(404, { error: 'No live stream on this host.', polling: true });

    // First time only, when AGENT_PASSWORD isn't set: whoever turns the chat
    // on chooses the team password. After that it can't be claimed again.
    if (path === '/api/agent/setup' && req.method === 'POST') {
      if (!allow('setup:' + ip, 10, 15 * 60000)) return json(429, { error: 'Too many tries. Wait 15 minutes.' });
      if (await auth()) return json(409, { error: 'This chat is already set up. Sign in with the team password.' });
      const { password } = await body(req, 4096);
      if (typeof password !== 'string' || password.length < 8) return json(400, { error: 'Choose a team password of at least 8 characters.' });
      const salt = randomBytes(16);
      const hash = await scryptAsync(password.normalize('NFKC'), salt, 32, SCRYPT);
      const record = { salt: salt.toString('base64url'), hash: hash.toString('base64url'), secret: randomBytes(32).toString('base64url'), at: now() };
      const saved = await store.setJSON('team-auth', record, { onlyIfNew: true });
      if (saved && saved.modified === false) return json(409, { error: 'This chat is already set up. Sign in with the team password.' });
      return json(201, { token: agentToken({ key: Buffer.from(record.secret, 'base64url') }), expiresIn: SESSION_MS });
    }

    if (path === '/api/agent/login' && req.method === 'POST') {
      if (!allow('login:' + ip, 10, 15 * 60000)) return json(429, { error: 'Too many tries. Wait 15 minutes.' });
      const a = await auth();
      if (!a) return json(503, { error: "The chat isn't set up yet. Open /team to set it up." });
      const { password } = await body(req, 4096);
      if (!(await passwordMatches(password, a))) return json(401, { error: "That password isn't right." });
      return json(200, { token: agentToken(a), expiresIn: SESSION_MS });
    }

    if (path === '/api/agent/logout' && req.method === 'POST') return json(200, { ok: true });

    const caller = await who(req);

    if (path === '/api/agent/team-key' && req.method === 'POST') {
      if (caller?.role !== 'agent') return json(401, { error: 'Sign in again.' });
      if (config.pinnedTeamKey) return json(409, { error: 'The team key is fixed by TEAM_KEY on the server.' });
      const { publicKey } = await body(req, 4096);
      if (!validPublicKey(publicKey)) return json(400, { error: 'Bad key.' });
      await store.setJSON('team-key', publicKey);
      return json(200, { teamKeyId: await keyId(publicKey) });
    }

    // The inbox list. With ?since=, only chats changed after then come back in
    // full; `ids` always lists every chat, so deleted ones can be dropped.
    if (path === '/api/agent/conversations' && req.method === 'GET') {
      if (caller?.role !== 'agent') return json(401, { error: 'Sign in again.' });
      const since = Number(url.searchParams.get('since')) || 0;
      const act = await activity();
      const changed = Object.entries(act).filter(([, t]) => t > since);
      const conversations = (await Promise.all(changed.map(async ([id, t]) => {
        const meta = await store.get(`meta/${id}`, { type: 'json' });
        return meta && summary(meta, t);
      }))).filter(Boolean);
      return json(200, { conversations, ids: Object.keys(act), now: now() });
    }

    if (path === '/api/conversations' && req.method === 'POST') {
      if (!allow('create:' + ip, 20, 3600000)) return json(429, { error: 'Too many new chats from here. Try again later.' });
      const b = await body(req, 4096);
      if (!validPublicKey(b.customerKey)) return json(400, { error: 'Bad customer key.' });
      if (typeof b.agentKeyId !== 'string' || !B64.test(b.agentKeyId) || b.agentKeyId.length !== 43) return json(400, { error: 'Bad team key id.' });
      const team = await teamKey();
      if (!team.id) return json(503, { error: "The chat isn't set up yet." });
      if (b.agentKeyId !== team.id) return json(409, { error: "The team's security key has changed. Reload the page." });
      const id = randomBytes(16).toString('base64url');
      const secret = randomBytes(32).toString('base64url');
      await store.setJSON(`meta/${id}`, { id, customerKey: b.customerKey, agentKeyId: b.agentKeyId, tokenHash: sha(secret).toString('hex'), status: 'open', createdAt: now() });
      await touch(id);
      return json(201, { id, token: `c.${id}.${secret}` });
    }

    const m = /^\/api\/conversations\/([A-Za-z0-9_-]{16,64})(?:\/(messages|read|typing|status))?$/.exec(path);
    if (!m) return json(404, { error: 'Not found.' });
    const [, id, action] = m;
    if (!caller || (caller.role === 'customer' && caller.conv !== id)) return json(401, { error: 'Not your chat.' });
    const meta = await store.get(`meta/${id}`, { type: 'json' });
    if (!meta) return json(404, { error: 'This chat was deleted.' });
    const role = caller.role;

    if (!action && req.method === 'GET') return json(200, await summary(meta, (await activity())[id]));

    if (!action && req.method === 'DELETE') {
      await removeChat(id);
      return json(200, { ok: true });
    }

    if (action === 'messages' && req.method === 'GET') {
      const after = Number(url.searchParams.get('after')) || 0;
      const [list, read, typing] = await Promise.all([messages(id, after), readMarks(id), typingMarks(id)]);
      return json(200, { messages: list, read, status: meta.status, typing, now: now() });
    }

    if (action === 'messages' && req.method === 'POST') {
      if (!allow(`msg:${id}:${role}`, 60, 60000)) return json(429, { error: 'Slow down a little.' });
      const env = await body(req, config.maxMessageBytes);
      if (!validEnvelope(env, id, role)) return json(400, { error: 'Bad message.' });
      const at = now();
      // Time-ordered and unique enough: milliseconds plus three random digits.
      const seq = at * 1000 + randomInt(1000);
      const claim = await store.setJSON(`ids/${id}/${env.id}`, { seq, at }, { onlyIfNew: true });
      if (claim && claim.modified === false) {
        const first = await store.get(`ids/${id}/${env.id}`, { type: 'json' });
        return json(200, { seq: first.seq, at: first.at });
      }
      const message = { seq, at, v: env.v, id: env.id, conv: id, from: role, ts: env.ts, iv: env.iv, ct: env.ct };
      await store.setJSON(`msg/${id}/${pad(seq, 16)}-${env.id}`, message);
      const mark = await store.get(`read/${id}/${role}`, { type: 'json' });
      if (!mark || mark.seq < seq) await store.setJSON(`read/${id}/${role}`, { seq });
      if (role === 'customer' && meta.status === 'closed') await store.setJSON(`meta/${id}`, { ...meta, status: 'open' });
      await store.delete(`typing/${id}/${role}`);
      await touch(id);
      return json(201, { seq, at });
    }

    if (action === 'read' && req.method === 'POST') {
      const { seq } = await body(req, 1024);
      if (!Number.isFinite(seq)) return json(400, { error: 'Bad seq.' });
      const mark = await store.get(`read/${id}/${role}`, { type: 'json' });
      if (!mark || mark.seq < seq) {
        await store.setJSON(`read/${id}/${role}`, { seq });
        await touch(id);
      }
      return json(200, { read: await readMarks(id) });
    }

    if (action === 'typing' && req.method === 'POST') {
      if (allow(`typing:${id}:${role}`, 30, 60000)) {
        await store.setJSON(`typing/${id}/${role}`, { at: now() });
        await touch(id);
      }
      return json(200, { ok: true });
    }

    if (action === 'status' && req.method === 'POST') {
      if (role !== 'agent') return json(403, { error: 'Only the team can close a chat.' });
      const { status } = await body(req, 1024);
      if (status !== 'open' && status !== 'closed') return json(400, { error: 'Bad status.' });
      if (meta.status !== status) {
        await store.setJSON(`meta/${id}`, { ...meta, status });
        await touch(id);
      }
      return json(200, { status });
    }

    return json(405, { error: 'Method not allowed.' });
  }

  return {
    prune,
    async fetch(req, ip) {
      try {
        return await handle(req, ip);
      } catch (err) {
        if (!err.status) console.error(err);
        return json(err.status || 500, { error: err.status ? err.message : 'Something went wrong.' });
      }
    },
  };
}

// An in-memory store with the same methods, for tests and local runs.
export function memoryStore() {
  const data = new Map();
  return {
    data,
    async get(key) { return data.has(key) ? structuredClone(data.get(key)) : null; },
    async setJSON(key, value, opts = {}) {
      if (opts.onlyIfNew && data.has(key)) return { modified: false };
      data.set(key, structuredClone(value));
      return { modified: true };
    },
    async delete(key) { data.delete(key); },
    async list({ prefix = '' } = {}) {
      return { blobs: [...data.keys()].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key })) };
    },
  };
}
