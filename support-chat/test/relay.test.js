import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as e2ee from '../public/assets/e2ee.js';
import { createRelay } from '../src/relay.js';
import { createStore } from '../src/store.js';

const PASSWORD = 'staff-only-password';
let relay, base, dataDir, team, teamKeyId;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'support-chat-'));
  team = await e2ee.generateKeyPair();
  teamKeyId = await e2ee.keyId(team.publicJwk);
  relay = createRelay({ agentPassword: PASSWORD, teamKey: team.publicJwk, brandName: 'Test Shop', allowedOrigins: ['https://partner.example'], dataDir });
  await new Promise((r) => relay.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${relay.server.address().port}`;
});
after(() => {
  relay.server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function api(path, { token, method = 'GET', body, origin } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (origin) headers.Origin = origin;
  return fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function agentLogin() {
  const res = await api('/api/agent/login', { method: 'POST', body: { password: PASSWORD } });
  assert.equal(res.status, 200);
  return (await res.json()).token;
}

async function newCustomer() {
  const customer = await e2ee.generateKeyPair();
  const res = await api('/api/conversations', { method: 'POST', body: { customerKey: customer.publicJwk, agentKeyId: teamKeyId } });
  assert.equal(res.status, 201);
  const { id, token } = await res.json();
  const key = await e2ee.conversationKey(customer.privateKey, team.publicJwk, id);
  return { ...customer, id, token, key };
}

// Reads Server-Sent Events from the relay until `count` named events arrive.
async function events(token, count, names) {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 5000).unref();
  const res = await fetch(base + '/api/events', { headers: { Authorization: 'Bearer ' + token }, signal: ctrl.signal });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const got = [];
  let buf = '';
  const done = (async () => {
    while (got.length < count) {
      const { value, done: end } = await reader.read().catch(() => ({ done: true }));
      if (end) break;
      buf += new TextDecoder().decode(value);
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (ev && names.includes(ev)) got.push({ event: ev, data: JSON.parse(data) });
      }
    }
    ctrl.abort();
    return got;
  })();
  return done;
}

test('health check, and only our own pages (or listed sites) may use the API', async () => {
  assert.equal((await api('/healthz')).status, 200);
  assert.equal((await api('/healthz', { origin: base })).status, 200);
  const ok = await api('/healthz', { origin: 'https://partner.example' });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://partner.example');
  assert.equal((await api('/healthz', { origin: 'https://evil.example' })).status, 403);
});

test('serves the customer page, the team inbox and their files with a strict policy', async () => {
  for (const [path, text] of [['/', 'composer-text'], ['/team', 'Team inbox'], ['/assets/e2ee.js', 'AES-GCM'], ['/assets/base.css', ':root']]) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    assert.ok((await res.text()).includes(text), path);
  }
  assert.equal((await fetch(base + '/assets/nope.js')).status, 404);
  assert.equal((await fetch(base + '/assets/../src/relay.js')).status, 404);
  assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
});

test('settings for the pages: name and the team key', async () => {
  const cfg = await (await api('/config.json')).json();
  assert.equal(cfg.brandName, 'Test Shop');
  assert.deepEqual(cfg.teamKey, team.publicJwk);
  assert.equal(cfg.teamKeyId, teamKeyId);
  assert.equal(cfg.teamKeyPinned, true);
});

test('team sign-in needs the right password', async () => {
  assert.equal((await api('/api/agent/login', { method: 'POST', body: { password: 'nope' } })).status, 401);
  assert.equal((await api('/api/agent/conversations')).status, 401);
  const token = await agentLogin();
  assert.equal((await api('/api/agent/conversations', { token })).status, 200);
});

test('a full encrypted conversation, and the relay only ever sees ciphertext', async () => {
  const agent = await agentLogin();
  const customer = await newCustomer();

  const teamEvents = events(agent, 2, ['message']);
  const customerEvents = events(customer.token, 3, ['message', 'read']);
  await new Promise((r) => setTimeout(r, 50));

  const hello = await e2ee.seal(customer.key, { conv: customer.id, from: 'customer', payload: { type: 'text', text: 'My order #1042 is missing the plantain' } });
  let res = await api(`/api/conversations/${customer.id}/messages`, { token: customer.token, method: 'POST', body: hello });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).seq, 1);

  // Retrying the same message doesn't duplicate it.
  res = await api(`/api/conversations/${customer.id}/messages`, { token: customer.token, method: 'POST', body: hello });
  assert.equal(res.status, 200);

  // The team finds the chat, derives the key from the customer's public key and reads it.
  const list = (await (await api('/api/agent/conversations', { token: agent })).json()).conversations;
  const conv = list.find((c) => c.id === customer.id);
  assert.equal(conv.count, 1);
  const teamKey = await e2ee.conversationKey(team.privateKey, conv.customerKey, conv.id);
  const { messages } = await (await api(`/api/conversations/${conv.id}/messages`, { token: agent })).json();
  assert.equal((await e2ee.open(teamKey, messages[0])).text, 'My order #1042 is missing the plantain');

  assert.equal((await api(`/api/conversations/${conv.id}/read`, { token: agent, method: 'POST', body: { seq: 1 } })).status, 200);
  const answer = await e2ee.seal(teamKey, { conv: conv.id, from: 'agent', payload: { type: 'text', text: 'So sorry! A rider is bringing it now.', by: 'Ada' } });
  assert.equal((await api(`/api/conversations/${conv.id}/messages`, { token: agent, method: 'POST', body: answer })).status, 201);

  const seen = await customerEvents;
  const reply = seen.find((e) => e.event === 'message' && e.data.message.from === 'agent');
  assert.equal((await e2ee.open(customer.key, reply.data.message)).text, 'So sorry! A rider is bringing it now.');
  assert.ok(seen.some((e) => e.event === 'read' && e.data.role === 'agent' && e.data.seq === 1));
  assert.equal((await teamEvents).length, 2);

  relay.store.flush();
  const onDisk = readFileSync(join(dataDir, 'conversations.json'), 'utf8');
  assert.ok(onDisk.includes(customer.id));
  assert.ok(!onDisk.includes('plantain') && !onDisk.includes('rider'));
});

test('customers can only reach their own chat, and cannot speak as the team', async () => {
  const a = await newCustomer();
  const b = await newCustomer();
  assert.equal((await api(`/api/conversations/${b.id}/messages`, { token: a.token })).status, 401);
  assert.equal((await api(`/api/conversations/${a.id}/messages`, { token: `c.${a.id}.wrong` })).status, 401);
  assert.equal((await api('/api/agent/conversations', { token: a.token })).status, 401);

  const fake = await e2ee.seal(a.key, { conv: a.id, from: 'agent', payload: { text: 'refund approved' } });
  assert.equal((await api(`/api/conversations/${a.id}/messages`, { token: a.token, method: 'POST', body: fake })).status, 400);
  const elsewhere = await e2ee.seal(a.key, { conv: b.id, from: 'customer', payload: { text: 'x' } });
  assert.equal((await api(`/api/conversations/${a.id}/messages`, { token: a.token, method: 'POST', body: elsewhere })).status, 400);
  assert.equal((await api(`/api/conversations/${a.id}/status`, { token: a.token, method: 'POST', body: { status: 'closed' } })).status, 403);
});

test('rejects chats made for an old team key, and bad keys', async () => {
  const customer = await e2ee.generateKeyPair();
  const stale = await e2ee.keyId((await e2ee.generateKeyPair()).publicJwk);
  assert.equal((await api('/api/conversations', { method: 'POST', body: { customerKey: customer.publicJwk, agentKeyId: stale } })).status, 409);
  assert.equal((await api('/api/conversations', { method: 'POST', body: { customerKey: { ...customer.publicJwk, d: 'secret' }, agentKeyId: teamKeyId } })).status, 400);
});

test('closing, reopening by writing, and deleting a chat', async () => {
  const agent = await agentLogin();
  const c = await newCustomer();
  assert.equal((await (await api(`/api/conversations/${c.id}/status`, { token: agent, method: 'POST', body: { status: 'closed' } })).json()).status, 'closed');
  const msg = await e2ee.seal(c.key, { conv: c.id, from: 'customer', payload: { text: 'one more thing' } });
  await api(`/api/conversations/${c.id}/messages`, { token: c.token, method: 'POST', body: msg });
  assert.equal((await (await api(`/api/conversations/${c.id}`, { token: c.token })).json()).status, 'open');

  assert.equal((await api(`/api/conversations/${c.id}`, { token: c.token, method: 'DELETE' })).status, 200);
  assert.equal((await api(`/api/conversations/${c.id}`, { token: agent })).status, 404);
});

test('oversized messages are refused', async () => {
  const c = await newCustomer();
  const huge = { v: 1, id: e2ee.randomId(), conv: c.id, from: 'customer', ts: Date.now(), iv: 'AAAAAAAAAAAAAAAA', ct: 'A'.repeat(3_000_000) };
  assert.equal((await api(`/api/conversations/${c.id}/messages`, { token: c.token, method: 'POST', body: huge })).status, 413);
  // ...and the next request still works.
  assert.equal((await api('/healthz')).status, 200);
  await agentLogin();
});

test('the team key can be set from the inbox (signed in only) unless TEAM_KEY fixes it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'support-key-'));
  const r = createRelay({ agentPassword: PASSWORD, dataDir: dir });
  await new Promise((ok) => r.server.listen(0, '127.0.0.1', ok));
  const b = `http://127.0.0.1:${r.server.address().port}`;
  const post = (path, body, token) => fetch(b + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await (await fetch(b + '/config.json')).json()).teamKey, null);
    const customer = await e2ee.generateKeyPair();
    assert.equal((await post('/api/conversations', { customerKey: customer.publicJwk, agentKeyId: teamKeyId })).status, 503);
    assert.equal((await post('/api/agent/team-key', { publicKey: team.publicJwk })).status, 401);
    const { token } = await (await post('/api/agent/login', { password: PASSWORD })).json();
    assert.equal((await post('/api/agent/team-key', { publicKey: { ...team.publicJwk, d: 'x' } }, token)).status, 400);
    assert.equal((await post('/api/agent/team-key', { publicKey: team.publicJwk }, token)).status, 200);
    assert.equal((await (await fetch(b + '/config.json')).json()).teamKeyId, teamKeyId);
    assert.equal((await post('/api/conversations', { customerKey: customer.publicJwk, agentKeyId: teamKeyId })).status, 201);
  } finally {
    r.server.closeAllConnections(); await new Promise((ok) => r.server.close(ok));
  }
  // Kept across restarts.
  const again = createRelay({ dataDir: dir });
  await new Promise((ok) => again.server.listen(0, '127.0.0.1', ok));
  const cfg = await (await fetch(`http://127.0.0.1:${again.server.address().port}/config.json`)).json();
  assert.equal(cfg.teamKeyId, teamKeyId);
  again.server.closeAllConnections(); await new Promise((ok) => again.server.close(ok));
  rmSync(dir, { recursive: true, force: true });

  // Fixed by TEAM_KEY: the inbox can't change it.
  const agent = await agentLogin();
  const other = await e2ee.generateKeyPair();
  assert.equal((await api('/api/agent/team-key', { token: agent, method: 'POST', body: { publicKey: other.publicJwk } })).status, 409);
});

test('chats survive a restart and old ones are pruned', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'support-store-'));
  let t = 1_000_000;
  const s1 = createStore({ dataDir: dir, retentionDays: 1, now: () => t });
  const c = s1.create({ id: 'x'.repeat(22), customerKey: team.publicJwk, agentKeyId: teamKeyId, tokenHash: '00' });
  s1.append(c, { v: 1, id: 'm'.repeat(22), conv: c.id, from: 'customer', ts: 1, iv: 'i', ct: 'c' });
  s1.flush();
  const s2 = createStore({ dataDir: dir, retentionDays: 1, now: () => t });
  assert.equal(s2.get(c.id).messages.length, 1);
  t += 2 * 86400000;
  assert.equal(s2.prune(), 1);
  rmSync(dir, { recursive: true, force: true });
});
