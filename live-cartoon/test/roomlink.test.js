import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRoomId, roomIdFrom } from '../src/roomlink.js';

const ID = '7432165498712345678';

test('reads a room ID typed in, or found in a full LIVE address', async () => {
  assert.equal(await resolveRoomId(ID), ID);
  assert.equal(await resolveRoomId(`https://www.tiktok.com/@chidi/live?enter_from=share&room_id=${ID}&lang=en`), ID);
  assert.equal(roomIdFrom(`{"roomId":"${ID}"}`), ID);
  assert.equal(roomIdFrom('https://www.tiktok.com/@chidi/live'), null);
});

test('follows a short share link to the address with the room ID', async () => {
  const hops = {
    'https://vt.tiktok.com/ZSabc123/': `https://www.tiktok.com/@chidi/live?room_id=${ID}&u_code=x`,
  };
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return new Response('', { status: 301, headers: { location: hops[url] } });
  };
  assert.equal(await resolveRoomId('Watch my LIVE! https://vt.tiktok.com/ZSabc123/', fetchImpl), ID);
  assert.deepEqual(seen, ['https://vt.tiktok.com/ZSabc123/']);
});

test('finds the room ID in the page when the address has none', async () => {
  const fetchImpl = async () => new Response(`<script>{"liveRoom":{"roomId":"${ID}"}}</script>`, { status: 200 });
  assert.equal(await resolveRoomId('https://www.tiktok.com/@chidi/live', fetchImpl), ID);
});

test('refuses links that are not TikTok and explains when no room is found', async () => {
  let fetched = false;
  const fetchImpl = async () => { fetched = true; return new Response('nothing here'); };
  await assert.rejects(resolveRoomId('https://evil.example/@chidi/live', fetchImpl), /isn't a TikTok link/);
  await assert.rejects(resolveRoomId('http://www.tiktok.com/@chidi/live', fetchImpl), /isn't a TikTok link/);
  assert.equal(fetched, false);
  await assert.rejects(resolveRoomId('https://www.tiktok.com/@chidi/live', fetchImpl), /Couldn't find the LIVE room/);
});
