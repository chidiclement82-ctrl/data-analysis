import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { UserOfflineError, SignAPIError } from 'tiktok-live-connector';
import { TikTokLink, explain } from '../src/tiktok.js';

// A stand-in TikTok connection whose connect() we resolve or reject by hand.
function fakeFactory() {
  const made = [];
  const create = () => {
    const c = new EventEmitter();
    c.connect = () => new Promise((resolve, reject) => { c.resolve = resolve; c.reject = reject; });
    c.disconnect = () => { c.closed = true; return Promise.resolve(); };
    made.push(c);
    return c;
  };
  return { made, create };
}
const tick = () => new Promise((r) => setImmediate(r));

test('Reconnect starts a fresh attempt and a slow old one cannot override it', async () => {
  const { made, create } = fakeFactory();
  const link = new TikTokLink({ username: '@chidi', createConnection: create });
  link.start();
  assert.equal(link.state, 'connecting');
  link.reconnect(); // pressed while the first attempt is still trying
  assert.equal(made.length, 2);
  assert.ok(made[0].closed, 'old attempt is dropped');

  made[1].resolve();
  await tick();
  assert.equal(link.state, 'live');

  made[0].reject(new UserOfflineError('offline')); // the old attempt finally fails
  await tick();
  assert.equal(link.state, 'live', 'stale failure ignored');
  await link.stop();
});

test('Reconnect after a failure connects again right away', async () => {
  const { made, create } = fakeFactory();
  const link = new TikTokLink({ username: 'chidi', createConnection: create });
  link.start();
  made[0].reject(new UserOfflineError('offline'));
  await tick();
  assert.equal(link.state, 'waiting');
  assert.match(link.detail, /isn't live yet/);
  link.reconnect();
  assert.equal(link.state, 'connecting');
  made[1].resolve();
  await tick();
  assert.equal(link.state, 'live');
  await link.stop();
});

test('Reconnect without a username explains what to do', () => {
  const link = new TikTokLink({ username: '' });
  link.reconnect();
  assert.equal(link.state, 'off');
  assert.match(link.detail, /TIKTOK_USERNAME/);
});

test('connection errors are explained in plain words', () => {
  assert.match(explain(new SignAPIError('Unauthorized'), 'chidi'), /EULER_API_KEY/);
  assert.match(explain(new Error('Failed to retrieve Room ID from all sources.'), 'chidi'), /Are you live/);
  assert.match(explain(new Error('Too Many Requests 429'), 'chidi'), /eulerstream\.com/);
});
