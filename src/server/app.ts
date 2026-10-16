import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import { serveStatic } from '@hono/node-server/serve-static';
import type { ZodError } from 'zod';
import { assetUrl, type AssetRecord, type CreateJobRequest, type SettingsUpdate } from '../shared/api';
import { compile } from '../shared/compile';
import { deriveMode, labelAssets } from '../shared/labels';
import { lint, summarizeLint } from '../shared/lint';
import type { AssetKind } from '../shared/types';
import { serveFile, mimeForPath } from './files';
import { JobQueue } from './gen/queue';
import { createCommandBackend } from './gen/command';
import { createMockBackend } from './gen/mock';
import type { Backend } from './gen/types';
import { EnhanceError, enhance, type Complete } from './llm/enhance';
import { localOnly } from './security';
import { CreateJobSchema, EnhanceRequestSchema } from './schemas';
import { applyUpdate, toView } from './settings';
import { EXT_BY_KIND, ID_RE, Store, newId } from './store';

export interface AppOptions {
  dataDir: string;
  port: number;
  /** Extra browser origins allowed to call the API (the Vite dev server). */
  extraOrigins?: string[];
  backends?: Partial<Record<'mock' | 'command', Backend>>;
  complete?: Complete;
  /** Built web UI to serve. Skipped when the folder doesn't exist. */
  webRoot?: string;
}

const MAX_BYTES: Record<AssetKind, number> = { image: 25 * 2 ** 20, video: 300 * 2 ** 20, audio: 100 * 2 ** 20 };
const MAX_PREVIEW = 5 * 2 ** 20;

const kindForExt = (ext: string): AssetKind | null =>
  (Object.keys(EXT_BY_KIND) as AssetKind[]).find((k) => (EXT_BY_KIND[k] as readonly string[]).includes(ext)) ?? null;

const zodMessage = (err: ZodError) => err.issues.map((i) => `${i.path.join('.') || 'request'}: ${i.message}`).join('; ');

