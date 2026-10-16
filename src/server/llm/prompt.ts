import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { EnhanceRequest } from '../../shared/api';
import type { Preset } from '../../shared/presets';
import { ROLE_LABELS, type LabeledAsset, type LintIssue, type Mode } from '../../shared/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const guide = (name: string) => readFileSync(path.join(here, '..', 'guides', name), 'utf8');

const INSTRUCTIONS = `You are the prompt-rewriting engine inside a local video-generation studio.

The two specifications above are the authoritative format for the target video model. Follow their rules and fixed vocabulary exactly; never paraphrase their terminology. Do not invent facts the user did not give you, but you may add consistent sensory detail where the guides allow it.

YOU DO NOT WRITE THE FINAL PROMPT TEXT. You return JSON fields and the application assembles the final text in the guides' exact layout. Therefore:
- Never write section names (integrated_multimodal_description, detailed_description, overall_soundscape, ...).
- Never write "[Shot N]" markers or "At MM:SS.mmm," prefixes inside shot text — the application adds them from each shot's startMs.
- Never write the alignment instruction (I2VA/FL2VA/L2VA) or the "[task type]" prefix of the summary.

FIELDS
- style
  · Base modes (T2VA/I2VA/FL2VA/L2VA): a short style phrase placed right after "[Shot 1]", e.g. "Live-action, cinematic". No trailing comma.
  · REFERENCE mode: one or two English sentences placed before [Shot 1], e.g. "The target video uses a realistic multi-camera sitcom style with warm indoor lighting."
- shots: in playback order. Shot 1 has startMs 0. Later shots have strictly increasing startMs (milliseconds) inside the video duration, each a real cut that adds new information.
  · Base modes: Shot 1's text continues right after the style phrase and a comma, so it starts lower-case with the initial composition ("a medium-wide shot frames…"). Later shots continue after "At MM:SS.mmm," so they start with the cut ("the camera cuts to…").
  · REFERENCE mode: Shot 1 starts directly with a capitalised sentence ("A medium shot establishes…"). Later shots continue after "At MM:SS.mmm," ("the shot cuts to…").
  · Describe only what is visible or audible: subject appearance and position, environment and lighting, actions and state changes, camera movement written as natural English (type + amplitude + speed only when not default), current sound, dialogue, on-screen text in double quotes.
  · Dialogue/lyrics: <d>[Language] exact words</d>, with the speaker ID and delivery OUTSIDE <d>. Speaker IDs (S1), (S2)… are numbered by order of first speech and never renumbered.
- soundscape: 1–4 sentences of ambience, physical and non-verbal sounds. No dialogue. "N/A" only for requested total silence.
- music: 1–3 sentences on audience-only score (instrumentation, tempo, dynamics; no mood words), or exactly "N/A".
- summary: REFERENCE mode only — one short paragraph WITHOUT the [task type] prefix. Base modes: "".
- subjects / pictures / videos / audios: REFERENCE mode only (empty arrays otherwise).
  · subjects[i] is <Subject i+1>. "text" is everything after the label, e.g. "is the young woman in <Picture 1>, with long dark hair…". "appearsIn" lists shot numbers (1-based). "marker" is one of the four visible-content markers; "note" says what is kept or changed.
  · pictures/videos/audios get a separate entry ONLY when the guide calls for one (a concrete frame anchor or storyboard; a whole-video relationship; an audio reference). "label" is exactly "Picture N" / "Video N" / "Audio N" as assigned below. For a picture, "anchor" is the parenthetical of its retention line (e.g. "[Shot 1] first frame"); for a video, "aspect" is the equivalent (e.g. "cut and pacing structure").
  · If an asset only defines a character, scene, costume or style, do NOT give it its own entry — cite it inside the relevant Subject's text.

GENERAL RULES
- Write all descriptive text in English. Keep dialogue, lyrics and visible text in their original language.
- Never translate, paraphrase or invent spoken/sung words that the user supplied.
- Once a label is assigned it keeps its meaning everywhere.
- Return only the JSON object.`;

export interface SystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

let cachedSystem: SystemBlock[] | null = null;

