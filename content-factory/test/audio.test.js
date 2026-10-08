import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toWav, silence, envelope, fakeSpeech, pcmDuration } from '../src/audio.js';

test('WAV header describes 16-bit mono audio at the given rate', () => {
  const wav = toWav(silence(0.5, 24000), 24000);
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(40), 24000); // 0.5 s * 24000 * 2 bytes
});

test('loudness envelope is 0 for silence and reaches ~1 for speech', () => {
  const { pcm, rate } = fakeSpeech('one two three');
  const env = envelope(Buffer.concat([silence(1, rate), pcm]), rate, 30);
  assert.equal(env[5], 0);
  assert.ok(Math.max(...env) >= 0.99);
  assert.ok(pcmDuration(pcm, rate) > 1);
});
