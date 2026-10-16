import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app';
import { createMockBackend } from '../src/server/gen/mock';
import { H3RequestError, buildH3Request, type H3Item } from '../src/server/h3/request';
import { listDirs } from '../src/server/h3/browse';
import { scanModelFolder } from '../src/server/h3/scan';
import type { H3Scan, JobRecord, SettingsView } from '../src/shared/api';
import { blankDoc, type GenParams, type PromptDoc } from '../src/shared';
import { makeModel } from './fixtures/h3-model';

const FAKE_SGLANG = path.resolve('tests/fixtures/fake-sglang.mjs');
const PORT = 8787;
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

const params: GenParams = { durationSec: 8, aspectRatio: '16:9', resolution: '768p', seed: 42, generateAudio: true };
const NO_TOOLS = { env: { PATH: '' } as NodeJS.ProcessEnv, run: () => Promise.reject(new Error('no nvidia-smi')) };
const ref = (label: string, kind: H3Item['kind'], role: H3Item['role']): H3Item => ({ label, kind, role, uri: `file:///x/${label}` });
const base = { prompt: 'integrated_multimodal_description: [Shot 1] hi', params };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'h3-model-test-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('scanModelFolder', () => {
  it('accepts a complete Hugging Face layout and reports both checkpoints', async () => {
    const root = makeModel(path.join(dir, 'MiniMax-H3'));
    const scan = await scanModelFolder(root, NO_TOOLS);
    expect(scan.layout).toBe('hf-root');
    expect(scan.root).toBe(root);
    expect(scan.variants.map((v) => [v.variant, v.present, v.complete])).toEqual([['fl2va', true, true], ['ref2va', true, true]]);
    expect(scan.suggested.modelDir).toBe(root);
    expect(scan.ready).toBe(false); // no SGLang found
    expect(scan.notes.some((n) => n.level === 'warn' && /SGLang was not found/.test(n.text))).toBe(true);
  });

  it('finds the model when given a parent folder, the FL2VA folder, a quoted path or a lower-case layout', async () => {
    const root = makeModel(path.join(dir, 'models', 'MiniMax-H3'));
    expect((await scanModelFolder(dir, NO_TOOLS)).root).toBe(root);
    expect((await scanModelFolder(path.join(root, 'FL2VA'), NO_TOOLS)).root).toBe(root);
    expect((await scanModelFolder(`"${root}"`, NO_TOOLS)).root).toBe(root);
    const lower = makeModel(path.join(dir, 'lower'), { lowerCase: true });
    const scan = await scanModelFolder(lower, NO_TOOLS);
    expect(scan.variants.every((v) => v.complete)).toBe(true);
  });

  it('works with only one checkpoint and says what is unavailable', async () => {
    const root = makeModel(path.join(dir, 'm'), { variants: ['FL2VA'] });
    const scan = await scanModelFolder(root, NO_TOOLS);
    expect(scan.variants.find((v) => v.variant === 'fl2va')!.complete).toBe(true);
    expect(scan.variants.find((v) => v.variant === 'ref2va')!.present).toBe(false);
    expect(scan.notes.some((n) => /Ref2VA\/ not found/.test(n.text))).toBe(true);
  });

  it('flags missing components, Git-LFS pointer stubs and missing weight shards', async () => {
    const root = makeModel(path.join(dir, 'm'), {
      omit: ['FL2VA/audio_vae'],
      lfsPointers: ['Ref2VA/transformer'],
      missingShard: ['FL2VA/text_encoder'],
    });
    const scan = await scanModelFolder(root, NO_TOOLS);
    const fl = scan.variants.find((v) => v.variant === 'fl2va')!;
    const rf = scan.variants.find((v) => v.variant === 'ref2va')!;
    expect(fl.complete).toBe(false);
    expect(fl.components.audio_vae).toBe('missing');
    expect(fl.components.text_encoder).toBe('no_weights');
    expect(fl.problems.join(' ')).toMatch(/1 of 2 weight shards are missing/);
    expect(rf.components.transformer).toBe('lfs_pointer');
    expect(rf.problems.join(' ')).toMatch(/Git-LFS pointer/);
    expect(scan.notes[0]!.level).toBe('error');
  });

  it('notices an interrupted Hugging Face download', async () => {
    const root = makeModel(path.join(dir, 'm'));
    mkdirSync(path.join(root, '.cache', 'huggingface', 'download', 'FL2VA'), { recursive: true });
    writeFileSync(path.join(root, '.cache', 'huggingface', 'download', 'FL2VA', 'x.safetensors.abc.incomplete'), 'partial');
    const scan = await scanModelFolder(root, NO_TOOLS);
    expect(scan.notes.some((n) => n.level === 'error' && /interrupted/.test(n.text))).toBe(true);
  });

  it('explains a ComfyUI install, an unrelated folder and a missing path', async () => {
    const comfy = path.join(dir, 'ComfyUI');
    mkdirSync(path.join(comfy, 'models', 'diffusion_models'), { recursive: true });
    writeFileSync(path.join(comfy, 'main.py'), '');
    writeFileSync(path.join(comfy, 'models', 'diffusion_models', 'minimax_h3_fl2va_bf16.safetensors'), 'x');
    const c = await scanModelFolder(comfy, NO_TOOLS);
    expect(c.layout).toBe('comfyui');
    expect(c.notes.map((n) => n.text).join('\n')).toMatch(/ComfyUI install[\s\S]*minimax_h3_fl2va_bf16/);

    const empty = path.join(dir, 'empty');
    mkdirSync(empty);
    const e = await scanModelFolder(empty, NO_TOOLS);
    expect(e.layout).toBe('unknown');
    expect(e.notes[0]!.text).toMatch(/No H3 model found/);

    const missing = await scanModelFolder(path.join(dir, 'nope'), NO_TOOLS);
    expect(missing.exists).toBe(false);
    expect(missing.notes[0]!.text).toMatch(/Folder not found/);
    expect((await scanModelFolder('', NO_TOOLS)).notes[0]!.text).toMatch(/Enter the path/);
  });

  it('finds SGLang in a virtual environment beside the models, and reads the GPUs', async () => {
    const root = makeModel(path.join(dir, 'MiniMax-H3'));
    const bin = path.join(dir, '.venv', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'sglang'), '#!/bin/sh\n');
    chmodSync(path.join(bin, 'sglang'), 0o755);
    const scan = await scanModelFolder(root, { env: { PATH: '' }, run: async () => 'NVIDIA GeForce RTX 4090, 24564\nNVIDIA GeForce RTX 4090, 24564\n' });
    expect(scan.tooling.sglang?.path).toBe(path.join(bin, 'sglang'));
    expect(scan.tooling.gpus).toEqual([{ name: 'NVIDIA GeForce RTX 4090', memoryMiB: 24564 }, { name: 'NVIDIA GeForce RTX 4090', memoryMiB: 24564 }]);
    expect(scan.ready).toBe(true);
    expect(scan.suggested).toEqual({ modelDir: root, sglangPath: path.join(bin, 'sglang'), numGpus: 2 });
  });
});

