import { formatSeconds2, formatTimecode } from './timecode';
import type { AudioMarker, LabeledAsset, Mode, PromptDoc } from './types';

const FRAME_ROLES = new Set(['first_frame', 'last_frame', 'keyframe', 'edited_keyframe', 'composition_anchor']);

const clean = (s: string) => s.trim();

/** Task types for the full-reference `summary` prefix, per the guide's task-type table. */
export function taskTypes(doc: PromptDoc, assets: LabeledAsset[]): string[] {
  const has = (pred: (a: LabeledAsset) => boolean) => assets.some(pred);
  const types: string[] = [];

  if (has((a) => a.kind === 'video' && a.role === 'edit_source')) types.push('video editing');
  if (has((a) => a.kind === 'video' && a.role === 'continuation_source')) types.push('video continuation');
  if (has((a) => a.kind === 'image' && FRAME_ROLES.has(a.role))) types.push('keyframe completion');

  const providesGuidance =
    doc.subjects.length > 0 ||
    has((a) => (a.kind === 'image' || a.kind === 'video') && a.role === 'subject') ||
    has((a) => a.kind === 'image' && a.role === 'storyboard') ||
    has((a) => a.kind === 'video' && a.role === 'structure_reference');
  if (providesGuidance) types.push('reference generation');

  const audioMarkers = assets
    .filter((a) => a.kind === 'audio')
    .map((a): AudioMarker => doc.audios.find((d) => d.label === a.label)?.marker ?? (a.role === 'audio_copy' ? 'fully_copy' : 'reference'));
  if (audioMarkers.some((m) => m === 'fully_copy' || m === 'partially_copy')) types.push('audio reuse');
  if (audioMarkers.some((m) => m === 'reference' || m === 'weak_reference')) types.push('audio reference');

  return types.length ? types : ['reference generation'];
}

/**
 * First line of a base-mode prompt (I2VA / FL2VA / L2VA). The wording — including which label
 * style (<Picture 1> vs Picture 1) each variant uses — is copied from the guide's templates.
 */
export function alignmentInstruction(mode: Mode, doc: PromptDoc, assets: LabeledAsset[]): string | null {
  const lastShot = doc.shots.length;
  const seconds = formatSeconds2(doc.durationSec);
  const first = assets.find((a) => a.kind === 'image' && a.role === 'first_frame');
  const last = assets.find((a) => a.kind === 'image' && a.role === 'last_frame');
  switch (mode) {
    case 'I2VA':
      return `For the target video, at 0.00 seconds into the target video, <${first?.label ?? 'Picture 1'}> (from [Shot 1]) is fully referenced.`;
    case 'FL2VA':
      return `How the reference pictures align with the target video — ${first?.label ?? 'Picture 1'} (from Shot 1) aligns with the 0.00-second mark of the target video; ${last?.label ?? 'Picture 2'} (from Shot ${lastShot}) aligns with the ${seconds}-second mark of the target video.`;
    case 'L2VA':
      return `How the reference pictures align with the target video — <${last?.label ?? 'Picture 1'}> (from [Shot ${lastShot}]) aligns with the ${seconds}-second mark of the target video.`;
    default:
      return null;
  }
}

function shotPrefix(index: number, startMs: number): string {
  return index === 0 ? '[Shot 1]' : `[Shot ${index + 1}] At ${formatTimecode(startMs)},`;
}

function compileBase(doc: PromptDoc, assets: LabeledAsset[], mode: Mode): string {
  const style = clean(doc.style).replace(/[,\s]+$/, '');
  const shots = doc.shots
    .map((shot, i) => {
      const body = clean(shot.text);
      if (i === 0) return style ? `[Shot 1] ${style}, ${body}` : `[Shot 1] ${body}`;
      return `${shotPrefix(i, shot.startMs)} ${body}`;
    })
    .join(' ');
  const blocks: string[] = [];
  const alignment = alignmentInstruction(mode, doc, assets);
  if (alignment) blocks.push(alignment);
  blocks.push(`integrated_multimodal_description: ${shots}`);
  blocks.push(`overall_soundscape: ${clean(doc.soundscape)}`);
  blocks.push(`non_diegetic_music: ${clean(doc.music)}`);
  return blocks.join('\n\n');
}

const shotList = (shots: number[]) => shots.map((n) => `[Shot ${n}]`).join(', ');

function compileReference(doc: PromptDoc, assets: LabeledAsset[]): string {
  const pictures = [...doc.pictures].sort(byLabelNumber);
  const videos = [...doc.videos].sort(byLabelNumber);
  const audios = [...doc.audios].sort(byLabelNumber);

  const definitions = [
    ...doc.subjects.map((s, i) => `<Subject ${i + 1}> ${clean(s.text)}`),
    ...pictures.map((p) => `<${p.label}> ${clean(p.text)}`),
    ...videos.map((v) => `<${v.label}> ${clean(v.text)}`),
    ...audios.map((a) => `<${a.label}> ${clean(a.text)}`),
  ];

  const retention = [
    ...doc.subjects.map((s, i) => {
      const where = s.appearsIn.length ? ` (appears in ${shotList(s.appearsIn)})` : '';
      return `<Subject ${i + 1}>${where}: ${s.marker} - ${clean(s.note)}`;
    }),
    ...pictures.map((p) => `<${p.label}>${p.anchor.trim() ? ` (${clean(p.anchor)})` : ''}: ${p.marker} - ${clean(p.note)}`),
    ...videos.map((v) => `<${v.label}>${v.aspect.trim() ? ` (${clean(v.aspect)})` : ''}: ${v.marker} - ${clean(v.note)}`),
    ...audios.map((a) => `<${a.label}>: ${a.marker} - ${clean(a.note)}`),
  ];

  const types = taskTypes(doc, assets);
  const editSource = assets.find((a) => a.kind === 'video' && a.role === 'edit_source');
  const editSentence = editSource ? `The target video is an edited version of <${editSource.label}>. ` : '';
  const summary = `[${types.join(' + ')}] ${editSentence}${clean(doc.summary)}`.trimEnd();

  const description = [
    ...(clean(doc.style) ? [clean(doc.style)] : []),
    ...doc.shots.map((shot, i) => `${shotPrefix(i, shot.startMs)} ${clean(shot.text)}`),
  ].join('\n');

  return [
    `subject_definitions:\n${definitions.join('\n')}`,
    `summary:\n${summary}`,
    `retention_analysis:\n${retention.join('\n')}`,
    `detailed_description:\n${description}`,
    `overall_soundscape:\n${clean(doc.soundscape)}`,
    `non_diegetic_music:\n${clean(doc.music)}`,
  ].join('\n\n');
}

function byLabelNumber(a: { label: string }, b: { label: string }): number {
  return Number(a.label.split(' ')[1]) - Number(b.label.split(' ')[1]);
}

/** Renders the prompt text the model receives, in the format the guides specify for `mode`. */
export function compile(doc: PromptDoc, assets: LabeledAsset[], mode: Mode): string {
  return mode === 'REFERENCE' ? compileReference(doc, assets) : compileBase(doc, assets, mode);
}

/** Order in which reference files are handed to the model: Pictures, then Videos, then Audios. */
export function assetsInModelOrder(assets: LabeledAsset[]): LabeledAsset[] {
  const rank = { image: 0, video: 1, audio: 2 } as const;
  return [...assets].sort((a, b) => rank[a.kind] - rank[b.kind] || a.index - b.index);
}