/** Both guides verbatim, then the app layer. The last block carries the cache breakpoint (the whole prefix is static). */
export function systemBlocks(): SystemBlock[] {
  cachedSystem ??= [
    { type: 'text', text: `=== SPECIFICATION 1: Video Prompt Writing Guide (T2VA / I2VA / FL2VA / L2VA) ===\n\n${guide('base_guide.md')}` },
    { type: 'text', text: `=== SPECIFICATION 2: Full-Reference Mode Rewrite Output Format Guide ===\n\n${guide('full_reference_guide.md')}` },
    { type: 'text', text: INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
  ];
  return cachedSystem;
}

const MODE_NOTES: Record<Mode, string> = {
  T2VA: 'MODE T2VA — no reference assets. Build the whole timeline from the idea.',
  I2VA:
    'MODE I2VA — the attached first-frame image is {first} and is the video at 0.00 s (it belongs to Shot 1). Establish the style, subjects, composition and scene anchors visible in the image, keep identity, clothing, colours and spatial relationships consistent, then develop forward. Mention it in Shot 1 as <{first}>.',
  FL2VA:
    'MODE FL2VA — {first} is the first frame and {last} is the last frame. Do not repeat two static descriptions; write the motion path that connects them: how poses, objects, composition and light change, converging on {last} at the end of the final shot. Use a single shot unless the user asked for several. Refer to them as "{first}" and "{last}" without angle brackets, as in the guide\'s FL2VA example.',
  L2VA:
    'MODE L2VA — {last} is the final frame and belongs to the last shot. Infer a plausible earlier state from the idea and the image, then describe how characters, objects, camera and scene converge on it. Mention it as <{last}>.',
  REFERENCE:
    'MODE REFERENCE (full-reference). Use the Full-Reference guide. Fill subjects, pictures, videos, audios, summary and shots. Target 350–500 English words across style + shots for generation tasks (video editing may differ).',
};

function describeAsset(a: LabeledAsset): string {
  const bits = [`${a.label}: ${a.kind} "${a.filename}"`, `role = ${ROLE_LABELS[a.role]}`];
  if (a.note.trim()) bits.push(`user note = ${a.note.trim()}`);
  return bits.join('; ');
}

export interface ImageInput {
  assetId: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  base64: string;
  /** True when this is a poster frame of a video, not the asset itself. */
  posterOf?: 'video';
}

export type UserBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: ImageInput['mediaType']; data: string } };

export function buildUserContent(req: EnhanceRequest, assets: LabeledAsset[], mode: Mode, preset: Preset | undefined, images: ImageInput[]): UserBlock[] {
  const blocks: UserBlock[] = [];
  const imageByAsset = new Map(images.map((i) => [i.assetId, i]));

  for (const a of assets) {
    const img = imageByAsset.get(a.id);
    if (img) {
      blocks.push({ type: 'text', text: `${describeAsset(a)}${img.posterOf ? ' (only a poster frame of the video is shown)' : ''} — image follows:` });
      blocks.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } });
    }
  }

  const first = assets.find((a) => a.role === 'first_frame')?.label ?? 'Picture 1';
  const last = assets.find((a) => a.role === 'last_frame')?.label ?? 'Picture 2';
  const lines: string[] = [MODE_NOTES[mode].replaceAll('{first}', first).replaceAll('{last}', last), ''];

  lines.push(`VIDEO: ${req.durationSec} seconds total; aspect ratio ${req.aspectRatio}.`);
  lines.push(
    req.dialogue === 'none'
      ? 'DIALOGUE: none — no speech or singing; write no <d> blocks.'
      : req.dialogue === 'as_written'
        ? 'DIALOGUE: use ONLY the spoken/sung lines the user wrote in the idea. Reproduce every word and punctuation mark exactly, in its original language, inside <d>[Language] …</d>. Do not translate, paraphrase or add lines.'
        : `DIALOGUE: the user wants you to write the lines. Write short natural lines in ${req.dialogueLanguage || 'English'} that fit the scene and duration, each in <d>[${req.dialogueLanguage || 'English'}] …</d>.`,
  );
  lines.push(req.music ? 'MUSIC: include audience-only background music (instrumentation, tempo, dynamics).' : 'MUSIC: non_diegetic_music must be exactly "N/A".');
  if (preset) lines.push(`PRESET "${preset.name}": ${preset.guidance}`);

  if (assets.length) {
    lines.push('', 'ASSETS (labels are fixed):', ...assets.map((a) => `- ${describeAsset(a)}${imageByAsset.has(a.id) ? '' : ' (not shown)'}`));
  }
  lines.push('', '<idea>', req.idea.trim(), '</idea>');
  blocks.push({ type: 'text', text: lines.join('\n') });
  return blocks;
}

/** Follow-up request after validation found problems: a fresh single turn that includes the draft. */
export function buildRepairContent(original: UserBlock[], draftJson: string, issues: LintIssue[]): UserBlock[] {
  const problems = issues.map((i) => `- [${i.severity}] ${i.message}`).join('\n');
  return [
    ...original,
    {
      type: 'text',
      text: `\nA previous draft was checked against the guides and these problems were found:\n${problems}\n\nPrevious draft (JSON):\n${draftJson}\n\nReturn a corrected, complete JSON object that fixes every error and, where reasonable, every warning. Keep what was already good.`,
    },
  ];
}
