import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommentQueue, isWorthAnswering } from '../src/filters.js';

const c = (id, userId, text, ts = 1000) => ({ id, userId, name: userId, text, ts });

test('skips spam, emoji-only, links and blocked words', () => {
  assert.equal(isWorthAnswering('hi'), false);
  assert.equal(isWorthAnswering('😂😂😂'), false);
  assert.equal(isWorthAnswering('aaaaaaa'), false);
  assert.equal(isWorthAnswering('follow me www.spam.com'), false);
  assert.equal(isWorthAnswering('you are dumb bot', { blocked: ['dumb'] }), false);
  assert.equal(isWorthAnswering('how tall is a giraffe?'), true);
});

test('prefers questions and mentions of the cartoon', () => {
  const q = new CommentQueue({ cartoonName: 'Bobo' });
  q.add(c('1', 'a', 'nice stream today'));
  q.add(c('2', 'b', 'why is the sky blue?'));
  q.add(c('3', 'c', 'Bobo do you like pizza'));
  assert.equal(q.next(1000).id, '3');
  assert.equal(q.next(1000).id, '2');
  assert.equal(q.next(1000).id, '1');
  assert.equal(q.next(1000), null);
});

test('keeps only the newest comment per viewer and drops stale ones', () => {
  const q = new CommentQueue({ maxAgeMs: 10_000 });
  q.add(c('1', 'a', 'first question here?', 0));
  q.add(c('2', 'a', 'second question here?', 5_000));
  assert.equal(q.items.length, 1);
  assert.equal(q.next(20_000), null); // too old by now
});

test('one viewer cannot get answered over and over', () => {
  const q = new CommentQueue({ perUserCooldownMs: 30_000 });
  q.markAnswered('a', 1000);
  q.add(c('1', 'a', 'another question for you?', 2000));
  assert.equal(q.next(5000), null); // still cooling down
  assert.equal(q.next(40_000).id, '1');
});