describe('listDirs (folder picker)', () => {
  it('lists sub-folders, marks model folders and hides dot folders', async () => {
    makeModel(path.join(dir, 'MiniMax-H3'));
    mkdirSync(path.join(dir, 'other'));
    mkdirSync(path.join(dir, '.hidden'));
    const l = await listDirs(dir);
    expect(l.dirs.map((d) => [d.name, d.isModel])).toEqual([['MiniMax-H3', true], ['other', false]]);
    expect(l.parent).toBe(path.dirname(dir));
    await expect(listDirs(path.join(dir, 'nope'))).rejects.toThrow(/Cannot open/);
  });
});

describe('buildH3Request', () => {
  it('T2VA: task t2va, no conditions, named aspect ratio', () => {
    const r = buildH3Request({ ...base, mode: 'T2VA', items: [] });
    expect(r.variant).toBe('fl2va');
    expect(r.body).toEqual({ task: 't2va', prompt: base.prompt, conditions: [], target: { short_edge: 768, aspect_ratio: '16:9', duration_seconds: 8 }, seed: 42 });
    expect(r.notes).toEqual([]);
  });

  it('I2VA / L2VA / FL2VA: keyframe conditions at frame 0 and -1, aspect follows the image', () => {
    const i2 = buildH3Request({ ...base, mode: 'I2VA', items: [ref('Picture 1', 'image', 'first_frame')] });
    expect(i2.body.task).toBe('fl2va');
    expect(i2.body.conditions).toEqual([{ type: 'image', uri: 'file:///x/Picture 1', role: 'keyframe', frame_index: 0 }]);
    expect(i2.body.target.aspect_ratio).toBe('auto');
    expect(i2.notes.join(' ')).toMatch(/follows the first frame/);

    const l2 = buildH3Request({ ...base, mode: 'L2VA', items: [ref('Picture 1', 'image', 'last_frame')] });
    expect(l2.body.conditions.map((c) => c.frame_index)).toEqual([-1]);

    const fl = buildH3Request({ ...base, mode: 'FL2VA', items: [ref('Picture 1', 'image', 'first_frame'), ref('Picture 2', 'image', 'last_frame')] });
    expect(fl.body.conditions.map((c) => c.frame_index)).toEqual([0, -1]);
  });

  it('REFERENCE: every file is a "reference" condition on the Ref2VA checkpoint', () => {
    const r = buildH3Request({ ...base, mode: 'REFERENCE', items: [ref('Picture 1', 'image', 'subject'), ref('Video 1', 'video', 'edit_source'), ref('Audio 1', 'audio', 'audio_reference')] });
    expect(r.variant).toBe('ref2va');
    expect(r.body.task).toBe('ref2va');
    expect(r.body.conditions.map((c) => [c.type, c.role])).toEqual([['image', 'reference'], ['video', 'reference'], ['audio', 'reference']]);
  });

  it('enforces the documented limits with plain-language errors', () => {
    const fail = (over: Partial<Parameters<typeof buildH3Request>[0]>) => () => buildH3Request({ ...base, mode: 'T2VA', items: [], ...over });
    expect(fail({ params: { ...params, durationSec: 3 } })).toThrow(H3RequestError);
    expect(fail({ params: { ...params, durationSec: 16 } })).toThrow(/4–15 second/);
    expect(fail({ prompt: '  ' })).toThrow(/empty/);
    expect(fail({ mode: 'REFERENCE', items: [ref('Audio 1', 'audio', 'audio_reference')] })).toThrow(/needs at least one image or video/);
    const ten = Array.from({ length: 10 }, (_, i) => ref(`Picture ${i + 1}`, 'image', 'subject'));
    expect(fail({ mode: 'REFERENCE', items: ten })).toThrow(/at most 9 images/);
    const vids = Array.from({ length: 4 }, (_, i) => ref(`Video ${i + 1}`, 'video', 'edit_source'));
    expect(fail({ mode: 'REFERENCE', items: vids })).toThrow(/at most 3 reference videos/);
    expect(fail({ mode: 'REFERENCE', items: [] })).toThrow(/at least one/);
    expect(fail({ mode: 'I2VA', items: [ref('Video 1', 'video', 'edit_source')] })).toThrow(/full-reference/);
  });

  it('notes settings the model cannot honour and picks a seed when none is given', () => {
    const r = buildH3Request({ ...base, mode: 'T2VA', items: [], params: { ...params, resolution: '1080p', generateAudio: false, seed: null }, randomSeed: () => 7 });
    expect(r.body.seed).toBe(7);
    expect(r.notes.join(' ')).toMatch(/fixed at 768p[\s\S]*always generates audio/);
  });
});

