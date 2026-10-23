import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as e2ee from '../public/assets/e2ee.js';
import { createServerlessApi, memoryStore } from '../src/serverless.js';

const PASSWORD = 'staff-only-password';
const base = 'https://chat.example';

async function setup(env = {}) {
  let t = 1_800_000_000_000;
  const store = memoryStore();
  const api = createServerlessApi({ store, env: { AGENT_PASSWORD: PASSWORD, ...env }, now: () => t });
  const call = async (path, { token, method = 'GET', body, origin } = {}) => {
    const headers = {};
    if (token) headers.authorization = 'Bearer ' + token;
    if (origin) headers.origin = origin;
    const res = await api.fetch(new Request(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), '1.2.3.4');
    return { status: res.status, json: await res.json() };
  };
  const login = async () => (await call('/api/agent/login', { method: 'POST', body: { password: PASSWORD } })).json.token;
  return { store, api, call, login, tick: (ms) => { t += ms; }, now: () => t };
}

async function withTeam(env) {
  const s = await setup(env);
  const team = await e2ee.generateKeyPair();
  const teamKeyId = await e2ee.keyId(team.publicJwk);
  const agent = await s.login();
  assert.equal((await s.call('/api/agent/team-key', { token: agent, method: 'POST', body: { publicKey: team.publicJwk } })).status, 200);
  async function customer() {
    const me = await e2ee.generateKeyPair();
    const res = await s.call('/api/conversations', { method: 'POST', body: { customerKey: me.publicJwk, agentKeyId: teamKeyId } });
    assert.equal(res.status, 201);
    const { id, token } = res.json;
    return { ...me, id, token, key: await e2ee.conversationKey(me.privateKey, team.publicJwk, id) };
  }
  return { ...s, team, teamKeyId, agent, customer };
}

test('serverless: settings, origin checks, and no live stream (pages poll instead)', async () => {
  const s = await setup({ BRAND_NAME: 'Test Shop' });
  const cfg = (await s.call('/config.json')).json;
  assert.equal(cfg.brandName, 'Test Shop');
  assert.equal(cfg.teamKey, null);
  assert.equal((await s.call('/healthz', { origin: base })).status, 200);
  assert.equal((await s.call('/healthz', { origin: 'https://evil.example' })).status, 403);
  const ev = await s.call('/api/events', { token: await s.login() });
  assert.equal(ev.status, 404);
  assert.equal(ev.json.polling, true);
});

test('serverless: signed team tokens work on any instance, expire, and change with the password', async () => {
  const s = await setup();
  assert.equal((await s.call('/api/agent/login', { method: 'POST', body: { password: 'nope' } })).status, 401);
  const token = await s.login();
  const other = createServerlessApi({ store: s.store, env: { AGENT_PASSWORD: PASSWORD }, now: s.now });
  const res = await other.fetch(new Request(base + '/api/agent/conversations', { headers: { authorization: 'Bearer ' + token } }));
  assert.equal(res.status, 200);
  const changed = createServerlessApi({ store: s.store, env: { AGENT_PASSWORD: 'new password' }, now: s.now });
  assert.equal((await changed.fetch(new Request(base + '/api/agent/conversations', { headers: { authorization: 'Bearer ' + token } }))).status, 401);
  assert.equal((await s.call('/api/agent/conversations', { token: token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) })).status, 401);
  s.tick(13 * 3600000);
  assert.equal((await s.call('/api/agent/conversations', { token })).status, 401);
});

