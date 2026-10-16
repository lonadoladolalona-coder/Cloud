import type { DirListing, H3Scan, H3VariantScan } from '../../shared/api';

/** A pretend computer for the demo: enough folders to try the picker and every kind of scan result. */
const HOME = '/home/you';
const TREE: Record<string, string[]> = {
  [HOME]: ['Documents', 'Downloads', 'models', 'projects'],
  [`${HOME}/Documents`]: [],
  [`${HOME}/Downloads`]: ['hf-cache'],
  [`${HOME}/Downloads/hf-cache`]: [],
  [`${HOME}/projects`]: ['studio-h3'],
  [`${HOME}/projects/studio-h3`]: [],
  [`${HOME}/models`]: ['MiniMax-H3', 'H3-partial-download', 'ComfyUI', 'flux-dev'],
  [`${HOME}/models/MiniMax-H3`]: ['FL2VA', 'Ref2VA'],
  [`${HOME}/models/MiniMax-H3/FL2VA`]: ['audio_vae', 'processor', 'text_encoder', 'tokenizer', 'transformer', 'visual_vae'],
  [`${HOME}/models/MiniMax-H3/Ref2VA`]: ['audio_vae', 'processor', 'text_encoder', 'tokenizer', 'transformer', 'visual_vae'],
  [`${HOME}/models/H3-partial-download`]: ['FL2VA', 'Ref2VA'],
  [`${HOME}/models/ComfyUI`]: ['custom_nodes', 'models', 'output'],
  [`${HOME}/models/flux-dev`]: [],
};
const MODELS = new Set([`${HOME}/models/MiniMax-H3`, `${HOME}/models/H3-partial-download`]);

const clean = (p: string) => p.trim().replace(/^["']+|["']+$/g, '').replace(/\/+$/, '') || '/';

export function listDirs(input: string): DirListing {
  const path = input.trim() ? clean(input) : HOME;
  const names = TREE[path];
  if (!names) throw new Error(`Cannot open ${path}`);
  const parent = path === '/' ? null : path.slice(0, path.lastIndexOf('/')) || '/';
  return { path, parent, sep: '/', dirs: names.map((name) => ({ name, path: `${path}/${name}`, isModel: MODELS.has(`${path}/${name}`) })) };
}

const COMPONENTS = ['processor', 'tokenizer', 'text_encoder', 'transformer', 'visual_vae', 'audio_vae'] as const;
const GB = 2 ** 30;

const variant = (name: 'FL2VA' | 'Ref2VA', root: string, broken?: 'transformer'): H3VariantScan => {
  const components = Object.fromEntries(COMPONENTS.map((c) => [c, broken === c ? 'lfs_pointer' : 'ok'])) as H3VariantScan['components'];
  return {
    variant: name === 'FL2VA' ? 'fl2va' : 'ref2va',
    folder: name,
    dir: `${root}/${name}`,
    present: true,
    hasModelIndex: true,
    components,
    sizeBytes: broken ? 0.4 * GB : (name === 'FL2VA' ? 21.3 : 21.6) * GB,
    complete: !broken,
    problems: broken ? [`${name}/${broken}/ holds Git-LFS pointer stubs instead of real weights — the download did not fetch the large files.`] : [],
  };
};

const TOOLING: H3Scan['tooling'] = {
  sglang: { path: `${HOME}/models/MiniMax-H3/.venv/bin/sglang`, via: `virtual environment next to the models (${HOME}/models/MiniMax-H3/.venv)` },
  vllm: null,
  ffmpeg: true,
  gpus: [{ name: 'NVIDIA GeForce RTX 4090', memoryMiB: 24564 }],
};

const toolingNotes = (): H3Scan['notes'] => [
  { level: 'info', text: `SGLang found at ${TOOLING.sglang!.path} (${TOOLING.sglang!.via}).` },
  { level: 'info', text: 'GPU: NVIDIA GeForce RTX 4090 (24 GB).' },
];

export function scanFolder(input: string): H3Scan {
  const path = clean(input);
  const base: H3Scan = { inputPath: input, exists: false, layout: 'unknown', variants: [], tooling: TOOLING, notes: [], ready: false, suggested: {} };
  if (!input.trim()) return { ...base, notes: [{ level: 'error', text: 'Enter the path of the folder that holds the H3 model.' }] };
  if (!TREE[path]) return { ...base, notes: [{ level: 'error', text: `Folder not found: ${path}  (this demo only knows the folders shown in Browse…)` }] };

  if (path.startsWith(`${HOME}/models/ComfyUI`)) {
    return {
      ...base,
      exists: true,
      layout: 'comfyui',
      notes: [
        { level: 'warn', text: 'This is a ComfyUI install, not the Hugging Face checkpoint folder (FL2VA/ + Ref2VA/). Studio cannot drive ComfyUI workflows yet — point it at the folder that holds FL2VA/ and Ref2VA/, or run H3 behind SGLang.' },
        { level: 'info', text: 'H3 files found in ComfyUI/models: diffusion_models/minimax_h3_fl2va_bf16.safetensors' },
        ...toolingNotes().slice(1),
      ],
    };
  }

  if (path.startsWith(`${HOME}/models/H3-partial-download`)) {
    const root = `${HOME}/models/H3-partial-download`;
    const variants = [variant('FL2VA', root), variant('Ref2VA', root, 'transformer')];
    return {
      ...base,
      exists: true,
      root,
      layout: 'hf-root',
      variants,
      notes: [
        { level: 'error', text: variants[1]!.problems[0]! },
        { level: 'error', text: '3 file(s) in .cache/huggingface are still marked .incomplete — the download was interrupted. Re-run the same hf download command to resume.' },
        { level: 'info', text: 'FL2VA/ is complete (21.3 GB).' },
        ...toolingNotes(),
      ],
      ready: true,
      suggested: { modelDir: root, sglangPath: TOOLING.sglang!.path, numGpus: 1 },
    };
  }

  if (path === HOME || path === `${HOME}/models` || path.startsWith(`${HOME}/models/MiniMax-H3`)) {
    const root = `${HOME}/models/MiniMax-H3`;
    const notes: H3Scan['notes'] = [];
    if (path !== root) notes.push({ level: 'info', text: `Found the model inside the folder you gave: ${root}` });
    notes.push({ level: 'info', text: 'FL2VA/ is complete (21.3 GB).' }, { level: 'info', text: 'Ref2VA/ is complete (21.6 GB).' }, ...toolingNotes());
    return {
      ...base,
      exists: true,
      root,
      layout: 'hf-root',
      variants: [variant('FL2VA', root), variant('Ref2VA', root)],
      notes,
      ready: true,
      suggested: { modelDir: root, sglangPath: TOOLING.sglang!.path, numGpus: 1 },
    };
  }

  return {
    ...base,
    exists: true,
    notes: [
      { level: 'error', text: 'No H3 model found here. I look for a folder that contains FL2VA/ and/or Ref2VA/ (each with model_index.json, transformer/, text_encoder/, visual_vae/, audio_vae/, tokenizer/, processor/).' },
      { level: 'info', text: 'Download with: hf download MiniMaxAI/MiniMax-H3 --include "model_index.json" "FL2VA/*" "Ref2VA/*" --local-dir MiniMax-H3' },
      ...toolingNotes().slice(1),
    ],
  };
}

export const DEMO_MODEL_ROOT = `${HOME}/models/MiniMax-H3`;
export const DEMO_SGLANG = TOOLING.sglang!.path;
