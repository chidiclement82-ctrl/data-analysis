import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speak, spoken } from '../src/voice.js';

const audio = (bytes, mime = 'audio/L16;codec=pcm;rate=24000') => ({
  candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from(bytes).toString('base64'), mimeType: mime } }] } }],
});
const err = (status) => Object.assign(new Error(`status ${status}`), { status });

test('speaks the line without highlight marks and reads the sample rate', async () => {
  const calls = [];
  const ai = { models: { generateContent: async (req) => { calls.push(req); return audio([1, 2, 3, 4], 'audio/L16;rate=22050'); } } };
  const r = await speak({ ai, text: 'Start *today*.', voice: 'Orus' });
  assert.equal(r.rate, 22050);
  assert.equal(r.pcm.length, 4);
  assert.match(calls[0].contents[0].parts[0].text, /Start today\.$/);
  assert.equal(calls[0].config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Orus');
  assert.equal(spoken('a *b*'), 'a b');
});

test('tries the next model when one is unavailable, and waits out rate limits', async () => {
  const seen = [];
  const replies = { first: [err(404)], second: [err(429), audio([9, 9])] };
  const ai = { models: { generateContent: async ({ model }) => {
    seen.push(model);
    const r = replies[model].shift();
    if (r instanceof Error) throw r;
    return r;
  } } };
  let waited = 0;
  const r = await speak({ ai, text: 'Go.', models: ['first', 'second'], wait: async () => { waited++; } });
  assert.deepEqual(seen, ['first', 'second', 'second']);
  assert.equal(waited, 1);
  assert.equal(r.model, 'second');
});
