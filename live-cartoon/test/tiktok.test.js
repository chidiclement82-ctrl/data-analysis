import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { UserOfflineError, SignAPIError } from 'tiktok-live-connector';
import { TikTokLink, explain } from '../src/tiktok.js';

// A stand-in TikTok connection whose connect() we resolve or reject by hand.
function fakeFactory() {
  const made = [];
  const create = (user, opts) => {
    const c = new EventEmitter();
    c.opts = opts;
    c.connect = (roomId) => new Promise((resolve, reject) => { c.roomId = roomId; c.resolve = resolve; c.reject = reject; });
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

test('a pasted LIVE link connects straight to that room, skipping the look-ups', async () => {
  const { made, create } = fakeFactory();
  const link = new TikTokLink({ username: 'chidi', createConnection: create });
  await link.useLiveLink('https://www.tiktok.com/@chidi/live?room_id=7432165498712345678');
  assert.equal(made[0].roomId, '7432165498712345678');
  assert.equal(made[0].opts.fetchRoomInfoOnConnect, false);
  made[0].resolve();
  await tick();
  assert.equal(link.state, 'live');
  made[0].emit('streamEnd');
  assert.equal(link.roomId, null, 'next LIVE is looked up fresh');
  await link.stop();
});

test('a bad LIVE link is explained and nothing breaks', async () => {
  const { made, create } = fakeFactory();
  const link = new TikTokLink({ username: 'chidi', createConnection: create });
  await link.useLiveLink('hello');
  assert.equal(made.length, 0);
  assert.equal(link.state, 'waiting');
  assert.match(link.detail, /isn't a TikTok link/);
  await link.stop();
});

test('says which look-ups failed when the LIVE cannot be found', () => {
  const err = new Error('Failed to retrieve Room ID from all sources.');
  err.config = { requestErrs: [
    new Error('[fetchRoomInfoHtmlRoute] Failed to extract the SIGI_STATE HTML tag, you might be blocked by TikTok.'),
    new Error('Request failed with status code 403 (Forbidden): GET http://www.tiktok.com/api-live/user/room/'),
    new Error('[fetchRoomIdRoute] Failed to retrieve Room ID from Euler Stream ... >>lack of permission<< ...'),
  ] };
  const text = explain(err, 'chidi');
  assert.match(text, /TikTok blocked the server/);
  assert.match(text, /Euler Stream key can't look up rooms/);
  assert.match(text, /paste your LIVE link/);
  assert.equal(text.match(/TikTok blocked the server/g).length, 1, 'repeated reasons shown once');
});
