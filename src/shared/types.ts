/** Prompt modes defined by the two Minimax H3 guides. */
export type Mode = 'T2VA' | 'I2VA' | 'FL2VA' | 'L2VA' | 'REFERENCE';

export type AssetKind = 'image' | 'video' | 'audio';

/**
 * What an uploaded asset is for. The role decides both the prompt mode and the
 * label/section it gets (Picture N / Video N / Audio N, Subject N definitions).
 */
export type AssetRole =
  // images
  | 'first_frame'
  | 'last_frame'
  | 'keyframe'
  | 'edited_keyframe'
  | 'composition_anchor'
  | 'storyboard'
  // images or videos: visible content (character, scene, style, action) to reuse
  | 'subject'
  // videos
  | 'edit_source'
  | 'continuation_source'
  | 'structure_reference'
  // audio
  | 'audio_copy'
  | 'audio_reference';

export const ROLES_BY_KIND: Record<AssetKind, AssetRole[]> = {
  image: ['subject', 'first_frame', 'last_frame', 'keyframe', 'edited_keyframe', 'composition_anchor', 'storyboard'],
  video: ['subject', 'edit_source', 'continuation_source', 'structure_reference'],
  audio: ['audio_reference', 'audio_copy'],
};

export const ROLE_LABELS: Record<AssetRole, string> = {
  first_frame: 'First frame',
  last_frame: 'Last frame',
  keyframe: 'Keyframe',
  edited_keyframe: 'Edited keyframe',
  composition_anchor: 'Composition anchor',
  storyboard: 'Storyboard / shot plan',
  subject: 'Reuse content (character, scene, style…)',
  edit_source: 'Video to edit',
  continuation_source: 'Video to continue',
  structure_reference: 'Camera / cut / rhythm reference',
  audio_copy: 'Reuse this audio',
  audio_reference: 'Reference timbre / music / rhythm',
};

/** An asset as the prompt engine sees it (no file paths — those are a server concern). */
export interface AssetRef {
  id: string;
  kind: AssetKind;
  filename: string;
  role: AssetRole;
  note: string;
}

export interface LabeledAsset extends AssetRef {
  /** "Picture 1", "Video 2", "Audio 1" — numbered per kind in list order. */
  label: string;
  index: number;
}

export type VisibleMarker = 'fully_preserved' | 'partially_preserved' | 'attribute_transfer' | 'weak_reference';
export type AudioMarker = 'fully_copy' | 'partially_copy' | 'reference' | 'weak_reference';

export const VISIBLE_MARKERS: VisibleMarker[] = ['fully_preserved', 'partially_preserved', 'attribute_transfer', 'weak_reference'];
export const AUDIO_MARKERS: AudioMarker[] = ['fully_copy', 'partially_copy', 'reference', 'weak_reference'];

export interface Shot {
  /** Cut time in ms. Shot 1 is always rendered without a timestamp. */
  startMs: number;
  /** Shot body, WITHOUT the "[Shot N]" marker or "At MM:SS.mmm," prefix. */
  text: string;
}

/** <Subject N> — text is everything after the label, e.g. "is the young woman in <Picture 1>, with …". */
export interface SubjectDef {
  text: string;
  appearsIn: number[];
  marker: VisibleMarker;
  note: string;
}

/** A standalone <Picture N> entry (first/last frame, keyframe, storyboard…). */
export interface PictureDef {
  label: string;
  text: string;
  /** e.g. "[Shot 1] first frame" — goes in the parentheses of the retention line. */
  anchor: string;
  marker: VisibleMarker;
  note: string;
}

/** A <Video N> entry (edit source, continuation, structure reference). */
export interface VideoDef {
  label: string;
  text: string;
  /** e.g. "cut and pacing structure". */
  aspect: string;
  marker: VisibleMarker;
  note: string;
}

export interface AudioDef {
  label: string;
  text: string;
  marker: AudioMarker;
  note: string;
}

export interface PromptDoc {
  durationSec: number;
  /**
   * Base modes: the short style phrase placed right after "[Shot 1]" ("Live-action, cinematic").
   * Reference mode: one or two sentences placed before "[Shot 1]".
   */
  style: string;
  shots: Shot[];
  soundscape: string;
  music: string;
  /** Reference mode only. Body of the summary, without the [task types] prefix. */
  summary: string;
  subjects: SubjectDef[];
  pictures: PictureDef[];
  videos: VideoDef[];
  audios: AudioDef[];
}

export type Severity = 'error' | 'warning' | 'info';

export interface LintIssue {
  id: string;
  severity: Severity;
  message: string;
  /** Which part of the editor the issue belongs to, e.g. "shots", "shot:2", "soundscape". */
  where?: string;
}

export interface GenParams {
  durationSec: number;
  aspectRatio: string;
  resolution: string;
  seed: number | null;
  generateAudio: boolean;
}

export function blankDoc(durationSec = 8): PromptDoc {
  return {
    durationSec,
    style: '',
    shots: [{ startMs: 0, text: '' }],
    soundscape: '',
    music: 'N/A',
    summary: '',
    subjects: [],
    pictures: [],
    videos: [],
    audios: [],
  };
}
