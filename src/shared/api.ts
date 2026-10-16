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
export type BackendKind = 'mock' | 'command';

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
  };
}

export interface SettingsUpdate {
  llm?: Partial<Pick<SettingsView['llm'], 'model' | 'effort' | 'refusalFallback'>> & { apiKey?: string; clearApiKey?: boolean };
  generation?: { backend?: BackendKind; command?: Partial<CommandSettings> };
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
