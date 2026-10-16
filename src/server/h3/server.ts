import { execFile, spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import type { H3ServerStatus, H3Settings, H3Variant } from '../../shared/api';
import { detectTooling, normalizeInputPath, resolveModelRoot } from './scan';

const MAX_LOG = 200;

/** A problem with the server setup, phrased for the user. */
export class H3ServerError extends Error {}

export interface EnsureOptions {
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('cancelled')); }, { once: true });
  });

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

function killTree(pid: number, signal: NodeJS.Signals): void {
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => undefined);
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    /* already gone */
  }
}

/**
 * Owns the model server. In "managed" mode it runs MiniMax's documented command
 *   sglang serve --model-path <root> --model-variant <fl2va|ref2va> --port <p> ...
 * for whichever checkpoint the next job needs (one at a time, since each one fills the GPU), waits until it
 * answers, and stops it after a quiet period. In "external" mode it only checks that your own server answers.
 */
export class H3ServerManager {
  private proc: ChildProcess | null = null;
  private variant: H3Variant | undefined;
  private state: H3ServerStatus['state'] = 'stopped';
  private url: string | undefined;
  private error: string | undefined;
  private log: string[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  private idleTimer: NodeJS.Timeout | undefined;
  private busy = 0;

  constructor(
    private getSettings: () => H3Settings,
    /** Milliseconds between readiness checks while the model loads. */
    private readyPollMs = 1500,
  ) {}

  status(): H3ServerStatus {
    return { state: this.state, variant: this.variant, url: this.url, pid: this.proc?.pid, error: this.error, log: [...this.log] };
  }

  /** Runs a step after every earlier start/stop finished, so swaps can't overlap. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Makes sure a server for this checkpoint is answering and returns its base URL. */
  ensure(variant: H3Variant, opts: EnsureOptions = {}): Promise<string> {
    this.busy++;
    clearTimeout(this.idleTimer);
    // Report "starting" straight away so a UI polling the status sees it before the first await.
    if (this.getSettings().serverMode === 'managed' && !(this.proc && this.variant === variant && this.state === 'ready')) {
      this.state = 'starting';
      this.variant = variant;
      this.error = undefined;
    }
    return this.serial(() => this.doEnsure(variant, opts)).catch((err: unknown) => {
      this.busy--;
      if (this.state === 'starting') {
        const cancelled = err instanceof Error && err.message === 'cancelled';
        this.state = cancelled ? 'stopped' : 'error';
        this.error = cancelled ? undefined : err instanceof Error ? err.message : String(err);
      }
      throw err;
    });
  }

  /** Call when a job that used `ensure` is over, successful or not. */
  release(): void {
    this.busy = Math.max(0, this.busy - 1);
    this.scheduleIdleStop();
  }

  private scheduleIdleStop(): void {
    clearTimeout(this.idleTimer);
    const minutes = this.getSettings().idleStopMin;
    if (this.busy > 0 || !this.proc || minutes <= 0) return;
    this.idleTimer = setTimeout(() => {
      if (this.busy === 0) void this.stop();
    }, minutes * 60_000);
    this.idleTimer.unref();
  }

  private async doEnsure(variant: H3Variant, opts: EnsureOptions): Promise<string> {
    const s = this.getSettings();
    if (s.serverMode === 'external') return this.checkExternal(variant, s);

    if (this.proc && this.variant === variant && this.state === 'ready' && this.url) return this.url;
    if (this.proc) await this.doStop();
    return this.start(variant, s, opts);
  }

  private async checkExternal(variant: H3Variant, s: H3Settings): Promise<string> {
    const url = (variant === 'fl2va' ? s.externalFl2vaUrl : s.externalRef2vaUrl).replace(/\/+$/, '');
    const label = variant === 'fl2va' ? 'text/first-last-frame (FL2VA)' : 'reference (Ref2VA)';
    if (!url) throw new H3ServerError(`No server URL is set for ${label} prompts. Add it under Settings → MiniMax H3 → "I run the server myself".`);
    try {
      await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    } catch {
      this.state = 'error';
      this.error = `Cannot reach ${url}`;
      throw new H3ServerError(`Cannot reach the ${label} server at ${url}. Start it first, e.g. sglang serve --model-path <folder> --model-variant ${variant} --port ${new URL(url).port || 30010}`);
    }
    this.variant = variant;
    this.url = url;
    this.state = 'ready';
    this.error = undefined;
    return url;
  }

  private async start(variant: H3Variant, s: H3Settings, opts: EnsureOptions): Promise<string> {
    if (!s.modelDir.trim()) throw new H3ServerError('No model folder is set. Open Settings → MiniMax H3 and pick the folder that holds FL2VA/ and Ref2VA/.');
    const resolved = await resolveModelRoot(normalizeInputPath(s.modelDir));
    if (!resolved.root) throw new H3ServerError(`No H3 model found in ${s.modelDir}. Scan the folder under Settings to see what is missing.`);
    const folder = variant === 'fl2va' ? 'FL2VA' : 'Ref2VA';
    const tooling = await detectTooling(resolved.root, { sglangHint: s.sglangPath || undefined });
    const exe = s.sglangPath || tooling.sglang?.path;
    if (!exe) throw new H3ServerError('SGLang was not found. Install it (with MiniMax-H3 support), or set its path under Settings, or choose "I run the server myself".');

    const port = variant === 'fl2va' ? s.port : s.port + 1;
    if (!(await portIsFree(port))) throw new H3ServerError(`Port ${port} is already in use. Stop whatever is using it or choose another base port under Settings → Advanced.`);

    const gpus = s.numGpus > 0 ? s.numGpus : Math.max(1, tooling.gpus.length);
    const args = ['serve', '--model-path', resolved.root, '--model-variant', variant, '--num-gpus', String(gpus), ...(gpus > 1 ? ['--ulysses-degree', String(gpus)] : []), '--host', '127.0.0.1', '--port', String(port), ...s.extraArgs];

    this.log = [`$ ${exe} ${args.join(' ')}`];
    this.error = undefined;
    this.variant = variant;
    this.url = `http://127.0.0.1:${port}`;
    this.state = 'starting';

    const child = spawn(exe, args, { env: { ...process.env, ...s.env }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
    this.proc = child;
    let exited = null as string | null;
    const push = (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        this.log.push(line.slice(0, 400));
        if (this.log.length > MAX_LOG) this.log.splice(1, this.log.length - MAX_LOG);
      }
    };
    child.stdout?.on('data', push);
    child.stderr?.on('data', push);
    child.on('error', (e) => {
      exited = `Could not start ${exe}: ${e.message}`;
    });
    child.on('close', (code, sig) => {
      exited = exited ?? (sig ? `sglang was stopped (${sig}).` : `sglang exited with code ${code}.`);
      if (this.proc === child) {
        this.proc = null;
        if (this.state !== 'stopped') {
          this.state = 'error';
          this.error = exited;
        }
      }
    });

    const started = Date.now();
    const deadline = started + s.startupTimeoutMin * 60_000;
    const fail = async (message: string): Promise<never> => {
      await this.doStop().catch(() => undefined);
      this.state = 'error';
      this.error = message;
      throw new H3ServerError(message);
    };
    try {
      for (;;) {
        if (exited) return await fail(`${exited}${this.tail()}`);
        if (Date.now() > deadline) return await fail(`${folder} did not become ready within ${s.startupTimeoutMin} minutes.${this.tail()}`);
        if (opts.signal?.aborted) throw new Error('cancelled');
        if (await this.answers(this.url)) break;
        const secs = Math.round((Date.now() - started) / 1000);
        opts.onStatus?.(`Loading ${folder} into memory… ${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s (first start can take several minutes)`);
        await sleep(this.readyPollMs, opts.signal);
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'cancelled') await this.doStop().catch(() => undefined);
      throw err;
    }
    this.state = 'ready';
    return this.url;
  }

  private tail(): string {
    const lines = this.log.slice(-6);
    return lines.length > 1 ? `\n${lines.join('\n')}` : '';
  }

  /** The server counts as ready when /health succeeds; a 404 means "up, but no health route". */
  private async answers(base: string): Promise<boolean> {
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
      return res.ok || res.status === 404;
    } catch {
      return false;
    }
  }

  /** Synchronous last-resort kill for process exit, so a quit never leaves the model holding the GPU. */
  killNow(): void {
    clearTimeout(this.idleTimer);
    const pid = this.proc?.pid;
    if (pid !== undefined && this.proc?.exitCode === null) killTree(pid, 'SIGKILL');
  }

  stop(): Promise<void> {
    clearTimeout(this.idleTimer);
    return this.serial(() => this.doStop());
  }

  private async doStop(): Promise<void> {
    const child = this.proc;
    this.proc = null;
    this.state = 'stopped';
    this.url = undefined;
    this.variant = undefined;
    if (!child || child.pid === undefined || child.exitCode !== null) return;
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
    killTree(child.pid, 'SIGTERM');
    const forced = setTimeout(() => killTree(child.pid!, 'SIGKILL'), 15_000);
    await Promise.race([closed, sleep(20_000)]).catch(() => undefined);
    clearTimeout(forced);
  }
}
