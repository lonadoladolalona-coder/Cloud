import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app';
import { createMockBackend } from '../src/server/gen/mock';
import type { AssetRecord, EnhanceRequest, EnhanceResponse, JobRecord, SettingsView } from '../src/shared/api';
import { blankDoc, type AssetRef, type GenParams, type PromptDoc } from '../src/shared';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const FAKE_MODEL = path.resolve('tests/fixtures/fake-h3.mjs');
const PORT = 8787;

const params: GenParams = { durationSec: 8, aspectRatio: '16:9', resolution: '720p', seed: null, generateAudio: true };
const goodDoc = (over: Partial<PromptDoc> = {}): PromptDoc => ({
  ...blankDoc(8),
  style: 'Live-action, cinematic',
  shots: [{ startMs: 0, text: 'a wide shot of a kitchen.' }],
  soundscape: 'A kettle hums.',
  music: 'N/A',
  ...over,
});

let dir: string;
let ctx: ReturnType<typeof createApp>;

function setup(opts: Partial<Parameters<typeof createApp>[0]> = {}) {
  ctx = createApp({ dataDir: dir, port: PORT, backends: { mock: createMockBackend(1) }, ...opts });
  return ctx;
}

const headers = (extra: Record<string, string> = {}) => ({ origin: `http://localhost:${PORT}`, ...extra });
const json = (body: unknown) => ({ method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify(body) });
/** In-process requests carry no Host header, which the security middleware (correctly) rejects, so add one like a browser would. */
const request = (p: string, init: RequestInit = {}) => {
  const h = new Headers(init.headers);
  if (!h.has('host')) h.set('host', `localhost:${PORT}`);
  return ctx.app.request(p, { ...init, headers: h });
};

async function upload(name: string, bytes: Uint8Array, preview?: Uint8Array): Promise<Response> {
  const fd = new FormData();
  fd.append('file', new File([Buffer.from(bytes)], name));
  if (preview) fd.append('preview', new File([Buffer.from(preview)], 'preview.jpg', { type: 'image/jpeg' }));
  return request('/api/assets', { method: 'POST', headers: headers(), body: fd });
}

async function waitFor<T>(fn: () => T | undefined | false, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('timed out waiting');
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'h3-test-'));
});
afterEach(async () => {
  ctx?.queue.cancelAll();
  await ctx?.queue.idle();
  rmSync(dir, { recursive: true, force: true });
});

