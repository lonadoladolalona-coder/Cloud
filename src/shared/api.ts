import type { DialogueMode } from './presets';
import type { AssetKind, AssetRef, AssetRole, GenParams, LabeledAsset, LintIssue, Mode, PromptDoc } from './types';

export interface AssetRecord {
  id: string;
  kind: AssetKind;
  filename: string;
  mime: string;
  size: number;
  hasPreview: boolean;
  createdAt: string;
}

export const assetUrl = (id: string, which: 'original' | 'preview' = 'original') => `/files/assets/${id}/${which}`;
export const jobFileUrl = (id: string, which: 'video' | 'poster', download = false) =>
  `/files/jobs/${id}/${which}${download ? '?download=1' : ''}`;

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type BackendKind = 'mock' | 'command' | 'h3';

export interface JobAssetInput {
  assetId: string;
  label: string;
  kind: AssetKind;
  role: AssetRole;
  filename: string;
  note: string;
}

export interface JobRecord {
  id: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  status: JobStatus;
  /** 0..1 */
  progress: number;
  message: string;
  backend: BackendKind;
  mode: Mode;
  prompt: string;
  doc: PromptDoc;
  params: GenParams;
  assets: JobAssetInput[];
  video?: string;
  poster?: string;
  error?: string;
  log: string[];
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface CommandSettings {
  program: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMin: number;
}

/** MiniMax H3 run from a local model folder (HF layout: model_index.json + FL2VA/ + Ref2VA/). */
export interface H3Settings {
  /** Folder the user pointed at; resolved to the real model root by the scanner. */
  modelDir: string;
  /** managed: Studio starts/stops `sglang serve` itself. external: you run it and give URLs. */
  serverMode: 'managed' | 'external';
  /** Path to the sglang executable; blank = auto-detect. */
  sglangPath: string;
  /** 0 = auto-detect from nvidia-smi. */
  numGpus: number;
  /** FL2VA server port; Ref2VA uses port + 1 (SGLang's official 30010 / 30011). */
  port: number;
  /** Extra arguments appended to `sglang serve`, one per entry. */
  extraArgs: string[];
  env: Record<string, string>;
  externalFl2vaUrl: string;
  externalRef2vaUrl: string;
  /** file: pass absolute paths (server on this machine). data: embed files as base64 (server in a container/VM). */
  assetTransport: 'file' | 'data';
  /** Minutes to wait for the model to load. */
  startupTimeoutMin: number;
  /** Stop the server (freeing the GPU) after this many idle minutes; 0 = never. */
  idleStopMin: number;
  /** Minutes allowed for one generation. */
  jobTimeoutMin: number;
}

export type H3Variant = 'fl2va' | 'ref2va';
export type H3ServerState = 'stopped' | 'starting' | 'ready' | 'error';

export interface H3ServerStatus {
  state: H3ServerState;
  variant?: H3Variant;
  url?: string;
  pid?: number;
  error?: string;
  /** Last lines of the server's output. */
  log: string[];
}

export const H3_COMPONENTS = ['processor', 'tokenizer', 'text_encoder', 'transformer', 'visual_vae', 'audio_vae'] as const;
export type H3Component = (typeof H3_COMPONENTS)[number];

export interface H3VariantScan {
  variant: H3Variant;
  /** Folder name as found on disk (FL2VA / Ref2VA, any case). */
  folder: string;
  dir: string;
  present: boolean;
  hasModelIndex: boolean;
  components: Record<H3Component, 'ok' | 'missing' | 'no_weights' | 'lfs_pointer'>;
  sizeBytes: number;
  complete: boolean;
  problems: string[];
}

export interface H3Tooling {
  sglang: { path: string; via: string } | null;
  vllm: { path: string } | null;
  ffmpeg: boolean;
  gpus: Array<{ name: string; memoryMiB: number }>;
}

export interface H3Scan {
  inputPath: string;
  exists: boolean;
  /** Resolved model root to pass to sglang (--model-path). */
  root?: string;
  layout: 'hf-root' | 'variant-folder' | 'comfyui' | 'unknown';
  variants: H3VariantScan[];
  tooling: H3Tooling;
  /** Things the user should know or fix, most important first. */
  notes: Array<{ level: 'error' | 'warn' | 'info'; text: string }>;
  /** Ready to run: at least one complete variant and a way to start it. */
  ready: boolean;
  /** Values the UI can apply to the settings. */
  suggested: Partial<Pick<H3Settings, 'modelDir' | 'sglangPath' | 'numGpus'>>;
}

export interface DirEntry {
  name: string;
  path: string;
  /** Looks like an H3 model folder (has FL2VA/ or Ref2VA/). */
  isModel: boolean;
}

export interface DirListing {
  path: string;
  parent: string | null;
  sep: string;
  dirs: DirEntry[];
  /** Windows drive roots when path is empty. */
  roots?: string[];
}

export interface SettingsView {
  llm: {
    model: string;
    effort: Effort;
    refusalFallback: boolean;
    apiKeySet: boolean;
    apiKeyHint: string;
    envKeyAvailable: boolean;
  };
  generation: {
    backend: BackendKind;
    command: CommandSettings;
    h3: H3Settings;
  };
}

export interface SettingsUpdate {
  llm?: Partial<Pick<SettingsView['llm'], 'model' | 'effort' | 'refusalFallback'>> & { apiKey?: string; clearApiKey?: boolean };
  generation?: { backend?: BackendKind; command?: Partial<CommandSettings>; h3?: Partial<H3Settings> };
}

export interface EnhanceRequest {
  idea: string;
  presetId?: string;
  durationSec: number;
  aspectRatio: string;
  dialogue: DialogueMode;
  dialogueLanguage: string;
  music: boolean;
  assets: AssetRef[];
  /** Force a mode instead of deriving it from asset roles. */
  modeOverride?: Mode;
}

export interface EnhanceResponse {
  doc: PromptDoc;
  mode: Mode;
  assets: LabeledAsset[];
  text: string;
  lint: LintIssue[];
  /** True when the first draft failed validation and was revised once. */
  revised: boolean;
}

export interface CreateJobRequest {
  doc: PromptDoc;
  assets: AssetRef[];
  modeOverride?: Mode;
  params: GenParams;
  backend?: BackendKind;
  /** Queue even if the linter reports errors. */
  force?: boolean;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
