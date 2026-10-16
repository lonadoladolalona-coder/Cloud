#!/usr/bin/env node
// Stand-in for `sglang serve` that speaks the /v1/videos API MiniMax documents for H3-Base.
// Records its argv and every request as JSON lines in $FAKE_SGLANG_LOG so tests can assert on them.
//   FAKE_SGLANG_LOAD_MS   delay before /health answers (default 150)
//   FAKE_SGLANG_EXIT      exit immediately with this code (startup failure)
//   FAKE_SGLANG_REJECT    answer POST /v1/videos with HTTP 422 and this text
//   FAKE_SGLANG_FAIL_JOB  report the generation as failed with this message
//   FAKE_SGLANG_HANG      never finish the generation
//   FAKE_SGLANG_NO_HEALTH answer 404 on /health (server without a health route)
import { appendFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const log = (entry) => process.env.FAKE_SGLANG_LOG && appendFileSync(process.env.FAKE_SGLANG_LOG, `${JSON.stringify(entry)}\n`);

log({ event: 'start', argv, pid: process.pid, env: { CUSTOM_VAR: process.env.CUSTOM_VAR ?? null } });
if (process.env.FAKE_SGLANG_PID_FILE) writeFileSync(process.env.FAKE_SGLANG_PID_FILE, String(process.pid));
if (process.env.FAKE_SGLANG_EXIT) {
  console.error('CUDA out of memory while loading transformer');
  process.exit(Number(process.env.FAKE_SGLANG_EXIT));
}

const variant = arg('--model-variant');
const port = Number(arg('--port'));
const readyAt = Date.now() + Number(process.env.FAKE_SGLANG_LOAD_MS ?? 150);
const videos = new Map();
let counter = 0;

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/health') {
    if (process.env.FAKE_SGLANG_NO_HEALTH) return send(res, 404, { detail: 'Not Found' });
    return Date.now() >= readyAt ? send(res, 200, { status: 'ok' }) : send(res, 503, { status: 'loading' });
  }
  if (req.method === 'POST' && url.pathname === '/v1/videos') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      log({ event: 'create', variant, body });
      if (process.env.FAKE_SGLANG_REJECT) return send(res, 422, process.env.FAKE_SGLANG_REJECT, 'text/plain');
      const id = `vid_${++counter}`;
      videos.set(id, { polls: 0, body });
      send(res, 200, { id, status: 'queued' });
    });
    return;
  }
  const m = /^\/v1\/videos\/([\w-]+)(\/content)?$/.exec(url.pathname);
  if (m && videos.has(m[1])) {
    const v = videos.get(m[1]);
    if (req.method === 'DELETE') {
      log({ event: 'delete', id: m[1] });
      videos.delete(m[1]);
      return send(res, 200, { deleted: true });
    }
    if (m[2]) {
      log({ event: 'content', id: m[1] });
      return send(res, 200, `FAKEMP4:${variant}:${v.body.task}:${v.body.seed}`, 'video/mp4');
    }
    v.polls++;
    if (process.env.FAKE_SGLANG_HANG) return send(res, 200, { id: m[1], status: 'in_progress', progress: 10 });
    if (process.env.FAKE_SGLANG_FAIL_JOB) return send(res, 200, { id: m[1], status: 'failed', error: { message: process.env.FAKE_SGLANG_FAIL_JOB } });
    return send(res, 200, v.polls < 3 ? { id: m[1], status: 'in_progress', progress: v.polls * 30 } : { id: m[1], status: 'completed', progress: 100 });
  }
  send(res, 404, { detail: 'Not Found' });
}).listen(port, '127.0.0.1');

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { log({ event: 'sigterm' }); process.exit(0); });
