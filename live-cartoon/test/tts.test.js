import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTts } from '../src/tts.js';

test('without a key the browser voice is used', async () => {
  const tts = createTts({});
  assert.equal(tts.enabled, false);
  assert.equal(await tts.speak('hello'), null);
});

test('stores ElevenLabs audio and serves it by id', async () => {
  let req;
  const fetchImpl = async (url, init) => { req = { url, init }; return new Response(new Uint8Array([1, 2, 3])); };
  const tts = createTts({ apiKey: 'k', voiceId: 'v1', fetchImpl });
  const url = await tts.speak('hello');
  assert.match(req.url, /\/v1\/text-to-speech\/v1\?/);
  assert.equal(req.init.headers['xi-api-key'], 'k');
  const id = url.match(/\/audio\/(.+)\.mp3/)[1];
  assert.deepEqual([...tts.get(id)], [1, 2, 3]);
});
