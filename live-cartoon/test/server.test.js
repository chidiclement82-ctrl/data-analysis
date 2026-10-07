import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const PORT = 3000 + Math.floor(Math.random() * 2000) + 1000;
const base = `http://127.0.0.1:${PORT}`;
let proc;

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    // No TikTok username or AI key: the server still runs, just idle.
    env: { PATH: process.env.PATH, PORT: String(PORT), HOST: '127.0.0.1', TIKTOK_USERNAME: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => { if (String(d).includes('Control panel')) resolve(); });
    proc.on('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
});
after(() => proc.kill());

const open = (path, headers) => new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}${path}`, { headers });
  const first = new Promise((r) => ws.once('message', (d) => r(JSON.parse(d))));
  ws.on('close', (code) => resolve({ closed: code }));
  ws.on('open', async () => resolve({ ws, first: await first }));
});

test('serves the stage and control pages', async () => {
  for (const p of ['/stage', '/control', '/js/stage.js']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 200, p);
  }
  assert.equal((await fetch(`${base}/../server.js`)).status, 404);
});

test('control panel gets status; other websites are refused', async () => {
  const ok = await open('/ws?role=control', { Origin: base });
  assert.equal(ok.first.type, 'status');
  assert.equal(ok.first.tiktok.state, 'off');
  ok.ws.close();

  const evil = await open('/ws?role=control', { Origin: 'https://evil.example' });
  assert.equal(evil.closed, 4003);

  const rebind = await open('/ws?role=control', { Origin: 'http://evil.example', Host: 'evil.example' });
  assert.equal(rebind.closed, 4003);
});

test('a direct line reaches the stage', async () => {
  const stage = await open('/ws?role=stage', { Origin: base });
  assert.equal(stage.first.type, 'hello');
  const control = await open('/ws?role=control', { Origin: base });
  const said = new Promise((r) => stage.ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'say') r(m); }));
  control.ws.send(JSON.stringify({ type: 'say', text: 'Hello **TikTok**!' }));
  const m = await said;
  assert.equal(m.text, 'Hello TikTok!');
  assert.equal(m.audio, null);
  stage.ws.send(JSON.stringify({ type: 'done', id: m.id }));
  stage.ws.close();
  control.ws.close();
});
