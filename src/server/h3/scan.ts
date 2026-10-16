import { execFile } from 'node:child_process';
import { constants, promises as fs, type Dirent } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { H3_COMPONENTS, type H3Component, type H3Scan, type H3Tooling, type H3Variant, type H3VariantScan } from '../../shared/api';

/** The Hugging Face repo hosts one self-contained checkpoint per task family. */
const VARIANTS: Array<{ variant: H3Variant; folder: string }> = [
  { variant: 'fl2va', folder: 'FL2VA' },
  { variant: 'ref2va', folder: 'Ref2VA' },
];
/** Components that carry weights; processor/tokenizer are small config folders. */
const WEIGHT_COMPONENTS: H3Component[] = ['text_encoder', 'transformer', 'visual_vae', 'audio_vae'];
const WEIGHT_EXT = new Set(['.safetensors', '.bin', '.pt', '.pth', '.ckpt', '.gguf']);
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'site-packages', '$recycle.bin', 'system volume information', 'windows', 'proc', 'sys']);
const MAX_WALK = 20_000;

export interface ScanOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Runs a program and returns stdout; rejects when it is missing or fails. Injected by tests. */
  run?: (cmd: string, args: string[]) => Promise<string>;
  /** An explicitly configured sglang path to check first. */
  sglangHint?: string;
}

