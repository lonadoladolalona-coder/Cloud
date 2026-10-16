import type { AssetKind, AssetRef, LabeledAsset, Mode, PromptDoc } from './types';

export type LabelKind = 'Subject' | 'Picture' | 'Video' | 'Audio';

const KIND_TO_LABEL: Record<AssetKind, LabelKind> = { image: 'Picture', video: 'Video', audio: 'Audio' };

/** Frame roles are sorted so a first-frame image is always Picture 1 and a last-frame image comes last. */
function imagePriority(a: AssetRef): number {
  if (a.role === 'first_frame') return 0;
  if (a.role === 'last_frame') return 2;
  return 1;
}

/**
 * Numbers assets per kind: Picture 1.., Video 1.., Audio 1.. The guides define Picture 1 as the
 * first frame (I2VA/FL2VA) and the highest Picture as the last frame, so images are ordered by
 * frame role first (stable otherwise). The returned array is the order assets are shown and sent.
 */
export function labelAssets(assets: AssetRef[]): LabeledAsset[] {
  const images = assets
    .filter((a) => a.kind === 'image')
    .map((a, i) => ({ a, i }))
    .sort((x, y) => imagePriority(x.a) - imagePriority(y.a) || x.i - y.i)
    .map((x) => x.a);
  const videos = assets.filter((a) => a.kind === 'video');
  const audios = assets.filter((a) => a.kind === 'audio');
  const out: LabeledAsset[] = [];
  for (const group of [images, videos, audios]) {
    group.forEach((a, i) => out.push({ ...a, label: `${KIND_TO_LABEL[a.kind]} ${i + 1}`, index: i + 1 }));
  }
  return out;
}

/**
 * Task variant implied by the assets. Only bare first/last-frame images keep the task in a base
 * mode; any other reuse of a person/scene/style, a source video or audio needs full-reference mode.
 */
export function deriveMode(assets: AssetRef[]): Mode {
  if (assets.length === 0) return 'T2VA';
  if (!assets.every((a) => a.kind === 'image' && (a.role === 'first_frame' || a.role === 'last_frame'))) return 'REFERENCE';
  const first = assets.filter((a) => a.role === 'first_frame').length;
  const last = assets.filter((a) => a.role === 'last_frame').length;
  if (first === 1 && last === 0) return 'I2VA';
  if (first === 1 && last === 1) return 'FL2VA';
  if (first === 0 && last === 1) return 'L2VA';
  return 'REFERENCE';
}

type NumberMap = (kind: LabelKind, n: number) => number | null;

const LABEL_RE = /\b(Subject|Picture|Video|Audio) (\d+)\b/g;

function remapText(text: string, map: NumberMap): string {
  return text.replace(LABEL_RE, (_whole, kind: LabelKind, n: string) => {
    const mapped = map(kind, Number(n));
    return `${kind} ${mapped === null ? '?' : mapped}`;
  });
}

function remapLabelField(label: string, map: NumberMap): string | null {
  const m = /^(Subject|Picture|Video|Audio) (\d+)$/.exec(label);
  if (!m) return label;
  const mapped = map(m[1] as LabelKind, Number(m[2]));
  return mapped === null ? null : `${m[1]} ${mapped}`;
}

/**
 * Rewrites every label reference in the document in a single pass (so swapped numbers don't
 * collide). A label mapped to null (its asset/subject was removed) becomes "Picture ?" in prose —
 * visibly broken, and flagged by the linter — and its standalone definition entry is dropped.
 */
export function remapDocLabels(doc: PromptDoc, map: NumberMap): PromptDoc {
  const t = (s: string) => remapText(s, map);
  return {
    ...doc,
    style: t(doc.style),
    shots: doc.shots.map((s) => ({ ...s, text: t(s.text) })),
    soundscape: t(doc.soundscape),
    music: t(doc.music),
    summary: t(doc.summary),
    subjects: doc.subjects.map((s) => ({ ...s, text: t(s.text), note: t(s.note) })),
    pictures: doc.pictures.flatMap((p) => {
      const label = remapLabelField(p.label, map);
      return label ? [{ ...p, label, text: t(p.text), anchor: t(p.anchor), note: t(p.note) }] : [];
    }),
    videos: doc.videos.flatMap((v) => {
      const label = remapLabelField(v.label, map);
      return label ? [{ ...v, label, text: t(v.text), aspect: t(v.aspect), note: t(v.note) }] : [];
    }),
    audios: doc.audios.flatMap((a) => {
      const label = remapLabelField(a.label, map);
      return label ? [{ ...a, label, text: t(a.text), note: t(a.note) }] : [];
    }),
  };
}

/**
 * Call whenever the asset list changes (upload, delete, role change). Re-labels the assets and
 * rewrites the document so "Picture 2" keeps pointing at the same file after renumbering.
 */
export function reconcileAssets(
  doc: PromptDoc,
  previous: LabeledAsset[],
  next: AssetRef[],
): { assets: LabeledAsset[]; doc: PromptDoc } {
  const assets = labelAssets(next);
  const newById = new Map(assets.map((a) => [a.id, a]));
  const maps: Record<'Picture' | 'Video' | 'Audio', Map<number, number | null>> = {
    Picture: new Map(),
    Video: new Map(),
    Audio: new Map(),
  };
  for (const old of previous) {
    const kind = KIND_TO_LABEL[old.kind] as 'Picture' | 'Video' | 'Audio';
    maps[kind].set(old.index, newById.get(old.id)?.index ?? null);
  }
  const unchanged = previous.every((p) => newById.get(p.id)?.index === p.index);
  if (unchanged) return { assets, doc };
  return {
    assets,
    doc: remapDocLabels(doc, (kind, n) => {
      if (kind === 'Subject') return n;
      const m = maps[kind].get(n);
      return m === undefined ? n : m;
    }),
  };
}

/** Removes <Subject index+1> and shifts later subject numbers down in all text. */
export function removeSubject(doc: PromptDoc, index: number): PromptDoc {
  const removed = index + 1;
  const without = { ...doc, subjects: doc.subjects.filter((_, i) => i !== index) };
  return remapDocLabels(without, (kind, n) => {
    if (kind !== 'Subject') return n;
    if (n === removed) return null;
    return n > removed ? n - 1 : n;
  });
}
