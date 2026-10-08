import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunks, build, frameState, blinkTimes, INTRO, OUTRO } from '../src/timeline.js';
import { fakeSpeech } from '../src/audio.js';

test('captions come in small chunks that cover the whole line, with no lone word left over', () => {
  const c = chunks('Do one small thing today that you will *thank* yourself for', 1, 4);
  assert.ok(c.every((x) => x.text.split(' ').length <= 4));
  assert.ok(c.at(-1).text.split(' ').length >= 2);
  assert.equal(c[0].start, 1);
  assert.ok(Math.abs(c.at(-1).end - 4) < 1e-9);
});

test('lines are laid out in order with an intro and a follow card at the end', () => {
  const lines = ['Listen to me.', 'Start *today*.'].map((text) => ({ text, ...fakeSpeech(text) }));
  const tl = build(lines, 30);
  assert.equal(tl.segments[0].start, INTRO);
  assert.ok(tl.segments[1].start > tl.segments[0].end);
  assert.ok(Math.abs(tl.duration - (tl.outroAt + OUTRO)) < 0.01);

  const blinks = blinkTimes(tl.duration, 3);
  const mid = frameState(tl, Math.round(((tl.segments[1].start + tl.segments[1].end) / 2) * 30), blinks);
  assert.match(mid.caption, /today/);
  const end = frameState(tl, Math.round((tl.duration - 0.2) * 30), blinks);
  assert.match(end.caption, /daily push/);
  assert.ok(end.smile > mid.smile);
});
