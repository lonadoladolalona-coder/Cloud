import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import type { BackendKind, JobAssetInput, JobRecord } from '../../shared/api';
import type { GenParams, Mode, PromptDoc } from '../../shared/types';
import type { Settings } from '../settings';
import { newId, type Store } from '../store';
import type { Backend, JobInput } from './types';

export interface EnqueueInput {
  doc: PromptDoc;
  prompt: string;
  mode: Mode;
  params: GenParams;
  backend: BackendKind;
  assets: Array<JobAssetInput & { sourcePath: string; mime: string }>;
}

const MAX_LOG = 200;

/** Runs jobs one at a time (a local model usually owns the whole GPU) and keeps every job on disk. */
export class JobQueue {
  private jobs = new Map<string, JobRecord>();
  private current: { id: string; abort: AbortController } | null = null;
  private listeners = new Set<(job: JobRecord) => void>();
  private lastPersist = new Map<string, number>();

  constructor(
    private store: Store,
    private getSettings: () => Settings,
    private backends: Record<BackendKind, Backend>,
  ) {
    for (const job of store.loadJobs()) {
      if (job.status === 'queued' || job.status === 'running') {
        job.status = 'failed';
        job.error = 'Interrupted: the server restarted while this job was active.';
        job.finishedAt = new Date().toISOString();
        store.saveJob(job);
      }
      this.jobs.set(job.id, job);
    }
  }

  list(): JobRecord[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }

  subscribe(fn: (job: JobRecord) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(job: JobRecord, persist: boolean): void {
    const now = Date.now();
    if (persist || now - (this.lastPersist.get(job.id) ?? 0) > 2000) {
      this.store.saveJob(job);
      this.lastPersist.set(job.id, now);
    }
    for (const fn of this.listeners) fn(structuredClone(job));
  }

  enqueue(input: EnqueueInput): JobRecord {
    const id = newId();
    const job: JobRecord = {
      id,
      createdAt: new Date().toISOString(),
      status: 'queued',
      progress: 0,
      message: 'Waiting in queue',
      backend: input.backend,
      mode: input.mode,
      prompt: input.prompt,
      doc: input.doc,
      params: input.params,
      assets: input.assets.map(({ assetId, label, kind, role, filename, note }) => ({ assetId, label, kind, role, filename, note })),
      log: [],
    };
    this.jobs.set(id, job);
    this.pendingInputs.set(id, input.assets);
    this.emit(job, true);
    void this.pump();
    return job;
  }

  private pendingInputs = new Map<string, EnqueueInput['assets']>();

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.status === 'queued') {
      job.status = 'cancelled';
      job.message = 'Cancelled';
      job.finishedAt = new Date().toISOString();
      this.pendingInputs.delete(id);
      this.emit(job, true);
      return true;
    }
    if (job.status === 'running' && this.current?.id === id) {
      this.current.abort.abort();
      return true;
    }
    return false;
  }

  async remove(id: string): Promise<'ok' | 'missing' | 'active'> {
    const job = this.jobs.get(id);
    if (!job) return 'missing';
    if (job.status === 'running') return 'active';
    this.jobs.delete(id);
    this.pendingInputs.delete(id);
    await this.store.deleteJob(id);
    return 'ok';
  }

  /** Cancels the running job and everything waiting (graceful shutdown). */
  cancelAll(): void {
    for (const job of this.jobs.values()) if (job.status === 'queued' || job.status === 'running') this.cancel(job.id);
  }

  /** True while a job is running or waiting. */
  busy(): boolean {
    return Boolean(this.current) || [...this.jobs.values()].some((j) => j.status === 'queued');
  }

  /** Resolves once nothing is queued or running — used by tests and graceful shutdown. */
  async idle(): Promise<void> {
    while (this.current || [...this.jobs.values()].some((j) => j.status === 'queued')) {
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  private async pump(): Promise<void> {
    if (this.current) return;
    const next = [...this.jobs.values()].filter((j) => j.status === 'queued').sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!next) return;
    const abort = new AbortController();
    this.current = { id: next.id, abort };
    try {
      await this.run(next, abort);
    } finally {
      this.current = null;
      void this.pump();
    }
  }

  private async run(job: JobRecord, abort: AbortController): Promise<void> {
    const dir = this.store.jobDir(job.id);
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    job.message = 'Starting';
    this.emit(job, true);
    try {
      await fs.mkdir(path.join(dir, 'inputs'), { recursive: true });
      const inputs: JobInput[] = [];
      for (const a of this.pendingInputs.get(job.id) ?? []) {
        const dest = path.join(dir, 'inputs', `${a.label.replace(/\s+/g, '_')}${path.extname(a.sourcePath)}`);
        await fs.copyFile(a.sourcePath, dest, constants.COPYFILE_FICLONE);
        inputs.push({ label: a.label, kind: a.kind, role: a.role, filename: a.filename, mime: a.mime, note: a.note, path: dest });
      }
      const result = await this.backends[job.backend].run({
        job,
        dir,
        inputs,
        command: this.getSettings().generation.command,
        h3: this.getSettings().generation.h3,
        signal: abort.signal,
        progress: (fraction, message) => {
          job.progress = Math.max(0, Math.min(1, fraction));
          if (message) job.message = message;
          this.emit(job, false);
        },
        log: (line) => {
          job.log.push(line.slice(0, 500));
          if (job.log.length > MAX_LOG) job.log.splice(0, job.log.length - MAX_LOG);
          this.emit(job, false);
        },
      });
      job.video = result.video;
      job.poster = result.poster;
      job.status = 'succeeded';
      job.progress = 1;
      job.message = result.video ? 'Done' : 'Done (no video file — mock backend)';
    } catch (err) {
      if (abort.signal.aborted) {
        job.status = 'cancelled';
        job.message = 'Cancelled';
      } else {
        job.status = 'failed';
        job.error = err instanceof Error ? err.message : String(err);
        job.message = 'Failed';
      }
    } finally {
      this.pendingInputs.delete(job.id);
      job.finishedAt = new Date().toISOString();
      this.emit(job, true);
    }
  }
}
