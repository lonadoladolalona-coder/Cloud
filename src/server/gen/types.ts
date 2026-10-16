import type { AssetKind, AssetRole } from '../../shared/types';
import type { CommandSettings, JobRecord } from '../../shared/api';

/** One reference file, copied into the job folder under its prompt label (e.g. inputs/Picture_1.png). */
export interface JobInput {
  label: string;
  kind: AssetKind;
  role: AssetRole;
  filename: string;
  mime: string;
  note: string;
  /** Absolute path of the copy inside the job directory. */
  path: string;
}

export interface BackendContext {
  job: JobRecord;
  /** Absolute job directory; everything the backend writes goes here. */
  dir: string;
  inputs: JobInput[];
  command: CommandSettings;
  signal: AbortSignal;
  progress(fraction: number, message?: string): void;
  log(line: string): void;
}

/** File names, relative to the job directory. */
export interface BackendResult {
  video?: string;
  poster?: string;
}

export interface Backend {
  run(ctx: BackendContext): Promise<BackendResult>;
}
