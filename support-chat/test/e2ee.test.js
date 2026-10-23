import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as e2ee from '../public/assets/e2ee.js';

async function pairUp() {
  const team = await e2ee.generateKeyPair();
  const customer = await e2ee.generateKeyPair();
  const conv = e2ee.randomId();
  return {
    team, customer, conv,
    customerKey: await e2ee.conversationKey(customer.privateKey, team.publicJwk, conv),
    teamKey: await e2ee.conversationKey(team.privateKey, customer.publicJwk, conv),
  };
}

test('a customer message opens only with the team key', async () => {
  const { conv, customerKey, teamKey } = await pairUp();
  const env = await e2ee.seal(customerKey, { conv, from: 'customer', payload: { type: 'text', text: 'Where is my jollof? 🍛' } });
  assert.equal(env.from, 'customer');
  assert.ok(!JSON.stringify(env).includes('jollof'));
  assert.deepEqual(await e2ee.open(teamKey, env), { type: 'text', text: 'Where is my jollof? 🍛' });

  const stranger = await pairUp();
  await assert.rejects(e2ee.open(stranger.teamKey, env));
});

test('the relay cannot change who sent it, when, or which chat it is in', async () => {
  const { conv, customerKey, teamKey } = await pairUp();
  const env = await e2ee.seal(customerKey, { conv, from: 'customer', payload: { text: 'hi' } });
  await assert.rejects(e2ee.open(teamKey, { ...env, from: 'agent' }));
  await assert.rejects(e2ee.open(teamKey, { ...env, ts: env.ts + 1 }));
  await assert.rejects(e2ee.open(teamKey, { ...env, id: e2ee.randomId() }));
  await assert.rejects(e2ee.open(teamKey, { ...env, conv: e2ee.randomId() }));
  const ct = e2ee.fromB64(env.ct); ct[0] ^= 1;
  await assert.rejects(e2ee.open(teamKey, { ...env, ct: e2ee.toB64(ct) }));
});

test('the same message is sealed differently every time', async () => {
  const { conv, customerKey } = await pairUp();
  const a = await e2ee.seal(customerKey, { conv, from: 'customer', payload: 'x', id: 'aaaaaaaaaaaaaaaaaaaaaa', ts: 1 });
  const b = await e2ee.seal(customerKey, { conv, from: 'customer', payload: 'x', id: 'aaaaaaaaaaaaaaaaaaaaaa', ts: 1 });
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
});

test('both sides see the same safety number, and it changes with the keys', async () => {
  const { team, customer } = await pairUp();
  const one = await e2ee.safetyNumber(customer.publicJwk, team.publicJwk);
  assert.equal(one, await e2ee.safetyNumber(team.publicJwk, customer.publicJwk));
  assert.match(one, /^(\d{5} ){11}\d{5}$/);
  const other = await e2ee.generateKeyPair();
  assert.notEqual(one, await e2ee.safetyNumber(customer.publicJwk, other.publicJwk));
  assert.match(await e2ee.keyFingerprint(team.publicJwk), /^(\d{5} ){5}\d{5}$/);
  assert.equal((await e2ee.keyId(team.publicJwk)).length, 43);
});

test('team key backup restores with the passphrase and only with it', async () => {
  const team = await e2ee.generateKeyPair(true);
  const backup = await e2ee.exportBackup(team.privateKey, team.publicJwk, 'correct horse battery staple');
  await assert.rejects(e2ee.importBackup(backup, 'wrong'), /wrong passphrase/);

  const restored = await e2ee.importBackup(JSON.parse(JSON.stringify(backup)), 'correct horse battery staple');
  assert.equal(restored.privateKey.extractable, false);
  const customer = await e2ee.generateKeyPair();
  const conv = e2ee.randomId();
  const k1 = await e2ee.conversationKey(customer.privateKey, team.publicJwk, conv);
  const k2 = await e2ee.conversationKey(restored.privateKey, customer.publicJwk, conv);
  const env = await e2ee.seal(k1, { conv, from: 'customer', payload: 'ok' });
  assert.equal(await e2ee.open(k2, env), 'ok');

  // A backup whose public key was swapped is refused.
  const evil = await e2ee.generateKeyPair();
  await assert.rejects(e2ee.importBackup({ ...backup, publicKey: evil.publicJwk }, 'correct horse battery staple'));
});

test('rejects keys that are not P-256 public keys', async () => {
  assert.throws(() => e2ee.cleanPublicJwk({ kty: 'RSA' }));
  assert.throws(() => e2ee.cleanPublicJwk({ kty: 'EC', crv: 'P-384', x: 'a', y: 'b' }));
  const { publicJwk } = await e2ee.generateKeyPair();
  const offCurve = { ...publicJwk, y: publicJwk.x };
  await assert.rejects(e2ee.importPublicKey(offCurve));
});
