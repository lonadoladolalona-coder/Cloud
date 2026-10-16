import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DirEntry, DirListing } from '../../shared/api';
import { normalizeInputPath } from './scan';

async function looksLikeModel(dir: string): Promise<boolean> {
  try {
    const names = (await fs.readdir(dir)).map((n) => n.toLowerCase());
    return names.includes('fl2va') || names.includes('ref2va');
  } catch {
    return false;
  }
}

async function driveRoots(): Promise<string[]> {
  const roots: string[] = [];
  for (let c = 65; c <= 90; c++) {
    const root = `${String.fromCharCode(c)}:\\`;
    try {
      await fs.access(root);
      roots.push(root);
    } catch {
      /* no such drive */
    }
  }
  return roots;
}

/** Lists sub-folders so the UI can offer a folder picker (a browser can't reveal absolute paths itself). */
export async function listDirs(input: string, platform: NodeJS.Platform = process.platform): Promise<DirListing> {
  if (!input.trim() && platform === 'win32') return { path: '', parent: null, sep: path.sep, dirs: [], roots: await driveRoots() };
  const dir = input.trim() ? normalizeInputPath(input) : os.homedir();
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => {
    throw new Error(`Cannot open ${dir}`);
  });
  const names = entries.filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith('.') && !e.name.startsWith('$')).map((e) => e.name).sort((a, b) => a.localeCompare(b));
  const dirs: DirEntry[] = [];
  for (const name of names.slice(0, 500)) {
    const full = path.join(dir, name);
    try {
      if (!(await fs.stat(full)).isDirectory()) continue;
    } catch {
      continue;
    }
    dirs.push({ name, path: full, isModel: dirs.length < 200 && (await looksLikeModel(full)) });
  }
  const parent = path.dirname(dir);
  return {
    path: dir,
    parent: parent === dir ? (platform === 'win32' ? '' : null) : parent,
    sep: path.sep,
    dirs,
    roots: platform === 'win32' ? await driveRoots() : undefined,
  };
}