describe('security', () => {
  it('rejects unknown Host headers and cross-origin writes', async () => {
    setup();
    expect((await request('/api/settings', { headers: { host: 'evil.example' } })).status).toBe(403);
    expect((await request('/api/settings', { headers: { host: `localhost:${PORT}` } })).status).toBe(200);
    expect((await request('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
    expect((await request('/api/settings', { method: 'PUT', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
    expect((await request('/api/settings', { ...json({}), method: 'PUT' })).status).toBe(200);
  });
});

describe('settings', () => {
  it('masks the API key, validates input and persists with owner-only permissions', async () => {
    setup();
    const put = await request('/api/settings', { ...json({ llm: { apiKey: 'sk-ant-api03-abcdefghijklmnop', model: 'claude-opus-5-5', effort: 'medium' } }), method: 'PUT' });
    const view = (await put.json()) as SettingsView;
    expect(view.llm.apiKeySet).toBe(true);
    expect(view.llm.apiKeyHint).toBe('sk-ant-…mnop');
    expect(JSON.stringify(view)).not.toContain('abcdefghijklmnop');
    expect(view.llm.effort).toBe('medium');
    expect(((await import('node:fs')).statSync(path.join(dir, 'settings.json')).mode & 0o777)).toBe(0o600);

    const bad = await request('/api/settings', { ...json({ llm: { effort: 'turbo' } }), method: 'PUT' });
    expect(bad.status).toBe(400);
    const badCmd = await request('/api/settings', { ...json({ generation: { command: { args: [1] } } }), method: 'PUT' });
    expect(badCmd.status).toBe(400);

    const cleared = (await (await request('/api/settings', { ...json({ llm: { clearApiKey: true } }), method: 'PUT' })).json()) as SettingsView;
    expect(cleared.llm.apiKeySet).toBe(false);
  });
});

describe('assets', () => {
  it('uploads, lists, serves with Range support, and deletes', async () => {
    setup();
    const res = await upload('cat.png', PNG, JPEG);
    expect(res.status).toBe(201);
    const rec = (await res.json()) as AssetRecord;
    expect(rec).toMatchObject({ kind: 'image', filename: 'cat.png', hasPreview: true });

    expect(((await (await request('/api/assets')).json()) as AssetRecord[]).map((a) => a.id)).toEqual([rec.id]);

    const full = await request(`/files/assets/${rec.id}/original`);
    expect(full.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(PNG);

    const part = await request(`/files/assets/${rec.id}/original`, { headers: { range: 'bytes=0-7' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 0-7/${PNG.length}`);
    expect((await part.arrayBuffer()).byteLength).toBe(8);
    expect((await request(`/files/assets/${rec.id}/original`, { headers: { range: 'bytes=9999-' } })).status).toBe(416);

    expect((await request(`/files/assets/${rec.id}/preview`)).headers.get('content-type')).toBe('image/jpeg');
    expect((await request('/files/assets/../../etc/passwd/original')).status).toBe(404);
    expect((await request('/files/assets/zzzzzzzzzzzzzzzz/original')).status).toBe(404);

    expect((await request(`/api/assets/${rec.id}`, { method: 'DELETE', headers: headers() })).status).toBe(200);
    expect((await request(`/files/assets/${rec.id}/original`)).status).toBe(404);
  });

  it('rejects unsupported types and a non-JPEG preview', async () => {
    setup();
    expect((await upload('evil.svg', new TextEncoder().encode('<svg onload=alert(1)>'))).status).toBe(415);
    expect((await upload('run.sh', new TextEncoder().encode('echo hi'))).status).toBe(415);
    expect((await upload('cat.png', PNG, PNG)).status).toBe(400);
  });
});

describe('enhance (model call injected)', () => {
  const draft = (over: object = {}) =>
    JSON.stringify({
      style: 'Live-action, cinematic',
      shots: [{ startMs: 0, text: '[Shot 1] a wide shot of a kitchen.' }],
      soundscape: 'A kettle hums.',
      music: 'N/A',
      summary: '',
      subjects: [],
      pictures: [],
      videos: [],
      audios: [],
      ...over,
    });
  const req = (over: Partial<EnhanceRequest> = {}): EnhanceRequest => ({
    idea: 'a quiet kitchen',
    durationSec: 8,
    aspectRatio: '16:9',
    dialogue: 'none',
    dialogueLanguage: 'English',
    music: false,
    assets: [],
    ...over,
  });

  it('returns a compiled, linted T2VA prompt and strips stray [Shot N] markers', async () => {
    setup({ complete: async () => draft() });
    const res = await request('/api/enhance', json(req()));
    const body = (await res.json()) as EnhanceResponse;
    expect(res.status).toBe(200);
    expect(body.mode).toBe('T2VA');
    expect(body.revised).toBe(false);
    expect(body.text).toBe(
      'integrated_multimodal_description: [Shot 1] Live-action, cinematic, a wide shot of a kitchen.\n\noverall_soundscape: A kettle hums.\n\nnon_diegetic_music: N/A',
    );
    expect(body.lint.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('revises once when the first draft fails validation, keeping the better draft', async () => {
    const calls: string[] = [];
    setup({
      complete: async ({ content }) => {
        const last = content[content.length - 1];
        calls.push(last && last.type === 'text' && last.text.includes('previous draft') ? 'repair' : 'first');
        return calls.length === 1 ? draft({ soundscape: '' }) : draft();
      },
    });
    const body = (await (await request('/api/enhance', json(req()))).json()) as EnhanceResponse;
    expect(calls).toEqual(['first', 'repair']);
    expect(body.revised).toBe(true);
    expect(body.doc.soundscape).toBe('A kettle hums.');
  });

  it('keeps the first draft if the revision call fails', async () => {
    let n = 0;
    setup({ complete: async () => (++n === 1 ? draft({ soundscape: '' }) : 'not json') });
    const body = (await (await request('/api/enhance', json(req()))).json()) as EnhanceResponse;
    expect(body.revised).toBe(false);
    expect(body.lint.some((i) => i.id === 'soundscape.empty')).toBe(true);
  });

  it('reports a malformed model reply as a 502 and validates the request', async () => {
    setup({ complete: async () => '{"nope":true}' });
    expect((await request('/api/enhance', json(req()))).status).toBe(502);
    expect((await request('/api/enhance', json(req({ idea: '   ' })))).status).toBe(400);
    expect((await request('/api/enhance', json(req({ assets: [{ id: 'a'.repeat(16), kind: 'image', filename: 'x.png', role: 'edit_source', note: '' }] })))).status).toBe(400);
  });

  it('uses the full-reference format when assets are reused, dropping entries for unknown labels', async () => {
    setup({
      complete: async () =>
        draft({
          style: 'The target video is a calm, realistic domestic scene.',
          shots: [{ startMs: 0, text: 'A medium shot shows <Subject 1> in the kitchen.' }],
          summary: '[reference generation] <Subject 1> stands in a kitchen.',
          subjects: [{ text: 'is the woman in <Picture 1>.', appearsIn: [1], marker: 'fully_preserved', note: 'identity retained' }],
          pictures: [{ label: 'Picture 9', text: 'ghost', anchor: '', marker: 'weak_reference', note: '' }],
        }),
    });
    const asset: AssetRef = { id: 'a'.repeat(16), kind: 'image', filename: 'woman.png', role: 'subject', note: '' };
    const body = (await (await request('/api/enhance', json(req({ assets: [asset] })))).json()) as EnhanceResponse;
    expect(body.mode).toBe('REFERENCE');
    expect(body.doc.pictures).toEqual([]);
    expect(body.doc.summary).toBe('<Subject 1> stands in a kitchen.');
    expect(body.text).toContain('summary:\n[reference generation] <Subject 1> stands in a kitchen.');
    expect(body.text).toContain('<Subject 1> (appears in [Shot 1]): fully_preserved - identity retained');
  });
});

describe('jobs: mock backend', () => {
  it('runs a job to completion and serves its poster', async () => {
    setup();
    const res = await request('/api/jobs', json({ doc: goodDoc(), assets: [], params }));
    expect(res.status).toBe(201);
    const job = (await res.json()) as JobRecord;
    expect(job.mode).toBe('T2VA');
    expect(job.prompt).toContain('integrated_multimodal_description: [Shot 1] Live-action, cinematic, a wide shot of a kitchen.');
    await ctx.queue.idle();
    const done = (await (await request(`/api/jobs/${job.id}`)).json()) as JobRecord;
    expect(done.status).toBe('succeeded');
    expect(done.poster).toBe('poster.svg');
    const poster = await request(`/files/jobs/${job.id}/poster`);
    expect(poster.headers.get('content-type')).toBe('image/svg+xml');
    expect(poster.headers.get('content-security-policy')).toContain('sandbox');
    expect((await request(`/files/jobs/${job.id}/video`)).status).toBe(404);
  });

  it('blocks prompts with lint errors unless forced', async () => {
    setup();
    const bad = goodDoc({ soundscape: '' });
    const res = await request('/api/jobs', json({ doc: bad, assets: [], params }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { details: Array<{ id: string }> }).details.map((d) => d.id)).toContain('soundscape.empty');
    expect((await request('/api/jobs', json({ doc: bad, assets: [], params, force: true }))).status).toBe(201);
  });

  it('refuses assets that no longer exist, and the command backend with no program', async () => {
    setup();
    const ghost: AssetRef = { id: 'b'.repeat(16), kind: 'image', filename: 'gone.png', role: 'first_frame', note: '' };
    const doc = goodDoc({ shots: [{ startMs: 0, text: 'starts from <Picture 1>.' }] });
    expect((await request('/api/jobs', json({ doc, assets: [ghost], params }))).status).toBe(400);
    expect((await request('/api/jobs', json({ doc: goodDoc(), assets: [], params, backend: 'command' }))).status).toBe(400);
  });
});

describe('jobs: command backend with a real child process', () => {
  const configure = async (env: Record<string, string> = {}) => {
    const res = await request('/api/settings', {
      ...json({ generation: { backend: 'command', command: { program: process.execPath, args: [FAKE_MODEL], env, timeoutMin: 1 } } }),
      method: 'PUT',
    });
    expect(res.status).toBe(200);
  };
  const run = async (body: object = {}) => {
    const res = await request('/api/jobs', json({ doc: goodDoc(), assets: [], params, ...body }));
    expect(res.status).toBe(201);
    return (await res.json()) as JobRecord;
  };
  const get = async (id: string) => (await (await request(`/api/jobs/${id}`)).json()) as JobRecord;

  it('passes the prompt, params, labelled inputs and env to the program, then serves the video', async () => {
    setup();
    await configure({ CUSTOM_VAR: 'hello' });
    const up = (await (await upload('face.png', PNG)).json()) as AssetRecord;
    const asset: AssetRef = { id: up.id, kind: 'image', filename: 'face.png', role: 'first_frame', note: 'hero' };
    const doc = goodDoc({ shots: [{ startMs: 0, text: 'the woman from <Picture 1> looks up.' }] });
    const job = await run({ doc, assets: [asset] });
    await ctx.queue.idle();
    const done = await get(job.id);
    expect(done.status).toBe('succeeded');
    expect(done.video).toBe('output.mp4');
    expect(done.log).toContain('loading model…');

    const jobDir = path.join(dir, 'jobs', job.id);
    expect(existsSync(path.join(jobDir, 'inputs', 'Picture_1.png'))).toBe(true);
    const spec = JSON.parse(readFileSync(path.join(jobDir, 'job.json'), 'utf8'));
    expect(spec.mode).toBe('I2VA');
    expect(spec.params.aspectRatio).toBe('16:9');
    expect(spec.assets[0]).toMatchObject({ label: 'Picture 1', role: 'first_frame', note: 'hero', path: path.join(jobDir, 'inputs', 'Picture_1.png') });
    expect(readFileSync(path.join(jobDir, 'prompt.txt'), 'utf8')).toBe(done.prompt);

    const video = await request(`/files/jobs/${job.id}/video`);
    const text = Buffer.from(await video.arrayBuffer()).toString();
    expect(video.headers.get('content-type')).toBe('video/mp4');
    expect(text).toContain('FAKEMP4');
    expect(text).toContain('"Picture 1:first_frame"');
    expect(text).toContain('"env":"hello"');
    expect((await request(`/files/jobs/${job.id}/video?download=1`)).headers.get('content-disposition')).toContain('attachment');
  });

  it('fails with the process error when the program exits non-zero or writes no output', async () => {
    setup();
    await configure({ FAKE_FAIL: '1' });
    const failed = await run();
    await ctx.queue.idle();
    expect(await get(failed.id)).toMatchObject({ status: 'failed', error: 'Process exited with code 3.' });
    expect((await get(failed.id)).log).toContain('! CUDA out of memory');

    await configure({ FAKE_NO_OUTPUT: '1', FAKE_FAIL: '' });
    // an empty env value must not trigger the failure branch
    const noOut = await run();
    await ctx.queue.idle();
    expect((await get(noOut.id)).error).toMatch(/wrote no output/);

    await request('/api/settings', { ...json({ generation: { command: { program: '/definitely/not/here', env: {} } } }), method: 'PUT' });
    const missing = await run();
    await ctx.queue.idle();
    expect((await get(missing.id)).error).toMatch(/Could not start/);
  });

  it('cancels a running job and kills the process', async () => {
    setup();
    const pidFile = path.join(dir, 'pid');
    await configure({ FAKE_HANG: '1', FAKE_PID_FILE: pidFile });
    const job = await run();
    await waitFor(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8'));
    const pid = Number(readFileSync(pidFile, 'utf8'));
    expect((await request(`/api/jobs/${job.id}/cancel`, { method: 'POST', headers: headers() })).status).toBe(200);
    await ctx.queue.idle();
    expect((await get(job.id)).status).toBe('cancelled');
    await waitFor(() => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    });
  });

  it('runs jobs one at a time, in order, and can delete finished ones', async () => {
    setup();
    await configure({ FAKE_SLEEP_MS: '60' });
    const a = await run();
    const b = await run();
    expect((await get(b.id)).status).toBe('queued');
    expect((await request(`/api/jobs/${a.id}`, { method: 'DELETE', headers: headers() })).status).toBe(409);
    await ctx.queue.idle();
    const [ja, jb] = [await get(a.id), await get(b.id)];
    expect(ja.status).toBe('succeeded');
    expect(jb.status).toBe('succeeded');
    expect(ja.finishedAt! <= jb.startedAt!).toBe(true);
    expect((await request(`/api/jobs/${a.id}`, { method: 'DELETE', headers: headers() })).status).toBe(200);
    expect((await request(`/api/jobs/${a.id}`)).status).toBe(404);
  });

  it('marks jobs that were active at restart as failed', async () => {
    setup();
    await configure({ FAKE_HANG: '1' });
    const job = await run();
    await waitFor(async () => (await get(job.id)).status === 'running');
    // simulate a crash: a fresh app over the same data dir sees the record as it was last persisted
    const second = createApp({ dataDir: dir, port: PORT });
    expect(second.queue.get(job.id)).toMatchObject({ status: 'failed', error: expect.stringContaining('Interrupted') });
  });
});

describe('events', () => {
  it('streams job updates over SSE', async () => {
    setup();
    const res = await request('/api/events');
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let seen = '';
    const read = async (until: string) => {
      while (!seen.includes(until)) {
        const { value, done } = await reader.read();
        if (done) break;
        seen += decoder.decode(value);
      }
    };
    await read('event: ready');
    await request('/api/jobs', json({ doc: goodDoc(), assets: [], params }));
    await read('"status":"succeeded"');
    await reader.cancel();
    expect(seen).toContain('event: job');
  });
});

describe('Claude API request shape (real SDK against a stub endpoint)', () => {
  let stub: Server;
  let seen: { url: string; headers: IncomingMessage['headers']; body: any } | null = null;
  let reply = '';

  beforeEach(async () => {
    stub = createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        seen = { url: req.url ?? '', headers: req.headers, body: JSON.parse(data) };
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
            content: [{ type: 'text', text: reply }], stop_reason: 'end_turn', stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 10 },
          }),
        );
      });
    });
    await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    reply = JSON.stringify({
      style: 'Live-action, cinematic', shots: [{ startMs: 0, text: 'a wide shot of a kitchen.' }], soundscape: 'A kettle hums.',
      music: 'N/A', summary: '', subjects: [], pictures: [], videos: [], audios: [],
    });
  });
  afterEach(() => {
    delete process.env.ANTHROPIC_BASE_URL;
    stub.close();
  });

  it('sends the guides, structured-output format, effort, fallback and reference images', async () => {
    setup();
    await request('/api/settings', { ...json({ llm: { apiKey: 'sk-ant-test-key-123456', effort: 'high' } }), method: 'PUT' });
    const up = (await (await upload('look.png', PNG, JPEG)).json()) as AssetRecord;
    const asset: AssetRef = { id: up.id, kind: 'image', filename: 'look.png', role: 'first_frame', note: 'the hero' };
    const res = await request('/api/enhance', json({
      idea: 'she opens the shutters', durationSec: 8, aspectRatio: '16:9', dialogue: 'none', dialogueLanguage: 'English', music: false, assets: [asset],
    }));
    expect(res.status).toBe(200);

    expect(seen!.url).toMatch(/^\/v1\/messages/);
    expect(seen!.headers['x-api-key']).toBe('sk-ant-test-key-123456');
    expect(String(seen!.headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01');
    const b = seen!.body;
    expect(b.model).toBe('claude-opus-5-5');
    expect(b.fallbacks).toBe('default');
    expect(b.output_config.effort).toBe('high');
    expect(b.output_config.format.type).toBe('json_schema');
    expect(Object.keys(b.output_config.format.schema.properties)).toEqual(
      expect.arrayContaining(['style', 'shots', 'soundscape', 'music', 'summary', 'subjects', 'pictures', 'videos', 'audios']),
    );
    expect(b.system.map((s: { text: string }) => s.text).join('\n')).toContain('Video Prompt Writing Guide (T2VA / I2VA / FL2VA / L2VA)');
    expect(b.system.map((s: { text: string }) => s.text).join('\n')).toContain('Full-Reference Mode Rewrite Output Format Guide');
    expect(b.system.at(-1).cache_control).toEqual({ type: 'ephemeral' });
    const content = b.messages[0].content;
    expect(content.some((x: { type: string }) => x.type === 'image')).toBe(true);
    const text = content.filter((x: { type: string }) => x.type === 'text').map((x: { text: string }) => x.text).join('\n');
    expect(text).toContain('MODE I2VA');
    expect(text).toContain('Picture 1: image "look.png"');
    expect(text).toContain('user note = the hero');
    expect(text).toContain('<idea>\nshe opens the shutters\n</idea>');
  });

  it('can turn the refusal fallback off', async () => {
    setup();
    await request('/api/settings', { ...json({ llm: { apiKey: 'sk-ant-test-key-123456', refusalFallback: false } }), method: 'PUT' });
    await request('/api/enhance', json({ idea: 'x', durationSec: 8, aspectRatio: '16:9', dialogue: 'none', dialogueLanguage: 'English', music: false, assets: [] }));
    expect(seen!.body.fallbacks).toBeUndefined();
    expect(String(seen!.headers['anthropic-beta'] ?? '')).not.toContain('server-side-fallback');
  });
});