const defaultRun = (cmd: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile(cmd, args, { timeout: 6000, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });

/** Strips quotes and expands ~ so a path pasted from Explorer/Finder/a terminal just works. */
export function normalizeInputPath(input: string): string {
  let p = input.trim().replace(/^["']+|["']+$/g, '');
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(p);
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

async function readDir(p: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(p, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Case-insensitive child lookup (Windows users often end up with `fl2va`). */
async function findChildDir(parent: string, name: string): Promise<string | null> {
  for (const e of await readDir(parent)) {
    if (e.name.toLowerCase() === name.toLowerCase() && (e.isDirectory() || (e.isSymbolicLink() && (await isDir(path.join(parent, e.name)))))) return e.name;
  }
  return null;
}

async function hasVariantDirs(dir: string): Promise<boolean> {
  for (const v of VARIANTS) if (await findChildDir(dir, v.folder)) return true;
  return false;
}

interface WalkedFile {
  rel: string;
  abs: string;
  size: number;
}

async function walk(root: string, maxDepth: number): Promise<WalkedFile[]> {
  const out: WalkedFile[] = [];
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (out.length >= MAX_WALK) return;
    for (const e of await readDir(dir)) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < maxDepth) await visit(abs, depth + 1);
      } else if (e.isFile() || e.isSymbolicLink()) {
        try {
          const st = await fs.stat(abs);
          if (st.isFile()) out.push({ rel: path.relative(root, abs), abs, size: st.size });
        } catch {
          /* dangling link */
        }
      }
      if (out.length >= MAX_WALK) return;
    }
  };
  await visit(root, 0);
  return out;
}

async function isLfsPointer(file: WalkedFile): Promise<boolean> {
  if (file.size > 1024) return false;
  try {
    return (await fs.readFile(file.abs, 'utf8')).startsWith('version https://git-lfs');
  } catch {
    return false;
  }
}

async function scanComponent(dir: string, component: H3Component, problems: string[], label: string): Promise<H3VariantScan['components'][H3Component]> {
  const name = await findChildDir(dir, component);
  if (!name) return 'missing';
  const files = await walk(path.join(dir, name), 3);
  if (files.length === 0) return 'missing';
  if (!WEIGHT_COMPONENTS.includes(component)) return 'ok';

  const weights = files.filter((f) => WEIGHT_EXT.has(path.extname(f.rel).toLowerCase()));
  if (weights.length === 0) return 'no_weights';
  if ((await Promise.all(weights.map(isLfsPointer))).some(Boolean)) return 'lfs_pointer';

  // Sharded checkpoints list every shard in an *.index.json; make sure none is missing.
  for (const idx of files.filter((f) => f.rel.endsWith('.index.json'))) {
    try {
      const map = (JSON.parse(await fs.readFile(idx.abs, 'utf8')) as { weight_map?: Record<string, string> }).weight_map ?? {};
      const shards = [...new Set(Object.values(map))];
      const have = new Set(files.map((f) => path.basename(f.rel)));
      const missing = shards.filter((s) => !have.has(path.basename(s)));
      if (missing.length > 0) {
        problems.push(`${label}/${component}: ${missing.length} of ${shards.length} weight shards are missing (${missing.slice(0, 2).join(', ')}${missing.length > 2 ? ', …' : ''}).`);
        return 'no_weights';
      }
    } catch {
      /* unreadable index — the weights themselves are present */
    }
  }
  return 'ok';
}

async function dirSize(dir: string): Promise<number> {
  return (await walk(dir, 6)).reduce((sum, f) => sum + f.size, 0);
}

async function scanVariant(root: string, v: { variant: H3Variant; folder: string }): Promise<H3VariantScan> {
  const actual = await findChildDir(root, v.folder);
  const empty = Object.fromEntries(H3_COMPONENTS.map((c) => [c, 'missing'])) as H3VariantScan['components'];
  if (!actual) return { variant: v.variant, folder: v.folder, dir: path.join(root, v.folder), present: false, hasModelIndex: false, components: empty, sizeBytes: 0, complete: false, problems: [] };

  const dir = path.join(root, actual);
  const problems: string[] = [];
  const hasModelIndex = await isFile(path.join(dir, 'model_index.json'));
  if (!hasModelIndex) problems.push(`${actual}/model_index.json is missing.`);
  const components = { ...empty };
  for (const c of H3_COMPONENTS) {
    components[c] = await scanComponent(dir, c, problems, actual);
    if (components[c] === 'missing') problems.push(`${actual}/${c}/ is missing or empty.`);
    if (components[c] === 'no_weights' && !problems.some((p) => p.startsWith(`${actual}/${c}`))) problems.push(`${actual}/${c}/ has no weight files (.safetensors).`);
    if (components[c] === 'lfs_pointer') problems.push(`${actual}/${c}/ holds Git-LFS pointer stubs instead of real weights — the download did not fetch the large files.`);
  }
  const complete = hasModelIndex && H3_COMPONENTS.every((c) => components[c] === 'ok');
  return { variant: v.variant, folder: actual, dir, present: true, hasModelIndex, components, sizeBytes: await dirSize(dir), complete, problems };
}

/** Breadth-first search below `start` for a folder that contains FL2VA/ or Ref2VA/. */
async function searchForRoot(start: string, maxDepth: number): Promise<string[]> {
  const found: string[] = [];
  let frontier = [start];
  let visited = 0;
  for (let depth = 0; depth < maxDepth && frontier.length > 0 && visited < 600; depth++) {
    const next: string[] = [];
    for (const dir of frontier) {
      for (const e of await readDir(dir)) {
        if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name.toLowerCase())) continue;
        const abs = path.join(dir, e.name);
        visited++;
        if (await hasVariantDirs(abs)) found.push(abs);
        else next.push(abs);
      }
    }
    frontier = next;
  }
  return found;
}

