import type { AssetRecord, CreateJobRequest, EnhanceRequest, EnhanceResponse, H3ServerStatus, H3Variant, JobRecord } from '../../shared/api';
import { compile } from '../../shared/compile';
import { deriveMode, labelAssets } from '../../shared/labels';
import { lint, summarizeLint } from '../../shared/lint';
import type { AssetKind } from '../../shared/types';
import { buildH3Request, H3RequestError } from '../../server/h3/request';
import { DEFAULT_SETTINGS, applyUpdate, toView, type Settings } from '../../server/settings';
import type { api as RealApi } from '../api';
import { ApiFailure } from '../errors';
import { posterDataUrl, recordClip } from './clip';
import { DEMO_MODEL_ROOT, DEMO_SGLANG, listDirs, scanFolder } from './fakefs';
import { writeDoc } from './writer';

/**
 * A pretend server that lives in the page: same API surface as the real one (src/web/api.ts), same validation
 * and the same prompt engine, but prompts come from a template writer and "generation" is a placeholder clip.
 * Used only by the static demo build.
 */

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('cancelled')); }, { once: true });
  });

const EXTS: Record<AssetKind, string[]> = { image: ['png', 'jpg', 'jpeg', 'webp', 'gif'], video: ['mp4', 'webm', 'mov', 'm4v'], audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] };
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac' };
const rid = () => Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
const clone = <T,>(v: T): T => structuredClone(v);

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

export type DemoApi = typeof RealApi;

export interface Demo {
  api: DemoApi;
  /** Maps a /files/... URL to the data: URL held in memory. */
  resolveFile(url: string): string | undefined;
  onJob(fn: (job: JobRecord) => void): () => void;
}