// ---------------------------------------------------------------------------------------------
// Real server manager + backend against a fake `sglang serve`.
// ---------------------------------------------------------------------------------------------

async function freePorts(): Promise<number> {
  for (let i = 0; i < 50; i++) {
    const p = 31000 + Math.floor(Math.random() * 20000);
    const ok = await Promise.all([p, p + 1].map((q) => new Promise<boolean>((res) => { const s = net.createServer(); s.once('error', () => res(false)); s.listen(q, '127.0.0.1', () => s.close(() => res(true))); })));
    if (ok.every(Boolean)) return p;
  }
  throw new Error('no free port pair');
}

const goodDoc = (): PromptDoc => ({ ...blankDoc(8), style: 'Live-action, cinematic', shots: [{ startMs: 0, text: 'a wide shot of a kitchen.' }], soundscape: 'A kettle hums.', music: 'N/A' });

let ctx: ReturnType<typeof createApp>;
let logFile: string;
let modelRoot: string;
let basePort: number;
let extraProcs: ChildProcess[] = [];

const headers = (extra: Record<string, string> = {}) => ({ origin: `http://localhost:${PORT}`, host: `localhost:${PORT}`, ...extra });
const call = (p: string, init: RequestInit = {}) => ctx.app.request(p, { ...init, headers: headers(init.headers as Record<string, string>) });
const post = (p: string, body: unknown) => call(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const putSettings = (h3: Record<string, unknown>, backend = 'h3') =>
  call('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ generation: { backend, h3 } }) });
const events = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>) : []);

