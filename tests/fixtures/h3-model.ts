import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const COMPONENTS = ['processor', 'tokenizer', 'text_encoder', 'transformer', 'visual_vae', 'audio_vae'] as const;
const CONFIG_ONLY = new Set(['processor', 'tokenizer']);

export interface ModelOptions {
  variants?: Array<'FL2VA' | 'Ref2VA'>;
  /** Components left out, e.g. 'FL2VA/audio_vae'. */
  omit?: string[];
  /** Components whose weights are Git-LFS pointer stubs. */
  lfsPointers?: string[];
  /** Components that declare a sharded checkpoint with a missing shard. */
  missingShard?: string[];
  /** Folder names are written lower-case (as some Windows extractors do). */
  lowerCase?: boolean;
}

const WEIGHT_BYTES = Buffer.alloc(4096, 7);

/** Writes a small stand-in for the Hugging Face layout MiniMax documents. */
export function makeModel(root: string, opts: ModelOptions = {}): string {
  const variants = opts.variants ?? ['FL2VA', 'Ref2VA'];
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, 'model_index.json'), '{}');
  for (const v of variants) {
    const vdir = path.join(root, opts.lowerCase ? v.toLowerCase() : v);
    mkdirSync(vdir, { recursive: true });
    writeFileSync(path.join(vdir, 'model_index.json'), '{"_class_name":"H3"}');
    for (const c of COMPONENTS) {
      if (opts.omit?.includes(`${v}/${c}`)) continue;
      const cdir = path.join(vdir, c);
      mkdirSync(cdir, { recursive: true });
      if (CONFIG_ONLY.has(c)) {
        writeFileSync(path.join(cdir, 'config.json'), '{}');
        continue;
      }
      writeFileSync(path.join(cdir, 'config.json'), '{}');
      if (opts.lfsPointers?.includes(`${v}/${c}`)) {
        writeFileSync(path.join(cdir, 'model.safetensors'), 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12345678\n');
      } else if (opts.missingShard?.includes(`${v}/${c}`)) {
        writeFileSync(path.join(cdir, 'model-00001-of-00002.safetensors'), WEIGHT_BYTES);
        writeFileSync(path.join(cdir, 'model.safetensors.index.json'), JSON.stringify({ weight_map: { a: 'model-00001-of-00002.safetensors', b: 'model-00002-of-00002.safetensors' } }));
      } else {
        writeFileSync(path.join(cdir, 'model.safetensors'), WEIGHT_BYTES);
      }
    }
  }
  return root;
}
