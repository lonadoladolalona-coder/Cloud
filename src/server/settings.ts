import type { CommandSettings, Effort, SettingsUpdate, SettingsView, BackendKind } from '../shared/api';

export interface Settings {
  llm: { apiKey: string; model: string; effort: Effort; refusalFallback: boolean };
  generation: { backend: BackendKind; command: CommandSettings };
}

export const DEFAULT_SETTINGS: Settings = {
  llm: { apiKey: '', model: 'claude-opus-5-5', effort: 'high', refusalFallback: true },
  generation: {
    backend: 'mock',
    command: { program: '', args: [], cwd: '', env: {}, timeoutMin: 60 },
  },
};

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function mergeSettings(base: Settings, stored: unknown): Settings {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<Settings>;
  return {
    llm: { ...base.llm, ...(s.llm ?? {}) },
    generation: {
      backend: s.generation?.backend === 'command' ? 'command' : 'mock',
      command: { ...base.generation.command, ...(s.generation?.command ?? {}) },
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
      if (gen.backend !== 'mock' && gen.backend !== 'command') throw new Error('Unknown backend.');
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
  }
  return next;
}
