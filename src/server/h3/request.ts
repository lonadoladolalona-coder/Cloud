import type { H3Variant } from '../../shared/api';
import type { AssetKind, AssetRole, GenParams, Mode } from '../../shared/types';

/** A user-facing problem with the job itself (not the server): shown as-is. */
export class H3RequestError extends Error {}

export const H3_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
export const H3_MIN_SECONDS = 4;
export const H3_MAX_SECONDS = 15;
const MAX_IMAGES = 9;
const MAX_VIDEOS = 3;
const MAX_AUDIOS = 3;
const MAX_REFS = 12;

export interface H3Item {
  label: string;
  kind: AssetKind;
  role: AssetRole;
  /** file:// or data: URI the model server can read. */
  uri: string;
}

export interface H3Condition {
  type: AssetKind;
  uri: string;
  role: 'keyframe' | 'reference';
  frame_index?: number;
}

export interface H3Request {
  variant: H3Variant;
  body: {
    task: 't2va' | 'fl2va' | 'ref2va';
    prompt: string;
    conditions: H3Condition[];
    target: { short_edge: 768; aspect_ratio: string; duration_seconds: number };
    seed: number;
  };
  /** Settings the model can't honour, worth showing in the job log. */
  notes: string[];
}

/**
 * Builds the body of SGLang's POST /v1/videos exactly as MiniMax's reproducible scripts do:
 *   T2VA  → task t2va, no conditions                       (FL2VA checkpoint)
 *   I2VA  → task fl2va, keyframe at frame_index 0          (FL2VA checkpoint)
 *   L2VA  → task fl2va, keyframe at frame_index -1         (FL2VA checkpoint)
 *   FL2VA → task fl2va, keyframes at 0 and -1              (FL2VA checkpoint)
 *   REFERENCE → task ref2va, every file role "reference"   (Ref2VA checkpoint)
 * Throws H3RequestError for anything the model's documented limits forbid.
 */
export function buildH3Request(input: { mode: Mode; prompt: string; params: GenParams; items: H3Item[]; randomSeed?: () => number }): H3Request {
  const { mode, prompt, params, items } = input;
  const notes: string[] = [];

  const duration = Math.round(params.durationSec * 100) / 100;
  if (duration < H3_MIN_SECONDS || duration > H3_MAX_SECONDS) {
    throw new H3RequestError(`MiniMax H3 generates ${H3_MIN_SECONDS}–${H3_MAX_SECONDS} second videos; this prompt is ${duration}s. Change the duration (and shot times) first.`);
  }
  if (!prompt.trim()) throw new H3RequestError('The prompt is empty.');

  const images = items.filter((i) => i.kind === 'image');
  const videos = items.filter((i) => i.kind === 'video');
  const audios = items.filter((i) => i.kind === 'audio');

  let variant: H3Variant;
  let task: H3Request['body']['task'];
  let conditions: H3Condition[];
  let aspect: string;

  if (mode === 'REFERENCE') {
    variant = 'ref2va';
    task = 'ref2va';
    if (items.length === 0) throw new H3RequestError('Reference mode needs at least one image, video or audio file.');
    if (images.length > MAX_IMAGES) throw new H3RequestError(`Ref2VA accepts at most ${MAX_IMAGES} images (you have ${images.length}).`);
    if (videos.length > MAX_VIDEOS) throw new H3RequestError(`Ref2VA accepts at most ${MAX_VIDEOS} reference videos (you have ${videos.length}).`);
    if (audios.length > MAX_AUDIOS) throw new H3RequestError(`Ref2VA accepts at most ${MAX_AUDIOS} reference audio clips (you have ${audios.length}).`);
    if (items.length > MAX_REFS) throw new H3RequestError(`Ref2VA accepts at most ${MAX_REFS} files in total (you have ${items.length}).`);
    if (audios.length > 0 && images.length + videos.length === 0) throw new H3RequestError('Reference audio needs at least one image or video alongside it (Ref2VA does not accept audio alone).');
    conditions = items.map((i) => ({ type: i.kind, uri: i.uri, role: 'reference' as const }));
    aspect = H3_RATIOS.includes(params.aspectRatio) ? params.aspectRatio : '16:9';
    if (images.some((i) => i.role === 'first_frame' || i.role === 'last_frame')) {
      notes.push('Ref2VA has no keyframe slots: first/last-frame images are sent as ordinary references.');
    }
  } else {
    variant = 'fl2va';
    if (videos.length > 0 || audios.length > 0) throw new H3RequestError('Video and audio references need full-reference mode (Ref2VA).');
    if (images.length > 2) throw new H3RequestError('The first/last-frame checkpoint accepts at most 2 images.');
    const first = images.find((i) => i.role === 'first_frame');
    const last = images.find((i) => i.role === 'last_frame');
    if (images.length !== (first ? 1 : 0) + (last ? 1 : 0)) throw new H3RequestError('Images in this mode must be marked First frame or Last frame.');
    conditions = [];
    if (first) conditions.push({ type: 'image', uri: first.uri, role: 'keyframe', frame_index: 0 });
    if (last) conditions.push({ type: 'image', uri: last.uri, role: 'keyframe', frame_index: -1 });
    task = conditions.length === 0 ? 't2va' : 'fl2va';
    // T2VA needs a named ratio; with an image the model follows the image's own ratio.
    aspect = conditions.length === 0 ? (H3_RATIOS.includes(params.aspectRatio) ? params.aspectRatio : '16:9') : 'auto';
    if (conditions.length > 0 && params.aspectRatio !== 'auto') notes.push(`Aspect ratio follows the ${first ? 'first' : 'last'} frame image, not "${params.aspectRatio}".`);
  }

  if (params.resolution !== '768p') notes.push(`Resolution is fixed at 768p on the short edge locally (you chose ${params.resolution}; 2K needs MiniMax's cloud H3-Regenerate-2K).`);
  if (!params.generateAudio) notes.push('H3 always generates audio; "Generate audio" is ignored.');

  const seed = params.seed ?? (input.randomSeed ?? (() => Math.floor(Math.random() * 2 ** 31)))();
  return { variant, body: { task, prompt, conditions, target: { short_edge: 768, aspect_ratio: aspect, duration_seconds: duration }, seed }, notes };
}
