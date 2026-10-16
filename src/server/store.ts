import { randomBytes } from 'node:crypto';
import { promises as fs, mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { AssetRecord, JobRecord } from '../shared/api';
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from './settings';

export const ID_RE = /^[a-f0-9]{16}$/;
export const newId = () => randomBytes(8).toString('hex');

function writeJsonAtomic(file: string, data: unknown, mode = 0o644): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode });
  renameSync(tmp, file);
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export const EXT_BY_KIND = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
  video: ['mp4', 'webm', 'mov', 'm4v'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'],
} as const;

/** File-backed storage under one data directory: settings, uploaded assets, job records and outputs. */
export class Store {
  readonly settingsFile: string;
  readonly assetsDir: string;
  readonly jobsDir: string;

  constructor(readonly dir: string) {
    this.settingsFile = path.join(dir, 'settings.json');
    this.assetsDir = path.join(dir, 'assets');
    this.jobsDir = path.join(dir, 'jobs');
    for (const d of [dir, this.assetsDir, this.jobsDir]) mkdirSync(d, { recursive: true });
  }

  loadSettings(): Settings {
    return mergeSettings(DEFAULT_SETTINGS, readJson(this.settingsFile));
  }

  saveSettings(s: Settings): void {
    // The file can hold an API key, so keep it owner-readable only.
    writeJsonAtomic(this.settingsFile, s, 0o600);
  }

  // ---- assets ---------------------------------------------------------------------------------
  assetDir(id: string): string {
    if (!ID_RE.test(id)) throw new Error('bad id');
    return path.join(this.assetsDir, id);
  }

  async saveAsset(rec: AssetRecord, ext: string, original: Uint8Array, preview?: Uint8Array): Promise<void> {
    const dir = this.assetDir(rec.id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `original.${ext}`), original);
    if (preview) await fs.writeFile(path.join(dir, 'preview.jpg'), preview);
    writeJsonAtomic(path.join(dir, 'meta.json'), { ...rec, ext });
  }

  getAsset(id: string): (AssetRecord & { ext: string }) | null {
    if (!ID_RE.test(id)) return null;
    return readJson(path.join(this.assetDir(id), 'meta.json'));
  }

  assetPath(id: string, which: 'original' | 'preview'): string | null {
    const meta = this.getAsset(id);
    if (!meta) return null;
    const file = path.join(this.assetDir(id), which === 'preview' ? 'preview.jpg' : `original.${meta.ext}`);
    return existsSync(file) ? file : null;
  }

  listAssets(): AssetRecord[] {
    const out: AssetRecord[] = [];
    for (const name of readdirSync(this.assetsDir)) {
      const meta = this.getAsset(name);
      if (meta) {
        const { ext: _ext, ...rec } = meta;
        out.push(rec);
      }
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async deleteAsset(id: string): Promise<boolean> {
    if (!this.getAsset(id)) return false;
    await fs.rm(this.assetDir(id), { recursive: true, force: true });
    return true;
  }

  // ---- jobs -----------------------------------------------------------------------------------
  jobDir(id: string): string {
    if (!ID_RE.test(id)) throw new Error('bad id');
    return path.join(this.jobsDir, id);
  }

  saveJob(job: JobRecord): void {
    mkdirSync(this.jobDir(job.id), { recursive: true });
    writeJsonAtomic(path.join(this.jobDir(job.id), 'record.json'), job);
  }

  loadJobs(): JobRecord[] {
    const jobs: JobRecord[] = [];
    for (const name of readdirSync(this.jobsDir)) {
      if (!ID_RE.test(name)) continue;
      const rec = readJson<JobRecord>(path.join(this.jobsDir, name, 'record.json'));
      if (rec) jobs.push(rec);
    }
    return jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async deleteJob(id: string): Promise<void> {
    await fs.rm(this.jobDir(id), { recursive: true, force: true });
  }
}