async function waitFor<T>(fn: () => T | undefined | false, ms = 15000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('timed out waiting');
}

async function upload(name: string): Promise<{ id: string }> {
  const fd = new FormData();
  fd.append('file', new File([Buffer.from(PNG)], name));
  const res = await ctx.app.request('/api/assets', { method: 'POST', headers: headers(), body: fd });
  return (await res.json()) as { id: string };
}

const jobBody = (assets: Array<{ id: string; role: string; kind?: string }>, over: Record<string, unknown> = {}) => ({
  doc: goodDoc(),
  assets: assets.map((a) => ({ id: a.id, kind: a.kind ?? 'image', filename: 'x.png', role: a.role, note: '' })),
  params,
  backend: 'h3',
  force: true,
  ...over,
});

async function runJob(body: unknown): Promise<JobRecord> {
  const res = await post('/api/jobs', body);
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as JobRecord;
  return waitFor(() => {
    const j = ctx.queue.get(id)!;
    return ['succeeded', 'failed', 'cancelled'].includes(j.status) && j;
  });
}

async function configure(extra: Record<string, unknown> = {}) {
  const res = await putSettings({ modelDir: modelRoot, serverMode: 'managed', sglangPath: FAKE_SGLANG, numGpus: 1, port: basePort, idleStopMin: 0, startupTimeoutMin: 1, jobTimeoutMin: 1, env: { FAKE_SGLANG_LOG: logFile, FAKE_SGLANG_LOAD_MS: '100' }, ...extra });
  expect(res.status).toBe(200);
}