test('serverless: chats need the team key; the full conversation works and stores only ciphertext', async () => {
  const s = await withTeam();
  const c = await s.customer();
  const hello = await e2ee.seal(c.key, { conv: c.id, from: 'customer', payload: { type: 'text', text: 'Where is my plantain?' } });
  const first = await s.call(`/api/conversations/${c.id}/messages`, { token: c.token, method: 'POST', body: hello });
  assert.equal(first.status, 201);
  const again = await s.call(`/api/conversations/${c.id}/messages`, { token: c.token, method: 'POST', body: hello });
  assert.equal(again.status, 200);
  assert.equal(again.json.seq, first.json.seq);

  s.tick(1000);
  const list = (await s.call('/api/agent/conversations', { token: s.agent })).json;
  assert.deepEqual(list.ids, [c.id]);
  const conv = list.conversations[0];
  const teamKey = await e2ee.conversationKey(s.team.privateKey, conv.customerKey, conv.id);
  const got = (await s.call(`/api/conversations/${c.id}/messages`, { token: s.agent })).json;
  assert.equal(got.messages.length, 1);
  assert.equal((await e2ee.open(teamKey, got.messages[0])).text, 'Where is my plantain?');

  await s.call(`/api/conversations/${c.id}/read`, { token: s.agent, method: 'POST', body: { seq: first.json.seq } });
  await s.call(`/api/conversations/${c.id}/typing`, { token: s.agent, method: 'POST' });
  let mine = (await s.call(`/api/conversations/${c.id}/messages?after=${first.json.seq}`, { token: c.token })).json;
  assert.equal(mine.messages.length, 0);
  assert.equal(mine.read.agent, first.json.seq);
  assert.equal(mine.typing.agent, s.now());

  s.tick(5);
  const answer = await e2ee.seal(teamKey, { conv: c.id, from: 'agent', payload: { type: 'text', text: 'On its way!' } });
  const sent = await s.call(`/api/conversations/${c.id}/messages`, { token: s.agent, method: 'POST', body: answer });
  assert.ok(sent.json.seq > first.json.seq);
  mine = (await s.call(`/api/conversations/${c.id}/messages?after=${first.json.seq}`, { token: c.token })).json;
  assert.equal((await e2ee.open(c.key, mine.messages[0])).text, 'On its way!');
  assert.equal(mine.typing.agent, 0); // sending clears "typing…"

  const stored = JSON.stringify([...s.store.data.values()]);
  assert.ok(!stored.includes('plantain') && !stored.includes('On its way'));
});

test('serverless: the inbox list only returns chats changed since the last check', async () => {
  const s = await withTeam();
  const a = await s.customer();
  s.tick(1000);
  const b = await s.customer();
  const full = (await s.call('/api/agent/conversations', { token: s.agent })).json;
  assert.equal(full.conversations.length, 2);
  s.tick(1000);
  const since = full.now;
  s.tick(1000);
  const msg = await e2ee.seal(a.key, { conv: a.id, from: 'customer', payload: 'x' });
  await s.call(`/api/conversations/${a.id}/messages`, { token: a.token, method: 'POST', body: msg });
  const delta = (await s.call('/api/agent/conversations?since=' + since, { token: s.agent })).json;
  assert.deepEqual(delta.conversations.map((c) => c.id), [a.id]);
  assert.deepEqual(new Set(delta.ids), new Set([a.id, b.id]));
  // Only one "changed" marker is kept per chat.
  assert.equal([...s.store.data.keys()].filter((k) => k.startsWith(`act/${a.id}/`)).length, 1);
});

test('serverless: customers stay in their own chat and cannot speak as the team', async () => {
  const s = await withTeam();
  const a = await s.customer();
  const b = await s.customer();
  assert.equal((await s.call(`/api/conversations/${b.id}/messages`, { token: a.token })).status, 401);
  assert.equal((await s.call('/api/agent/conversations', { token: a.token })).status, 401);
  const fake = await e2ee.seal(a.key, { conv: a.id, from: 'agent', payload: 'refund approved' });
  assert.equal((await s.call(`/api/conversations/${a.id}/messages`, { token: a.token, method: 'POST', body: fake })).status, 400);
  assert.equal((await s.call(`/api/conversations/${a.id}/status`, { token: a.token, method: 'POST', body: { status: 'closed' } })).status, 403);
  const stale = await e2ee.keyId((await e2ee.generateKeyPair()).publicJwk);
  assert.equal((await s.call('/api/conversations', { method: 'POST', body: { customerKey: a.publicJwk, agentKeyId: stale } })).status, 409);
});