export function createDemo(): Demo {
  let settings: Settings = clone(DEFAULT_SETTINGS);
  settings.generation.backend = 'h3';
  settings.generation.h3.modelDir = DEMO_MODEL_ROOT;
  settings.generation.h3.sglangPath = DEMO_SGLANG;
  settings.generation.h3.idleStopMin = 20;

  const files = new Map<string, string>();
  const assets = new Map<string, AssetRecord>();
  const jobs = new Map<string, JobRecord>();
  const listeners = new Set<(job: JobRecord) => void>();
  const emit = (job: JobRecord) => listeners.forEach((fn) => fn(clone(job)));

  let server: H3ServerStatus = { state: 'stopped', log: [] };
  const serverLog = (line: string) => (server = { ...server, log: [...server.log, line].slice(-200) });

  // ---- sequential job runner ----------------------------------------------------------------
  let current: { id: string; abort: AbortController } | null = null;

  async function pump(): Promise<void> {
    if (current) return;
    const next = [...jobs.values()].filter((j) => j.status === 'queued').sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!next) return;
    current = { id: next.id, abort: new AbortController() };
    try {
      await run(next, current.abort);
    } finally {
      current = null;
      void pump();
    }
  }

  async function run(job: JobRecord, abort: AbortController): Promise<void> {
    const update = (fraction: number, message?: string) => {
      job.progress = Math.max(0, Math.min(1, fraction));
      if (message) job.message = message;
      emit(job);
    };
    const log = (line: string) => {
      job.log.push(line);
      emit(job);
    };
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    job.message = 'Starting';
    emit(job);
    try {
      const shotStarts = job.doc.shots.map((s) => s.startMs);
      const clip = recordClip({ prompt: job.prompt, aspect: job.params.aspectRatio, shotStarts, durationSec: job.doc.durationSec });

      if (job.backend === 'h3') {
        const items = job.assets.map((a) => ({ label: a.label, kind: a.kind, role: a.role, uri: 'file:///demo' }));
        const req = buildH3Request({ mode: job.mode, prompt: job.prompt, params: job.params, items });
        req.notes.forEach((n) => log(`note: ${n}`));
        log(`task ${req.body.task} · ${req.body.target.duration_seconds}s · ${req.body.target.aspect_ratio} · seed ${req.body.seed}${req.body.conditions.length ? ` · ${req.body.conditions.length} condition(s)` : ''}`);
        update(0.01, 'Starting the model server…');
        if (!(server.state === 'ready' && server.variant === req.variant)) await bootServer(req.variant, abort.signal, (m) => update(0.02, m));
        log('submitted as vid_1');
        const started = Date.now();
        for (let i = 1; i <= 12; i++) {
          await sleep(420, abort.signal);
          const secs = Math.round((Date.now() - started) / 1000);
          update(0.08 + 0.87 * (i / 12), `Generating… 0m ${String(secs).padStart(2, '0')}s (${Math.round((i / 12) * 100)}%)`);
        }
        update(0.96, 'Downloading the video…');
      } else {
        for (let i = 1; i <= 8; i++) {
          await sleep(350, abort.signal);
          update(i / 8, job.backend === 'mock' ? `Mock render ${i}/8` : `Custom program step ${i}/8`);
        }
      }

      const video = await clip;
      files.set(`/files/jobs/${job.id}/poster`, posterDataUrl(job.prompt, 'DEMO · placeholder result'));
      job.poster = 'poster.svg';
      if (video) {
        files.set(`/files/jobs/${job.id}/video`, video);
        job.video = 'output.mp4';
      }
      job.status = 'succeeded';
      job.progress = 1;
      job.message = video ? 'Done' : 'Done (placeholder card — this browser cannot record a clip)';
    } catch (err) {
      if (abort.signal.aborted) {
        job.status = 'cancelled';
        job.message = 'Cancelled';
        if (job.backend === 'h3' && server.state !== 'stopped') {
          log('cancelled — stopping the model server to abort the in-flight generation (it restarts on the next job)');
          server = { ...server, state: 'stopped', variant: undefined, url: undefined };
        }
      } else {
        job.status = 'failed';
        job.error = err instanceof Error ? err.message : String(err);
        job.message = 'Failed';
      }
    } finally {
      job.finishedAt = new Date().toISOString();
      emit(job);
    }
  }

  async function bootServer(variant: H3Variant, signal?: AbortSignal, onStatus?: (m: string) => void): Promise<void> {
    const folder = variant === 'fl2va' ? 'FL2VA' : 'Ref2VA';
    const port = settings.generation.h3.port + (variant === 'fl2va' ? 0 : 1);
    server = { state: 'starting', variant, url: `http://127.0.0.1:${port}`, log: [`$ ${DEMO_SGLANG} serve --model-path ${DEMO_MODEL_ROOT} --model-variant ${variant} --num-gpus 1 --host 127.0.0.1 --port ${port}`, '[demo] this is a simulation: no model is loaded'] };
    const started = Date.now();
    for (let i = 0; i < 6; i++) {
      const secs = Math.round((Date.now() - started) / 1000);
      onStatus?.(`Loading ${folder} into memory… 0m ${String(secs).padStart(2, '0')}s (first start can take several minutes)`);
      await sleep(450, signal);
    }
    serverLog(`[demo] ${folder} ready on port ${port}`);
    server = { ...server, state: 'ready', pid: 4242 };
  }

  // ---- the API --------------------------------------------------------------------------------
  const api: DemoApi = {
    settings: async () => toView(settings, { ANTHROPIC_API_KEY: 'demo' }),
    saveSettings: async (update) => {
      try {
        settings = applyUpdate(settings, update);
      } catch (e) {
        throw new ApiFailure(e instanceof Error ? e.message : 'Invalid settings.', 400);
      }
      return toView(settings, { ANTHROPIC_API_KEY: 'demo' });
    },
    assets: async () => [...assets.values()],
    deleteAsset: async (id) => {
      assets.delete(id);
      files.delete(`/files/assets/${id}/preview`);
      files.delete(`/files/assets/${id}/original`);
      return { ok: true };
    },
    enhance: async (req: EnhanceRequest): Promise<EnhanceResponse> => {
      await sleep(900);
      if (!req.idea.trim()) throw new ApiFailure('Describe the scene first.', 400);
      const labeled = labelAssets(req.assets);
      const mode = req.modeOverride ?? deriveMode(req.assets);
      const doc = writeDoc(req, labeled, mode);
      return { doc, mode, assets: labeled, text: compile(doc, labeled, mode), lint: lint(doc, labeled, mode), revised: false };
    },
    createJob: async (r: CreateJobRequest) => {
      const labeled = labelAssets(r.assets);
      const mode = r.modeOverride ?? deriveMode(r.assets);
      const issues = lint(r.doc, labeled, mode);
      if (!r.force && summarizeLint(issues).errors > 0) throw new ApiFailure('The prompt has validation errors.', 422, issues);
      const backend = r.backend ?? settings.generation.backend;
      const prompt = compile(r.doc, labeled, mode);
      if (backend === 'h3') {
        if (settings.generation.h3.serverMode === 'managed' && !settings.generation.h3.modelDir) throw new ApiFailure('No H3 model folder is set. Open Settings → MiniMax H3 and pick it.', 400);
        try {
          buildH3Request({ mode, prompt, params: r.params, items: labeled.map((a) => ({ label: a.label, kind: a.kind, role: a.role, uri: 'file:///demo' })) });
        } catch (e) {
          if (e instanceof H3RequestError) throw new ApiFailure(e.message, 400);
          throw e;
        }
      }
      if (backend === 'command' && !settings.generation.command.program) throw new ApiFailure('No program is configured for the command backend. Set one under Settings.', 400);
      for (const a of labeled) if (!assets.has(a.id)) throw new ApiFailure(`Asset ${a.label} (${a.filename}) no longer exists. Re-upload it.`, 400);

      const job: JobRecord = {
        id: rid(),
        createdAt: new Date().toISOString(),
        status: 'queued',
        progress: 0,
        message: 'Waiting in queue',
        backend,
        mode,
        prompt,
        doc: r.doc,
        params: r.params,
        assets: labeled.map((a) => ({ assetId: a.id, label: a.label, kind: a.kind, role: a.role, filename: a.filename, note: a.note })),
        log: [],
      };
      jobs.set(job.id, job);
      emit(job);
      void pump();
      return clone(job);
    },
    jobs: async () => [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(clone),
    cancelJob: async (id) => {
      const job = jobs.get(id);
      if (!job) throw new ApiFailure('Job is not active.', 409);
      if (job.status === 'queued') {
        job.status = 'cancelled';
        job.message = 'Cancelled';
        job.finishedAt = new Date().toISOString();
        emit(job);
      } else if (job.status === 'running' && current?.id === id) current.abort.abort();
      else throw new ApiFailure('Job is not active.', 409);
      return { ok: true };
    },
    deleteJob: async (id) => {
      const job = jobs.get(id);
      if (!job) throw new ApiFailure('Not found.', 404);
      if (job.status === 'running') throw new ApiFailure('Cancel the running job first.', 409);
      jobs.delete(id);
      files.delete(`/files/jobs/${id}/video`);
      files.delete(`/files/jobs/${id}/poster`);
      return { ok: true };
    },
    scanH3: async (path) => {
      await sleep(500);
      return scanFolder(path);
    },
    h3Status: async () => clone(server),
    h3Start: async (variant) => {
      if (current) throw new ApiFailure('A generation is running. Wait for it to finish first.', 409);
      void bootServer(variant);
      return clone(server);
    },
    h3Stop: async () => {
      if (current) throw new ApiFailure('A generation is running. Cancel it first.', 409);
      server = { ...server, state: 'stopped', variant: undefined, url: undefined, pid: undefined };
      serverLog('[demo] server stopped');
      return clone(server);
    },
    dirs: async (path) => {
      try {
        return listDirs(path);
      } catch (e) {
        throw new ApiFailure(e instanceof Error ? e.message : 'Cannot list that folder.', 400);
      }
    },
    upload: async (file, preview, onProgress) => {
      const ext = (file.name.split('.').pop() ?? '').toLowerCase();
      const kind = (Object.keys(EXTS) as AssetKind[]).find((k) => EXTS[k].includes(ext));
      if (!kind) throw new ApiFailure(`Unsupported file type ".${ext}".`, 415);
      for (const p of [0.3, 0.7, 1]) {
        onProgress(p);
        await sleep(120);
      }
      const id = rid();
      if (preview) files.set(`/files/assets/${id}/preview`, await blobToDataUrl(preview));
      else if (kind === 'image' && file.size < 6 * 2 ** 20) files.set(`/files/assets/${id}/original`, await blobToDataUrl(file));
      const rec: AssetRecord = { id, kind, filename: file.name.slice(0, 200), mime: MIME[ext] ?? 'application/octet-stream', size: file.size, hasPreview: Boolean(preview), createdAt: new Date().toISOString() };
      assets.set(id, rec);
      return rec;
    },
  };

  return {
    api,
    resolveFile: (url) => files.get(url.split('?')[0]!),
    onJob: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