describe('with a fake SGLang server', () => {
beforeEach(async () => {
  logFile = path.join(dir, 'fake-sglang.log');
  modelRoot = makeModel(path.join(dir, 'MiniMax-H3'));
  basePort = await freePorts();
  ctx = createApp({ dataDir: path.join(dir, 'data'), port: PORT, backends: { mock: createMockBackend(1) }, h3PollMs: 15 });
});
afterEach(async () => {
  ctx.queue.cancelAll();
  await ctx.queue.idle();
  await ctx.h3Server.stop();
  for (const p of extraProcs) p.kill('SIGKILL');
  extraProcs = [];
});

describe('H3 backend with a managed (fake) SGLang server', () => {
  it('starts the FL2VA server from the model folder, sends the official request and saves the video', async () => {
    await configure();
    const first = await upload('first.png');
    const job = await runJob(jobBody([{ id: first.id, role: 'first_frame' }]));
    expect(job.status, job.error).toBe('succeeded');
    expect(job.video).toBe('output.mp4');

    const ev = events();
    const start = ev.find((e) => e.event === 'start')!;
    expect(start.argv.slice(0, 1)).toEqual(['serve']);
    const arg = (n: string) => start.argv[start.argv.indexOf(n) + 1];
    expect(arg('--model-path')).toBe(modelRoot);
    expect(arg('--model-variant')).toBe('fl2va');
    expect(arg('--port')).toBe(String(basePort));
    expect(arg('--num-gpus')).toBe('1');
    expect(start.argv).not.toContain('--ulysses-degree');

    const create = ev.find((e) => e.event === 'create')!;
    expect(create.body.task).toBe('fl2va');
    expect(create.body.prompt).toBe(job.prompt);
    expect(create.body.seed).toBe(42);
    expect(create.body.target).toEqual({ short_edge: 768, aspect_ratio: 'auto', duration_seconds: 8 });
    expect(create.body.conditions).toHaveLength(1);
    expect(create.body.conditions[0]).toMatchObject({ type: 'image', role: 'keyframe', frame_index: 0 });
    expect(create.body.conditions[0].uri).toMatch(/^file:\/\/.*inputs\/Picture_1\.png$/);

    const file = await call(`/files/jobs/${job.id}/video`);
    expect(await file.text()).toBe('FAKEMP4:fl2va:fl2va:42');
    expect(ctx.h3Server.status().state).toBe('ready');
  });

  it('reuses the running server for the same checkpoint and swaps to Ref2VA (port + 1) for reference prompts', async () => {
    await configure();
    const a = await runJob(jobBody([]));
    const b = await runJob(jobBody([]));
    expect([a.status, b.status]).toEqual(['succeeded', 'succeeded']);
    expect(events().filter((e) => e.event === 'start')).toHaveLength(1);
    expect(events().find((e) => e.event === 'create')!.body.task).toBe('t2va');

    const img = await upload('subject.png');
    const r = await runJob(jobBody([{ id: img.id, role: 'subject' }]));
    expect(r.status, r.error).toBe('succeeded');
    const starts = events().filter((e) => e.event === 'start');
    expect(starts).toHaveLength(2);
    expect(starts[1]!.argv[starts[1]!.argv.indexOf('--model-variant') + 1]).toBe('ref2va');
    expect(starts[1]!.argv[starts[1]!.argv.indexOf('--port') + 1]).toBe(String(basePort + 1));
    expect(events().some((e) => e.event === 'sigterm')).toBe(true);
    const last = events().filter((e) => e.event === 'create').pop()!;
    expect(last.body.task).toBe('ref2va');
    expect(last.body.conditions[0]).toMatchObject({ type: 'image', role: 'reference' });
    expect(await (await call(`/files/jobs/${r.id}/video`)).text()).toBe('FAKEMP4:ref2va:ref2va:42');
  });

  it('passes multi-GPU and extra flags, and the configured environment', async () => {
    await configure({ numGpus: 4, extraArgs: ['--performance-mode', 'speed'], env: { FAKE_SGLANG_LOG: logFile, FAKE_SGLANG_LOAD_MS: '50', CUSTOM_VAR: 'hello' } });
    const job = await runJob(jobBody([]));
    expect(job.status, job.error).toBe('succeeded');
    const start = events().find((e) => e.event === 'start')!;
    expect(start.argv).toEqual(expect.arrayContaining(['--num-gpus', '4', '--ulysses-degree', '4', '--performance-mode', 'speed', '--host', '127.0.0.1']));
    expect(start.env.CUSTOM_VAR).toBe('hello');
  });

  it('treats a server without a /health route as ready once it answers', async () => {
    await configure({ env: { FAKE_SGLANG_LOG: logFile, FAKE_SGLANG_NO_HEALTH: '1' } });
    expect((await runJob(jobBody([]))).status).toBe('succeeded');
  });

  it('shows the real reason when the server dies while loading', async () => {
    await configure({ env: { FAKE_SGLANG_LOG: logFile, FAKE_SGLANG_EXIT: '3' } });
    const job = await runJob(jobBody([]));
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/exited with code 3/);
    expect(job.error).toMatch(/CUDA out of memory/);
    expect(ctx.h3Server.status().state).toBe('error');
  });

  it('reports a missing SGLang binary, a missing model folder and a busy port plainly', async () => {
    await configure({ sglangPath: path.join(dir, 'no-such-sglang') });
    expect((await runJob(jobBody([]))).error).toMatch(/Could not start/);

    await configure({ modelDir: path.join(dir, 'gone') });
    expect((await runJob(jobBody([]))).error).toMatch(/No H3 model found/);

    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(basePort, '127.0.0.1', () => r()));
    await configure();
    const busy = await runJob(jobBody([]));
    blocker.close();
    expect(busy.error).toMatch(new RegExp(`Port ${basePort} is already in use`));
  });

  it('surfaces the server\'s own error for a rejected request or a failed generation', async () => {
    await configure({ env: { FAKE_SGLANG_LOG: logFile, FAKE_SGLANG_REJECT: 'conditions[0].uri not found' } });
    expect((await runJob(jobBody([]))).error).toMatch(/HTTP 422.*conditions\[0\]\.uri not found/);

    await configure({ env: { FAKE_SGLANG_LOG: logFile, FAKE_SGLANG_FAIL_JOB: 'out of memory in denoise' } });
    await ctx.h3Server.stop();
    const failed = await runJob(jobBody([]));
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/failed.*out of memory in denoise/);
  });

  it('cancels a running generation, aborting it on the server and freeing the GPU', async () => {
    await configure({ env: { FAKE_SGLANG_LOG: logFile, FAKE_SGLANG_HANG: '1' } });
    const res = await post('/api/jobs', jobBody([]));
    const { id } = (await res.json()) as JobRecord;
    await waitFor(() => /Generating/.test(ctx.queue.get(id)!.message));
    expect((await call(`/api/jobs/${id}/cancel`, { method: 'POST' })).status).toBe(200);
    const done = await waitFor(() => ctx.queue.get(id)!.status === 'cancelled' && ctx.queue.get(id)!);
    expect(done.status).toBe('cancelled');
    await waitFor(() => ctx.h3Server.status().state === 'stopped');
    expect(events().some((e) => e.event === 'delete')).toBe(true);
  });

  it('rejects impossible jobs before queueing them', async () => {
    await configure();
    const short = await post('/api/jobs', jobBody([], { params: { ...params, durationSec: 3 }, doc: { ...goodDoc(), durationSec: 3 } }));
    expect(short.status).toBe(400);
    expect(((await short.json()) as { error: string }).error).toMatch(/4–15 second/);

    await putSettings({ modelDir: '' });
    const none = await post('/api/jobs', jobBody([]));
    expect(none.status).toBe(400);
    expect(((await none.json()) as { error: string }).error).toMatch(/No H3 model folder/);
  });

  it('embeds files as data: URIs when the server runs elsewhere', async () => {
    await configure({ assetTransport: 'data' });
    const first = await upload('first.png');
    const job = await runJob(jobBody([{ id: first.id, role: 'first_frame' }]));
    expect(job.status, job.error).toBe('succeeded');
    expect(events().find((e) => e.event === 'create')!.body.conditions[0].uri).toMatch(/^data:image\/png;base64,/);
  });
});

