import { createWriteStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { H3RequestError, buildH3Request, type H3Item } from '../h3/request';
import type { H3ServerManager } from '../h3/server';
import type { Backend, BackendContext, BackendResult } from './types';

const DONE = new Set(['completed', 'succeeded', 'success', 'done', 'finished']);
const FAILED = new Set(['failed', 'error', 'errored', 'cancelled', 'canceled']);
const MAX_DATA_URI_BYTES = 64 * 2 ** 20;

export interface H3BackendOptions {
  /** Milliseconds between status polls. */
  pollMs?: number;
}

interface VideoJobBody {
  id?: string;
  video_id?: string;
  status?: string;
  progress?: number;
  error?: unknown;
  message?: string;
}

const errorText = (body: VideoJobBody): string => {
  const e = body.error;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') return (e as { message: string }).message;
  return body.message ?? 'The model reported a failure.';
};

async function toUri(input: { path: string; mime: string }, transport: 'file' | 'data'): Promise<string> {
  if (transport === 'file') return pathToFileURL(path.resolve(input.path)).href;
  const size = (await stat(input.path)).size;
  if (size > MAX_DATA_URI_BYTES) throw new H3RequestError(`${path.basename(input.path)} is ${(size / 2 ** 20).toFixed(0)} MB — too large to embed. Use "file" transport (server on this machine) or a smaller file.`);
  return `data:${input.mime};base64,${(await readFile(input.path)).toString('base64')}`;
}

/** Same checks the job runs, without reading any file — used to reject a bad job before it is queued. */
export function preflightH3(args: Parameters<typeof buildH3Request>[0]): void {
  buildH3Request(args);
}

/**
 * Generates through the SGLang video API that MiniMax documents for H3-Base:
 *   POST /v1/videos {task, prompt, conditions, target, seed}  → { id }
 *   GET  /v1/videos/{id}                                      → { status }  (poll until "completed")
 *   GET  /v1/videos/{id}/content                              → the MP4
 */
export function createH3Backend(manager: H3ServerManager, opts: H3BackendOptions = {}): Backend {
  const pollMs = opts.pollMs ?? 2000;

  return {
    async run(ctx: BackendContext): Promise<BackendResult> {
      const { h3, job, dir, signal } = ctx;
      const items: H3Item[] = [];
      for (const i of ctx.inputs) items.push({ label: i.label, kind: i.kind, role: i.role, uri: await toUri(i, h3.assetTransport) });

      let request;
      try {
        request = buildH3Request({ mode: job.mode, prompt: job.prompt, params: job.params, items });
      } catch (err) {
        if (err instanceof H3RequestError) throw new Error(err.message);
        throw err;
      }
      for (const n of request.notes) ctx.log(`note: ${n}`);
      const { body, variant } = request;
      ctx.log(`task ${body.task} · ${body.target.duration_seconds}s · ${body.target.aspect_ratio} · seed ${body.seed}${body.conditions.length ? ` · ${body.conditions.length} condition(s)` : ''}`);

      const timeoutMs = h3.jobTimeoutMin * 60_000;
      const started = Date.now();
      let base: string;
      let id: string | undefined;
      let requested = false;
      let ensured = false;
      const http = (url: string, init: RequestInit = {}, ms = 30_000) => fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(ms)]) });

      try {
        ctx.progress(0.01, h3.serverMode === 'managed' ? 'Starting the model server…' : 'Contacting the model server…');
        base = await manager.ensure(variant, { signal, onStatus: (m) => ctx.progress(0.02, m) });
        ensured = true;
        requested = true;

        const res = await http(`${base}/v1/videos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, 120_000).catch((e: unknown) => {
          if (signal.aborted) throw new Error('cancelled');
          throw new Error(`Could not reach the model server at ${base}: ${e instanceof Error ? e.message : String(e)}`);
        });
        if (!res.ok) throw new Error(`The model server rejected the request (HTTP ${res.status}): ${(await res.text().catch(() => '')).slice(0, 600)}`);
        const created = (await res.json().catch(() => ({}))) as VideoJobBody;
        id = created.id ?? created.video_id;
        if (!id) throw new Error('The model server did not return a video id.');
        ctx.log(`submitted as ${id}`);
        ctx.progress(0.08, 'Generating…');

        let failures = 0;
        for (;;) {
          if (signal.aborted) throw new Error('cancelled');
          const elapsed = Date.now() - started;
          if (elapsed > timeoutMs) throw new Error(`Generation took longer than ${h3.jobTimeoutMin} minutes and was stopped.`);
          let status: VideoJobBody;
          try {
            const r = await http(`${base}/v1/videos/${encodeURIComponent(id)}`);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            status = (await r.json()) as VideoJobBody;
            failures = 0;
          } catch (e) {
            if (signal.aborted) throw new Error('cancelled');
            if (++failures >= 5) {
              const st = manager.status();
              throw new Error(`Lost contact with the model server${st.error ? ` (${st.error})` : ''}: ${e instanceof Error ? e.message : String(e)}`);
            }
            await new Promise((r) => setTimeout(r, pollMs));
            continue;
          }
          const state = String(status.status ?? '').toLowerCase();
          if (FAILED.has(state)) throw new Error(`The model reported "${state}": ${errorText(status)}`);
          if (DONE.has(state)) break;
          const reported = typeof status.progress === 'number' ? (status.progress > 1 ? status.progress / 100 : status.progress) : null;
          const secs = Math.round(elapsed / 1000);
          const clock = `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`;
          ctx.progress(reported !== null ? 0.08 + 0.87 * Math.min(1, Math.max(0, reported)) : 0.1, `Generating… ${clock}${reported !== null ? ` (${Math.round(reported * 100)}%)` : ''}`);
          await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, pollMs);
            signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('cancelled')); }, { once: true });
          });
        }

        ctx.progress(0.96, 'Downloading the video…');
        const dl = await http(`${base}/v1/videos/${encodeURIComponent(id)}/content`, {}, 10 * 60_000);
        if (!dl.ok || !dl.body) throw new Error(`Could not download the finished video (HTTP ${dl.status}).`);
        const out = path.join(dir, 'output.mp4');
        await pipeline(Readable.fromWeb(dl.body as never), createWriteStream(out));
        if ((await stat(out)).size === 0) throw new Error('The model server returned an empty video file.');
        return { video: 'output.mp4' };
      } catch (err) {
        if (signal.aborted && requested) {
          // The server can't be interrupted mid-denoise; best effort delete, then free the GPU by restarting it later.
          if (id) await fetch(`${base!}/v1/videos/${encodeURIComponent(id)}`, { method: 'DELETE', signal: AbortSignal.timeout(3000) }).catch(() => undefined);
          if (h3.serverMode === 'managed') {
            ctx.log('cancelled — stopping the model server to abort the in-flight generation (it restarts on the next job)');
            await manager.stop();
          } else {
            ctx.log('cancelled — an externally run server may keep computing until it finishes');
          }
        }
        throw err;
      } finally {
        if (ensured) manager.release();
      }
    },
  };
}
