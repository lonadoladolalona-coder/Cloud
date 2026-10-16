import type { BackendKind, CommandSettings, Effort, H3Settings, SettingsUpdate, SettingsView } from '../shared/api';

export interface Settings {
  llm: { apiKey: string; model: string; effort: Effort; refusalFallback: boolean };
  generation: { backend: BackendKind; command: CommandSettings; h3: H3Settings };
}

export const DEFAULT_SETTINGS: Settings = {
  llm: { apiKey: '', model: 'claude-opus-5-5', effort: 'high', refusalFallback: true },
  generation: {
    backend: 'mock',
    command: { program: '', args: [], cwd: '', env: {}, timeoutMin: 60 },
    h3: {
      modelDir: '',
      serverMode: 'managed',
      sglangPath: '',
      numGpus: 0,
      port: 30010,
      extraArgs: [],
      env: {},
      externalFl2vaUrl: 'http://127.0.0.1:30010',
      externalRef2vaUrl: 'http://127.0.0.1:30011',
      assetTransport: 'file',
      startupTimeoutMin: 30,
      idleStopMin: 20,
      jobTimeoutMin: 90,
    },
  },
};

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function mergeSettings(base: Settings, stored: unknown): Settings {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<Settings>;
  return {
    llm: { ...base.llm, ...(s.llm ?? {}) },
    generation: {
      backend: s.generation?.backend === 'command' || s.generation?.backend === 'h3' ? s.generation.backend : 'mock',
      command: { ...base.generation.command, ...(s.generation?.command ?? {}) },
      h3: { ...base.generation.h3, ...(s.generation?.h3 ?? {}) },
    },
  };
}

function maskKey(key: string): string {
  return key.length > 12 ? `${key.slice(0, 7)}…${key.slice(-4)}` : key ? '••••' : '';
}

export function toView(s: Settings, env: NodeJS.ProcessEnv = process.env): SettingsView {
  return {
    llm: {
      model: s.llm.model,
      effort: s.llm.effort,
      refusalFallback: s.llm.refusalFallback,
      apiKeySet: Boolean(s.llm.apiKey),
      apiKeyHint: maskKey(s.llm.apiKey),
      envKeyAvailable: Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN),
    },
    generation: s.generation,
  };
}

/** Validates and applies a partial update. Throws a plain Error with a user-facing message on bad input. */
export function applyUpdate(current: Settings, update: SettingsUpdate): Settings {
  const next: Settings = structuredClone(current);
  const llm = update.llm;
  if (llm) {
    if (llm.model !== undefined) {
      if (!/^[\w.\-:/]{1,100}$/.test(llm.model)) throw new Error('Model name contains unsupported characters.');
      next.llm.model = llm.model;
    }
    if (llm.effort !== undefined) {
      if (!EFFORTS.includes(llm.effort)) throw new Error('Unknown effort level.');
      next.llm.effort = llm.effort;
    }
    if (llm.refusalFallback !== undefined) next.llm.refusalFallback = Boolean(llm.refusalFallback);
    if (llm.clearApiKey) next.llm.apiKey = '';
    else if (typeof llm.apiKey === 'string' && llm.apiKey.trim()) next.llm.apiKey = llm.apiKey.trim();
  }
  const gen = update.generation;
  if (gen) {
    if (gen.backend !== undefined) {
      if (gen.backend !== 'mock' && gen.backend !== 'command' && gen.backend !== 'h3') throw new Error('Unknown backend.');
      next.generation.backend = gen.backend;
    }
    const c = gen.command;
    if (c) {
      if (c.program !== undefined) next.generation.command.program = String(c.program).trim();
      if (c.args !== undefined) {
        if (!Array.isArray(c.args) || c.args.some((a) => typeof a !== 'string')) throw new Error('Arguments must be a list of strings.');
        next.generation.command.args = c.args;
      }
      if (c.cwd !== undefined) next.generation.command.cwd = String(c.cwd).trim();
      if (c.env !== undefined) {
        const entries = Object.entries(c.env);
        if (entries.some(([k, v]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || typeof v !== 'string')) throw new Error('Environment variable names/values are invalid.');
        next.generation.command.env = Object.fromEntries(entries);
      }
      if (c.timeoutMin !== undefined) {
        const t = Number(c.timeoutMin);
        if (!Number.isFinite(t) || t < 1 || t > 24 * 60) throw new Error('Timeout must be between 1 and 1440 minutes.');
        next.generation.command.timeoutMin = Math.round(t);
      }
    }
    if (gen.h3) applyH3(next.generation.h3, gen.h3);
  }
  return next;
}

const URL_RE = /^https?:\/\/[^\s]+$/i;

function intIn(value: unknown, min: number, max: number, what: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${what} must be between ${min} and ${max}.`);
  return Math.round(n);
}

function applyH3(target: H3Settings, u: Partial<H3Settings>): void {
  if (u.modelDir !== undefined) target.modelDir = String(u.modelDir).trim().slice(0, 1000);
  if (u.serverMode !== undefined) {
    if (u.serverMode !== 'managed' && u.serverMode !== 'external') throw new Error('Unknown server mode.');
    target.serverMode = u.serverMode;
  }
  if (u.sglangPath !== undefined) target.sglangPath = String(u.sglangPath).trim().slice(0, 1000);
  if (u.numGpus !== undefined) target.numGpus = intIn(u.numGpus, 0, 64, 'GPU count');
  if (u.port !== undefined) target.port = intIn(u.port, 1024, 65534, 'Port');
  if (u.extraArgs !== undefined) {
    if (!Array.isArray(u.extraArgs) || u.extraArgs.some((a) => typeof a !== 'string')) throw new Error('Extra arguments must be a list of strings.');
    target.extraArgs = u.extraArgs;
  }
  if (u.env !== undefined) {
    const entries = Object.entries(u.env);
    if (entries.some(([k, v]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || typeof v !== 'string')) throw new Error('Environment variable names/values are invalid.');
    target.env = Object.fromEntries(entries);
  }
  for (const key of ['externalFl2vaUrl', 'externalRef2vaUrl'] as const) {
    if (u[key] === undefined) continue;
    const url = String(u[key]).trim().replace(/\/+$/, '');
    if (url && !URL_RE.test(url)) throw new Error('Server URLs must start with http:// or https://.');
    target[key] = url;
  }
  if (u.assetTransport !== undefined) {
    if (u.assetTransport !== 'file' && u.assetTransport !== 'data') throw new Error('Unknown asset transport.');
    target.assetTransport = u.assetTransport;
  }
  if (u.startupTimeoutMin !== undefined) target.startupTimeoutMin = intIn(u.startupTimeoutMin, 1, 720, 'Startup timeout');
  if (u.idleStopMin !== undefined) target.idleStopMin = intIn(u.idleStopMin, 0, 1440, 'Idle stop');
  if (u.jobTimeoutMin !== undefined) target.jobTimeoutMin = intIn(u.jobTimeoutMin, 1, 1440, 'Job timeout');
}