async function findInPath(names: string[], env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Promise<string | null> {
  const dirs = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  for (const d of dirs) {
    for (const n of names) {
      const p = path.join(d, n);
      if (await canExecute(p, platform)) return p;
    }
  }
  return null;
}

async function canExecute(p: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    if (!st.isFile()) return false;
    if (platform !== 'win32') await fs.access(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findTool(tool: string, roots: string[], hint: string | undefined, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Promise<{ path: string; via: string } | null> {
  const win = platform === 'win32';
  const names = win ? [`${tool}.exe`] : [tool];
  if (hint && (await canExecute(hint, platform))) return { path: hint, via: 'your setting' };

  const venvDirs = ['.venv', 'venv', 'env', '.env', 'sglang-env', 'h3-env'];
  const bin = win ? 'Scripts' : 'bin';
  const seen = new Set<string>();
  for (const base of roots) {
    for (const v of venvDirs) {
      for (const n of names) {
        const p = path.join(base, v, bin, n);
        if (seen.has(p)) continue;
        seen.add(p);
        if (await canExecute(p, platform)) return { path: p, via: `virtual environment next to the models (${path.join(base, v)})` };
      }
    }
  }
  for (const prefix of [env.VIRTUAL_ENV, env.CONDA_PREFIX]) {
    if (!prefix) continue;
    for (const n of names) {
      const p = path.join(prefix, bin, n);
      if (await canExecute(p, platform)) return { path: p, via: 'the active Python environment' };
    }
  }
  const onPath = await findInPath(names, env, platform);
  return onPath ? { path: onPath, via: 'PATH' } : null;
}

export async function detectTooling(modelRoot: string | undefined, opts: ScanOptions = {}): Promise<H3Tooling> {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const run = opts.run ?? defaultRun;
  const roots = modelRoot ? [modelRoot, path.dirname(modelRoot), path.dirname(path.dirname(modelRoot))] : [];

  const [sglang, vllm, ffmpeg, gpuText] = await Promise.all([
    findTool('sglang', roots, opts.sglangHint, env, platform),
    findTool('vllm', roots, undefined, env, platform),
    findInPath(platform === 'win32' ? ['ffmpeg.exe'] : ['ffmpeg'], env, platform),
    run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']).catch(() => ''),
  ]);

  const gpus = gpuText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.lastIndexOf(',');
      return { name: l.slice(0, i).trim(), memoryMiB: Number(l.slice(i + 1)) || 0 };
    });
  return { sglang, vllm: vllm ? { path: vllm.path } : null, ffmpeg: Boolean(ffmpeg), gpus };
}

async function findHfIncomplete(root: string): Promise<number> {
  const cache = path.join(root, '.cache');
  if (!(await isDir(cache))) return 0;
  return (await walk(cache, 6)).filter((f) => f.rel.endsWith('.incomplete')).length;
}

export interface RootResolution {
  root?: string;
  layout: H3Scan['layout'];
  notes: H3Scan['notes'];
}

/** Works out which folder is the model root (the one SGLang's --model-path needs) from whatever the user pointed at. */
export async function resolveModelRoot(abs: string): Promise<RootResolution> {
  const notes: H3Scan['notes'] = [];
  if (await hasVariantDirs(abs)) return { root: abs, layout: 'hf-root', notes };
  if (VARIANTS.some((v) => v.folder.toLowerCase() === path.basename(abs).toLowerCase())) {
    const parent = path.dirname(abs);
    if (await hasVariantDirs(parent)) {
      notes.push({ level: 'info', text: `You selected the ${path.basename(abs)} folder; using its parent ${parent} as the model root (it also holds the other checkpoint).` });
      return { root: parent, layout: 'hf-root', notes };
    }
    return { root: abs, layout: 'variant-folder', notes };
  }
  if ((await isFile(path.join(abs, 'main.py'))) && (await isDir(path.join(abs, 'models')))) return { layout: 'comfyui', notes };
  const found = await searchForRoot(abs, 3);
  if (found.length > 0) {
    notes.push({ level: 'info', text: `Found the model inside the folder you gave: ${found[0]}` });
    if (found.length > 1) notes.push({ level: 'warn', text: `Several model folders were found; using the first. Others: ${found.slice(1, 4).join(', ')}` });
    return { root: found[0], layout: 'hf-root', notes };
  }
  return { layout: 'unknown', notes };
}

const gib = (n: number) => `${(n / 2 ** 30).toFixed(1)} GB`;

export async function scanModelFolder(input: string, opts: ScanOptions = {}): Promise<H3Scan> {
  const abs = normalizeInputPath(input);
  const scan: H3Scan = {
    inputPath: input,
    exists: false,
    layout: 'unknown',
    variants: [],
    tooling: { sglang: null, vllm: null, ffmpeg: false, gpus: [] },
    notes: [],
    ready: false,
    suggested: {},
  };
  const note = (level: 'error' | 'warn' | 'info', text: string) => scan.notes.push({ level, text });

  if (!input.trim()) {
    note('error', 'Enter the path of the folder that holds the H3 model.');
    scan.tooling = await detectTooling(undefined, opts);
    return scan;
  }
  if (!(await isDir(abs))) {
    note('error', `Folder not found: ${abs}`);
    scan.tooling = await detectTooling(undefined, opts);
    return scan;
  }
  scan.exists = true;

  const resolved = await resolveModelRoot(abs);
  const root = resolved.root;
  scan.layout = resolved.layout;
  for (const n of resolved.notes) note(n.level, n.text);
  scan.root = root;

  if (scan.layout === 'comfyui') {
    const hits = (await walk(path.join(abs, 'models'), 3)).filter((f) => /h3/i.test(path.basename(f.rel)) && WEIGHT_EXT.has(path.extname(f.rel).toLowerCase()));
    note('warn', 'This is a ComfyUI install, not the Hugging Face checkpoint folder (FL2VA/ + Ref2VA/). Studio cannot drive ComfyUI workflows yet — point it at the folder that holds FL2VA/ and Ref2VA/, or run H3 behind SGLang.');
    if (hits.length > 0) note('info', `H3 files found in ComfyUI/models: ${hits.slice(0, 6).map((h) => h.rel).join(', ')}${hits.length > 6 ? ', …' : ''}`);
  } else if (!root) {
    note('error', 'No H3 model found here. I look for a folder that contains FL2VA/ and/or Ref2VA/ (each with model_index.json, transformer/, text_encoder/, visual_vae/, audio_vae/, tokenizer/, processor/).');
    note('info', 'Download with: hf download MiniMaxAI/MiniMax-H3 --include "model_index.json" "FL2VA/*" "Ref2VA/*" --local-dir MiniMax-H3');
  }

  if (root) {
    scan.variants = await Promise.all(VARIANTS.map((v) => scanVariant(root!, v)));
    if (scan.layout === 'variant-folder') {
      note('warn', 'This looks like a single checkpoint folder without its parent. SGLang expects the parent folder with FL2VA/ and Ref2VA/ plus --model-variant; keep the original layout if the server fails to load it.');
    }
    for (const v of scan.variants) {
      if (!v.present) note('warn', `${v.folder}/ not found — ${v.variant === 'fl2va' ? 'text-to-video and first/last-frame prompts' : 'reference (image/video/audio) prompts'} will not be available.`);
      else if (v.complete) note('info', `${v.folder}/ is complete (${gib(v.sizeBytes)}).`);
      else for (const p of v.problems) note('error', p);
    }
    const unfinished = await findHfIncomplete(root);
    if (unfinished > 0) note('error', `${unfinished} file(s) in .cache/huggingface are still marked .incomplete — the download was interrupted. Re-run the same hf download command to resume.`);
  }

  scan.tooling = await detectTooling(root ?? abs, opts);
  const t = scan.tooling;
  if (!t.sglang) {
    note('warn', 'SGLang was not found (checked a virtual environment next to the models, the active environment and PATH). Install SGLang with MiniMax-H3 support (see docs.sglang.io/cookbook/diffusion/MiniMax/MiniMax-H3), then scan again — or choose "I run the server myself".');
    if (t.vllm) note('info', `vLLM was found at ${t.vllm.path}. Studio talks to SGLang's /v1/videos API only; vLLM-Omni is not driven yet.`);
  } else {
    note('info', `SGLang found at ${t.sglang.path} (${t.sglang.via}).`);
  }
  if (t.gpus.length === 0) note('warn', 'No NVIDIA GPU detected (nvidia-smi did not answer). H3 needs a CUDA GPU; ignore this if your server runs on another machine.');
  else note('info', `GPU: ${t.gpus.map((g) => `${g.name} (${(g.memoryMiB / 1024).toFixed(0)} GB)`).join(', ')}.`);
  if (!t.ffmpeg) note('info', 'ffmpeg was not found on PATH. The model server may need it to write the MP4.');

  const completeCount = scan.variants.filter((v) => v.complete).length;
  scan.ready = completeCount > 0 && Boolean(t.sglang);
  scan.suggested = {
    ...(root ? { modelDir: root } : {}),
    ...(t.sglang ? { sglangPath: t.sglang.path } : {}),
    ...(t.gpus.length > 0 ? { numGpus: t.gpus.length } : {}),
  };
  // Errors first, then warnings, then info (stable otherwise).
  const rank = { error: 0, warn: 1, info: 2 } as const;
  scan.notes.sort((a, b) => rank[a.level] - rank[b.level]);
  return scan;
}