describe('H3 backend with a server you run yourself', () => {
  it('talks to the configured URLs and fails clearly when nothing answers', async () => {
    const down = await runJobWith({ serverMode: 'external', externalFl2vaUrl: `http://127.0.0.1:${basePort + 5}` });
    expect(down.error).toMatch(/Cannot reach the text\/first-last-frame \(FL2VA\) server/);

    const child = spawn(FAKE_SGLANG, ['serve', '--model-variant', 'fl2va', '--port', String(basePort)], { env: { ...process.env, FAKE_SGLANG_LOG: logFile, FAKE_SGLANG_LOAD_MS: '0' }, stdio: 'ignore' });
    extraProcs.push(child);
    await waitFor(() => existsSync(logFile));
    await new Promise((r) => setTimeout(r, 300));
    const ok = await runJobWith({ serverMode: 'external', externalFl2vaUrl: `http://127.0.0.1:${basePort}` });
    expect(ok.status, ok.error).toBe('succeeded');
    expect(ctx.h3Server.status().pid).toBeUndefined();
  });

  async function runJobWith(h3: Record<string, unknown>) {
    expect((await putSettings({ ...h3, jobTimeoutMin: 1 })).status).toBe(200);
    return runJob(jobBody([]));
  }
});

describe('H3 API routes', () => {
  it('scans a folder, lists directories, starts and stops the server', async () => {
    await configure();
    const scan = (await (await post('/api/h3/scan', { path: dir })).json()) as H3Scan;
    expect(scan.root).toBe(modelRoot);
    expect(scan.variants.every((v) => v.complete)).toBe(true);
    expect(scan.tooling.sglang?.path).toBe(FAKE_SGLANG); // the configured path is checked first
    expect((await post('/api/h3/scan', {})).status).toBe(400);

    const dirs = (await (await call(`/api/fs/dirs?path=${encodeURIComponent(dir)}`)).json()) as { dirs: Array<{ name: string; isModel: boolean }> };
    expect(dirs.dirs.find((d) => d.name === 'MiniMax-H3')?.isModel).toBe(true);
    expect((await call(`/api/fs/dirs?path=${encodeURIComponent(path.join(dir, 'nope'))}`)).status).toBe(400);

    expect((await post('/api/h3/start', { variant: 'nope' })).status).toBe(400);
    expect((await post('/api/h3/start', { variant: 'ref2va' })).status).toBe(202);
    await waitFor(() => ctx.h3Server.status().state === 'ready');
    const status = (await (await call('/api/h3/status')).json()) as { state: string; variant: string; url: string; log: string[] };
    expect(status).toMatchObject({ state: 'ready', variant: 'ref2va', url: `http://127.0.0.1:${basePort + 1}` });
    expect(status.log[0]).toMatch(/^\$ .*fake-sglang\.mjs serve --model-path/);

    expect(((await (await post('/api/h3/stop', {})).json()) as { state: string }).state).toBe('stopped');
  });

  it('validates H3 settings', async () => {
    const bad = async (h3: Record<string, unknown>) => (await putSettings(h3)).status;
    expect(await bad({ port: 80 })).toBe(400);
    expect(await bad({ numGpus: -1 })).toBe(400);
    expect(await bad({ externalFl2vaUrl: 'ftp://x' })).toBe(400);
    expect(await bad({ serverMode: 'cloud' })).toBe(400);
    expect(await bad({ assetTransport: 'smoke' })).toBe(400);
    expect(await bad({ env: { 'BAD NAME': 'x' } })).toBe(400);
    const ok = await putSettings({ modelDir: '  /models/h3  ', externalFl2vaUrl: 'http://10.0.0.5:30010/', port: 30020 });
    const view = (await ok.json()) as SettingsView;
    expect(view.generation.backend).toBe('h3');
    expect(view.generation.h3).toMatchObject({ modelDir: '/models/h3', externalFl2vaUrl: 'http://10.0.0.5:30010', port: 30020 });
  });
});

});