test('serverless: solved, reopened by the customer, deleted, and pruned when old', async () => {
  const s = await withTeam({ RETENTION_DAYS: '1' });
  const c = await s.customer();
  assert.equal((await s.call(`/api/conversations/${c.id}/status`, { token: s.agent, method: 'POST', body: { status: 'closed' } })).json.status, 'closed');
  const msg = await e2ee.seal(c.key, { conv: c.id, from: 'customer', payload: 'one more thing' });
  await s.call(`/api/conversations/${c.id}/messages`, { token: c.token, method: 'POST', body: msg });
  assert.equal((await s.call(`/api/conversations/${c.id}`, { token: c.token })).json.status, 'open');

  assert.equal((await s.call(`/api/conversations/${c.id}`, { token: c.token, method: 'DELETE' })).status, 200);
  assert.equal((await s.call(`/api/conversations/${c.id}`, { token: s.agent })).status, 404);
  assert.ok(![...s.store.data.keys()].some((k) => k.includes(c.id)));

  const old = await s.customer();
  s.tick(2 * 86400000);
  assert.equal(await s.api.prune(), 1);
  assert.equal((await s.call(`/api/conversations/${old.id}`, { token: await s.login() })).status, 404);
});

test('serverless: TEAM_KEY fixes the key, and oversized messages are refused', async () => {
  const team = await e2ee.generateKeyPair();
  const s = await setup({ TEAM_KEY: JSON.stringify(team.publicJwk) });
  assert.equal((await s.call('/config.json')).json.teamKeyPinned, true);
  const other = await e2ee.generateKeyPair();
  assert.equal((await s.call('/api/agent/team-key', { token: await s.login(), method: 'POST', body: { publicKey: other.publicJwk } })).status, 409);

  const me = await e2ee.generateKeyPair();
  const { id, token } = (await s.call('/api/conversations', { method: 'POST', body: { customerKey: me.publicJwk, agentKeyId: await e2ee.keyId(team.publicJwk) } })).json;
  const huge = { v: 1, id: e2ee.randomId(), conv: id, from: 'customer', ts: 1, iv: 'AAAAAAAAAAAAAAAA', ct: 'A'.repeat(3_000_000) };
  assert.equal((await s.call(`/api/conversations/${id}/messages`, { token, method: 'POST', body: huge })).status, 413);
});

test('serverless: without AGENT_PASSWORD, the first person on /team chooses the password, once', async () => {
  let t = 1_800_000_000_000;
  const store = memoryStore();
  const api = createServerlessApi({ store, env: {}, now: () => t });
  const call = async (path, { token, method = 'GET', body } = {}) => {
    const headers = token ? { authorization: 'Bearer ' + token } : {};
    const res = await api.fetch(new Request(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), '5.6.7.8');
    return { status: res.status, json: await res.json() };
  };
  assert.equal((await call('/config.json')).json.needsSetup, true);
  assert.equal((await call('/api/agent/login', { method: 'POST', body: { password: 'anything' } })).status, 503);
  assert.equal((await call('/api/agent/setup', { method: 'POST', body: { password: 'short' } })).status, 400);

  const setup = await call('/api/agent/setup', { method: 'POST', body: { password: 'our team password' } });
  assert.equal(setup.status, 201);
  assert.equal((await call('/api/agent/conversations', { token: setup.json.token })).status, 200);
  assert.equal((await call('/config.json')).json.needsSetup, false);
  assert.ok(!JSON.stringify(store.data.get('team-auth')).includes('our team password'));

  // Nobody can claim it again, and the chosen password is the one that works.
  assert.equal((await call('/api/agent/setup', { method: 'POST', body: { password: 'attacker password' } })).status, 409);
  assert.equal((await call('/api/agent/login', { method: 'POST', body: { password: 'attacker password' } })).status, 401);
  const login = await call('/api/agent/login', { method: 'POST', body: { password: 'our team password' } });
  assert.equal(login.status, 200);

  // Tokens are checked by any instance sharing the store.
  const other = createServerlessApi({ store, env: {}, now: () => t });
  const res = await other.fetch(new Request(base + '/api/agent/conversations', { headers: { authorization: 'Bearer ' + login.json.token } }));
  assert.equal(res.status, 200);
});