export function createApp(opts: AppOptions) {
  const store = new Store(opts.dataDir);
  let settings = store.loadSettings();
  const queue = new JobQueue(
    store,
    () => settings,
    { mock: opts.backends?.mock ?? createMockBackend(), command: opts.backends?.command ?? createCommandBackend() },
  );

  const app = new Hono();
  app.use('*', localOnly(opts.port, opts.extraOrigins));

  app.onError((err, c) => {
    if (err instanceof EnhanceError) return c.json({ error: err.message }, err.status as 400);
    console.error(err);
    return c.json({ error: 'Internal error.' }, 500);
  });

  const readJson = async (c: { req: { json(): Promise<unknown> } }) => {
    try {
      return await c.req.json();
    } catch {
      return undefined;
    }
  };

  // ---- settings -----------------------------------------------------------------------------
  app.get('/api/settings', (c) => c.json(toView(settings)));
  app.put('/api/settings', async (c) => {
    const body = (await readJson(c)) as SettingsUpdate | undefined;
    if (!body || typeof body !== 'object') return c.json({ error: 'Expected a JSON body.' }, 400);
    try {
      settings = applyUpdate(settings, body);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Invalid settings.' }, 400);
    }
    store.saveSettings(settings);
    return c.json(toView(settings));
  });

  // ---- assets -------------------------------------------------------------------------------
  app.get('/api/assets', (c) => c.json(store.listAssets()));

  app.post(
    '/api/assets',
    bodyLimit({ maxSize: MAX_BYTES.video + MAX_PREVIEW + 2 ** 20, onError: (c) => c.json({ error: 'Upload is too large.' }, 413) }),
    async (c) => {
      const form = await c.req.parseBody();
      const file = form.file;
      if (!(file instanceof File)) return c.json({ error: 'Send the file in a "file" field.' }, 400);
      const ext = (file.name.split('.').pop() ?? '').toLowerCase();
      const kind = kindForExt(ext);
      if (!kind) return c.json({ error: `Unsupported file type ".${ext}".` }, 415);
      if (file.size > MAX_BYTES[kind]) return c.json({ error: `${kind} files can be at most ${MAX_BYTES[kind] / 2 ** 20} MB.` }, 413);

      let preview: Uint8Array | undefined;
      if (form.preview instanceof File && form.preview.size > 0) {
        const bytes = new Uint8Array(await form.preview.arrayBuffer());
        const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
        if (!isJpeg || bytes.length > MAX_PREVIEW) return c.json({ error: 'Preview must be a JPEG under 5 MB.' }, 400);
        preview = bytes;
      }
      const rec: AssetRecord = {
        id: newId(),
        kind,
        filename: file.name.slice(0, 200),
        mime: mimeForPath(`x.${ext}`),
        size: file.size,
        hasPreview: Boolean(preview),
        createdAt: new Date().toISOString(),
      };
      await store.saveAsset(rec, ext, new Uint8Array(await file.arrayBuffer()), preview);
      return c.json(rec, 201);
    },
  );

  app.delete('/api/assets/:id', async (c) => ((await store.deleteAsset(c.req.param('id'))) ? c.json({ ok: true }) : c.json({ error: 'Not found.' }, 404)));

  // ---- enhance ------------------------------------------------------------------------------
  app.post('/api/enhance', async (c) => {
    const parsed = EnhanceRequestSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);
    return c.json(await enhance(parsed.data, { store, settings, complete: opts.complete }));
  });

  // ---- jobs ---------------------------------------------------------------------------------
  app.get('/api/jobs', (c) => c.json(queue.list()));
  app.get('/api/jobs/:id', (c) => {
    const job = queue.get(c.req.param('id'));
    return job ? c.json(job) : c.json({ error: 'Not found.' }, 404);
  });

  app.post('/api/jobs', async (c) => {
    const parsed = CreateJobSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);
    const req = parsed.data as unknown as CreateJobRequest;

    const labeled = labelAssets(req.assets);
    const mode = req.modeOverride ?? deriveMode(req.assets);
    const issues = lint(req.doc, labeled, mode);
    if (!req.force && summarizeLint(issues).errors > 0) {
      return c.json({ error: 'The prompt has validation errors.', details: issues }, 422);
    }
    const backend = req.backend ?? settings.generation.backend;
    if (backend === 'command' && !settings.generation.command.program) {
      return c.json({ error: 'No program is configured for the command backend. Set one under Settings.' }, 400);
    }

    const assets = [];
    for (const a of labeled) {
      const meta = store.getAsset(a.id);
      const source = store.assetPath(a.id, 'original');
      if (!meta || !source) return c.json({ error: `Asset ${a.label} (${a.filename}) no longer exists. Re-upload it.` }, 400);
      assets.push({ assetId: a.id, label: a.label, kind: a.kind, role: a.role, filename: a.filename, note: a.note, sourcePath: source, mime: meta.mime });
    }
    const job = queue.enqueue({ doc: req.doc, prompt: compile(req.doc, labeled, mode), mode, params: req.params, backend, assets });
    return c.json(job, 201);
  });

  app.post('/api/jobs/:id/cancel', (c) => (queue.cancel(c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'Job is not active.' }, 409)));
  app.delete('/api/jobs/:id', async (c) => {
    const result = await queue.remove(c.req.param('id'));
    if (result === 'missing') return c.json({ error: 'Not found.' }, 404);
    if (result === 'active') return c.json({ error: 'Cancel the running job first.' }, 409);
    return c.json({ ok: true });
  });

  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const unsubscribe = queue.subscribe((job) => void stream.writeSSE({ event: 'job', data: JSON.stringify(job) }));
      stream.onAbort(unsubscribe);
      await stream.writeSSE({ event: 'ready', data: '1' });
      while (!stream.aborted) {
        await stream.sleep(25_000);
        await stream.writeSSE({ event: 'ping', data: '' });
      }
    }),
  );

  // ---- files --------------------------------------------------------------------------------
  app.on(['GET', 'HEAD'], '/files/assets/:id/:which', (c) => {
    const which = c.req.param('which');
    if (which !== 'original' && which !== 'preview') return c.json({ error: 'Not found.' }, 404);
    const file = store.assetPath(c.req.param('id'), which);
    if (!file) return c.json({ error: 'Not found.' }, 404);
    return serveFile(c, file);
  });

  app.on(['GET', 'HEAD'], '/files/jobs/:id/:which', (c) => {
    const id = c.req.param('id');
    const which = c.req.param('which');
    const job = ID_RE.test(id) ? queue.get(id) : undefined;
    const name = job && (which === 'video' ? job.video : which === 'poster' ? job.poster : undefined);
    if (!job || !name) return c.json({ error: 'Not found.' }, 404);
    const file = path.join(store.jobDir(id), path.basename(name));
    if (!existsSync(file)) return c.json({ error: 'Not found.' }, 404);
    return serveFile(c, file, { download: c.req.query('download') === '1', filename: `${id}${path.extname(file)}` });
  });

  // ---- web UI -------------------------------------------------------------------------------
  if (opts.webRoot && existsSync(opts.webRoot) && statSync(opts.webRoot).isDirectory()) {
    const root = path.relative(process.cwd(), opts.webRoot) || '.';
    app.use('/*', serveStatic({ root }));
    app.get('*', serveStatic({ path: path.join(root, 'index.html') }));
  }

  return { app, store, queue, getSettings: () => settings };
}

export { assetUrl };
