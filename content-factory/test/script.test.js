import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFor, clean, writeScript, FORMATS } from '../src/script.js';

test('each day gets 3 different formats, and days differ', () => {
  const d = new Date('2026-10-08');
  const today = [0, 1, 2].map((s) => planFor(d, s));
  assert.equal(new Set(today.map((p) => p.format.id)).size, 3);
  assert.deepEqual(planFor(d, 0), planFor(new Date('2026-10-08'), 0), 'repeatable');
  assert.notDeepEqual(planFor(new Date('2026-10-09'), 0), today[0]);
  assert.ok(FORMATS.length >= 3);
});

test('scripts are tidied: hook without asterisks, hashtags normalised', () => {
  const s = clean({ hook: '*Stop* waiting', lines: ['a *b* c', 'd *e* f', 'g *h* i'], caption: 'Ready?', hashtags: ['#Motivation', 'self improvement'] });
  assert.equal(s.hook, 'Stop waiting');
  assert.deepEqual(s.hashtags, ['#motivation', '#selfimprovement']);
  assert.throws(() => clean({ lines: ['only one'] }), /too short/);
});

test('asks Gemini for a JSON script with the day\'s format and topic', async () => {
  const calls = [];
  const ai = { models: { generateContent: async (req) => {
    calls.push(req);
    return { text: JSON.stringify({ hook: 'Wake up', lines: ['One *step*.', 'Two *steps*.', 'Keep *going*.', 'Follow me.'], caption: 'Are you in?', hashtags: ['motivation'] }) };
  } } };
  const plan = planFor(new Date('2026-10-08'), 1);
  const s = await writeScript({ ai, model: 'gemini-flash-latest', plan });
  assert.equal(s.lines.length, 4);
  assert.equal(calls[0].config.responseMimeType, 'application/json');
  assert.ok(calls[0].contents.includes(plan.topic));
});
