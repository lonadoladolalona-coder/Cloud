import { taskTypes } from './compile';
import type { LabeledAsset, LintIssue, Mode, PromptDoc, Severity } from './types';

const issue = (id: string, severity: Severity, message: string, where?: string): LintIssue => ({ id, severity, message, where });

const DIALOGUE_RE = /<d>([\s\S]*?)<\/d>/g;
const SPEAKER_RE = /\((S\d+(?:\s*,\s*S\d+)*)\)/g;
const LABEL_RE = /\b(Subject|Picture|Video|Audio) (\d+\b|\?)/g;

/** Abstract mood words the guide asks non_diegetic_music to avoid (describe instruments/tempo/dynamics instead). */
const MOOD_WORDS = [
  'sad', 'happy', 'emotional', 'melancholy', 'melancholic', 'uplifting', 'joyful', 'nostalgic', 'haunting',
  'dramatic', 'tense', 'suspenseful', 'romantic', 'hopeful', 'inspiring', 'heartwarming', 'somber', 'mournful', 'epic', 'eerie',
];

export function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function countSentences(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0).length;
}

/** Removes spoken content (<d>…</d>) and quoted on-screen text so language checks only see the description itself. */
function withoutProtectedText(text: string): string {
  return text.replace(DIALOGUE_RE, ' ').replace(/"[^"]*"|“[^”]*”/g, ' ');
}

function nonLatinLetters(text: string): string[] {
  const found = new Set<string>();
  for (const ch of withoutProtectedText(text).match(/\p{L}/gu) ?? []) if (!/\p{Script=Latin}/u.test(ch)) found.add(ch);
  return [...found];
}

interface Scan {
  speakers: string[];
}

export function lint(doc: PromptDoc, assets: LabeledAsset[], mode: Mode): LintIssue[] {
  const out: LintIssue[] = [];
  const reference = mode === 'REFERENCE';
  const durationMs = doc.durationSec * 1000;

  // ---- duration & shots -------------------------------------------------------------------
  if (!(doc.durationSec > 0)) out.push(issue('duration', 'error', 'Duration must be greater than 0 seconds.', 'params'));

  if (doc.shots.length === 0) out.push(issue('shots.none', 'error', 'Add at least one shot.', 'shots'));
  doc.shots.forEach((shot, i) => {
    const where = `shot:${i}`;
    const n = i + 1;
    if (i === 0 && shot.startMs !== 0) out.push(issue('shots.first', 'error', 'Shot 1 must start at 00:00.000 (it carries no timestamp).', where));
    if (i > 0) {
      const prev = doc.shots[i - 1]!;
      if (shot.startMs <= prev.startMs) out.push(issue('shots.order', 'error', `Shot ${n} must start after Shot ${i}.`, where));
      if (durationMs > 0 && shot.startMs >= durationMs) out.push(issue('shots.range', 'error', `Shot ${n} starts at or after the end of the video (${doc.durationSec}s).`, where));
    }
    if (!shot.text.trim()) out.push(issue('shots.empty', 'error', `Shot ${n} is empty.`, where));
    if (/\[Shot\s+\d+\]|^\s*At\s+\d{1,2}:\d{2}/i.test(shot.text)) {
      out.push(issue('shots.markers', 'warning', `Shot ${n}: don't type "[Shot N]" or "At MM:SS.mmm," — they are added for you.`, where));
    }
    if (i > 0 && shot.text.trim() && !/\b(cuts?|transitions?|changes?|switch(?:es)?|dissolve|fade|wipe)\b/i.test(shot.text.slice(0, 90))) {
      out.push(issue('shots.cutwording', 'info', `Shot ${n}: open with cut wording such as "the camera cuts to…" or "the shot transitions to…".`, where));
    }
    if (/\b(?:camera\s*(?:movement|motion)?)\s*:\s*\w/i.test(shot.text) || /\[(?:pan|tilt|zoom|push|pull|truck|pedestal|arc|tracking)[^\]]*\]/i.test(shot.text)) {
      out.push(issue('shots.cameralabel', 'warning', `Shot ${n}: write camera motion as a natural sentence ("The camera pushes in with small amplitude at slow speed…"), not as a label.`, where));
    }
  });
  if ((mode === 'FL2VA' || mode === 'L2VA') && doc.shots.length > 1) {
    out.push(issue('shots.single', 'info', `${mode} works best with a single shot so the model can interpolate continuously; use more only when you need them.`, 'shots'));
  }

  // ---- style -------------------------------------------------------------------------------
  if (!doc.style.trim()) {
    out.push(issue('style.empty', 'warning', reference ? 'Add a one–two sentence style opening before [Shot 1].' : 'Add a visual style for Shot 1 (e.g. "Live-action, cinematic").', 'style'));
  } else if (reference && countSentences(doc.style) > 2) {
    out.push(issue('style.long', 'warning', 'Keep the style opening to one or two sentences.', 'style'));
  }

  // ---- soundscape & music --------------------------------------------------------------------
  const sound = doc.soundscape.trim();
  if (!sound) out.push(issue('soundscape.empty', 'error', 'overall_soundscape is empty (write "N/A" only if you want total silence).', 'soundscape'));
  else if (/^n\/a$/i.test(sound)) out.push(issue('soundscape.na', 'info', '"N/A" means complete silence for the whole video — use it only when you want that.', 'soundscape'));
  else if (countSentences(sound) > 4) out.push(issue('soundscape.long', 'warning', 'overall_soundscape should be 1–4 sentences.', 'soundscape'));
  if (/<d>/.test(doc.soundscape) || /<d>/.test(doc.music)) {
    out.push(issue('sound.dialogue', 'error', 'Dialogue belongs only in the shot descriptions — remove <d> from the soundscape/music.', /<d>/.test(doc.soundscape) ? 'soundscape' : 'music'));
  }

  const music = doc.music.trim();
  if (!music) out.push(issue('music.empty', 'error', 'non_diegetic_music is empty (write "N/A" if there is none).', 'music'));
  else if (!/^n\/a$/i.test(music)) {
    if (countSentences(music) > 3) out.push(issue('music.long', 'warning', 'non_diegetic_music should be 1–3 sentences.', 'music'));
    const mood = MOOD_WORDS.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(music));
    if (mood.length) out.push(issue('music.mood', 'warning', `Describe instrumentation, tempo and dynamics instead of mood words (${mood.join(', ')}).`, 'music'));
  }

  // ---- dialogue & speakers --------------------------------------------------------------------
  const scan: Scan = { speakers: [] };
  let scenetrans = 0;
  doc.shots.forEach((shot, i) => {
    const where = `shot:${i}`;
    const n = i + 1;
    const text = shot.text;
    const opens = (text.match(/<d>/g) ?? []).length;
    const closes = (text.match(/<\/d>/g) ?? []).length;
    if (opens !== closes) out.push(issue('dialogue.unclosed', 'error', `Shot ${n}: every <d> needs a matching </d>.`, where));

    for (const m of text.matchAll(DIALOGUE_RE)) {
      const body = m[1] ?? '';
      if (!/^\s*\[[^\]]+\]\s*\S/.test(body)) {
        out.push(issue('dialogue.lang', 'error', `Shot ${n}: dialogue must start with a language tag, e.g. <d>[English] …</d>.`, where));
      }
      const before = text.slice(0, m.index);
      const lastSpeaker = [...before.matchAll(SPEAKER_RE)].pop();
      const hasAudioCue = reference && /<Audio \d+>/.test(before.slice(-200));
      if (!lastSpeaker && !hasAudioCue) {
        out.push(issue('dialogue.speaker', 'warning', `Shot ${n}: name the speaker with an ID like (S1) before the <d> line.`, where));
      }
      if (/off-screen voiceover/i.test(before.slice(-120)) && !/lips\s+(?:remain|stay|are|is)\s+(?:completely\s+)?closed/i.test(text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 120))) {
        out.push(issue('dialogue.voiceover', 'warning', `Shot ${n}: after a voiceover line, state that the character's lips remain closed.`, where));
      }
    }
    scenetrans += (text.match(/<scenetrans>/g) ?? []).length;
    for (const m of text.matchAll(SPEAKER_RE)) for (const id of (m[1] ?? '').split(',')) scan.speakers.push(id.trim());
  });
  if (scenetrans === 1) out.push(issue('dialogue.scenetrans', 'warning', '<scenetrans> must appear at both connecting points of a line that crosses a cut.', 'shots'));

  const seen = new Set<number>();
  let highest = 0;
  for (const id of scan.speakers) {
    const num = Number(id.slice(1));
    if (seen.has(num)) continue;
    if (num !== highest + 1) {
      out.push(issue('speakers.order', 'warning', `Speaker IDs are numbered in order of first speech: ${id} appears before S${highest + 1}.`, 'shots'));
    }
    seen.add(num);
    highest = Math.max(highest, num);
  }

  // ---- language -----------------------------------------------------------------------------
  const prose: Array<[string, string]> = [
    ['style', doc.style],
    ...doc.shots.map((s, i): [string, string] => [`shot:${i}`, s.text]),
    ['soundscape', doc.soundscape],
    ['music', doc.music],
    ['summary', doc.summary],
  ];
  for (const [where, text] of prose) {
    const letters = nonLatinLetters(text);
    if (letters.length) {
      out.push(issue('language', 'warning', `Write descriptions in English; keep other languages only inside <d>…</d> or quoted on-screen text (found: ${letters.slice(0, 4).join(' ')}).`, where));
      break;
    }
  }

  // ---- labels -----------------------------------------------------------------------------
  const count = (kind: LabeledAsset['kind']) => assets.filter((a) => a.kind === kind).length;
  const limits = { Subject: reference ? doc.subjects.length : 0, Picture: count('image'), Video: count('video'), Audio: count('audio') };
  const referenced = new Set<string>();
  const allTexts: Array<[string, string]> = [
    ...prose,
    ...doc.subjects.flatMap((s, i): Array<[string, string]> => [[`subject:${i}`, s.text], [`subject:${i}`, s.note]]),
    ...doc.pictures.flatMap((p): Array<[string, string]> => [['pictures', p.text], ['pictures', p.note], ['pictures', p.anchor]]),
    ...doc.videos.flatMap((v): Array<[string, string]> => [['videos', v.text], ['videos', v.note], ['videos', v.aspect]]),
    ...doc.audios.flatMap((a): Array<[string, string]> => [['audios', a.text], ['audios', a.note]]),
  ];
  const reported = new Set<string>();
  for (const [where, text] of allTexts) {
    for (const m of text.matchAll(LABEL_RE)) {
      const kind = m[1] as keyof typeof limits;
      const num = m[2]!;
      const label = `${kind} ${num}`;
      referenced.add(label);
      if (reported.has(label)) continue;
      if (num === '?' || Number(num) > limits[kind] || Number(num) < 1) {
        reported.add(label);
        const why = num === '?' ? 'its source was removed' : kind === 'Subject' && !reference ? 'Subject labels only exist in full-reference mode' : 'no such item is defined';
        out.push(issue('labels.undefined', 'error', `"${label}" is referenced but ${why}.`, where));
      }
    }
  }

  // A standalone entry carries its label in its own field, and base modes reference the
  // first/last-frame images from the auto-generated alignment line.
  for (const d of [...doc.pictures, ...doc.videos, ...doc.audios]) referenced.add(d.label);
  for (const a of assets) {
    const aligned = !reference && a.kind === 'image';
    if (!aligned && !referenced.has(a.label)) {
      out.push(issue('assets.unused', 'warning', `${a.label} (${a.filename}) is attached but never mentioned in the prompt.`, 'assets'));
    }
  }

  // ---- full-reference specifics --------------------------------------------------------------
  if (reference) lintReference(doc, assets, out);

  return out;
}

function lintReference(doc: PromptDoc, assets: LabeledAsset[], out: LintIssue[]): void {
  if (doc.subjects.length + doc.pictures.length + doc.videos.length + doc.audios.length === 0) {
    out.push(issue('defs.none', 'error', 'Define at least one referenced item (Subject / Picture / Video / Audio) in subject_definitions.', 'subjects'));
  }
  const detailText = [doc.style, ...doc.shots.map((s) => s.text)].join('\n');

  doc.subjects.forEach((s, i) => {
    const where = `subject:${i}`;
    if (!s.text.trim()) out.push(issue('subject.empty', 'error', `Subject ${i + 1} has no definition.`, where));
    if (!s.note.trim()) out.push(issue('subject.note', 'warning', `Subject ${i + 1}: add a retention note (what is kept or changed).`, where));
    if (s.appearsIn.length === 0) out.push(issue('subject.shots', 'warning', `Subject ${i + 1}: list the shots it appears in.`, where));
    if (!new RegExp(`<Subject ${i + 1}>`).test(detailText)) {
      out.push(issue('subject.unused', 'warning', `<Subject ${i + 1}> is defined but never appears in the shot descriptions.`, where));
    }
  });

  const frameRoles = new Set(['first_frame', 'last_frame', 'keyframe', 'edited_keyframe', 'composition_anchor', 'storyboard']);
  for (const a of assets) {
    if (a.kind === 'image' && frameRoles.has(a.role) && !doc.pictures.some((p) => p.label === a.label)) {
      out.push(issue('pictures.missing', 'warning', `${a.label} is used as ${a.role.replace('_', ' ')}: add its <${a.label}> entry.`, 'pictures'));
    }
    if (a.kind === 'video' && a.role !== 'subject' && !doc.videos.some((v) => v.label === a.label)) {
      out.push(issue('videos.missing', 'warning', `${a.label} is a ${a.role.replace('_', ' ')}: add its <${a.label}> entry.`, 'videos'));
    }
    if (a.kind === 'audio' && !doc.audios.some((d) => d.label === a.label)) {
      out.push(issue('audios.missing', 'warning', `${a.label} has no <${a.label}> entry — say whether it is copied or only referenced.`, 'audios'));
    }
  }

  const known = new Set(assets.map((a) => a.label));
  for (const d of [...doc.pictures, ...doc.videos, ...doc.audios]) {
    if (!known.has(d.label)) out.push(issue('defs.orphan', 'error', `${d.label} has an entry but no matching asset is attached.`, d.label.startsWith('Picture') ? 'pictures' : d.label.startsWith('Video') ? 'videos' : 'audios'));
  }

  if (!doc.summary.trim()) out.push(issue('summary.empty', 'error', 'summary is empty.', 'summary'));
  else if (/^\s*\[/.test(doc.summary)) out.push(issue('summary.prefix', 'warning', 'Do not type the [task type] prefix — it is added automatically.', 'summary'));

  const retentionNotes = [...doc.subjects.map((s) => s.note), ...doc.pictures.map((p) => p.note), ...doc.videos.map((v) => v.note), ...doc.audios.map((a) => a.note)];
  if (retentionNotes.some((n) => /\(S\d+(?:\s*,\s*S\d+)*\)/.test(n))) {
    out.push(issue('retention.speaker', 'error', 'Do not write speaker IDs like (S1) in retention notes.', 'subjects'));
  }

  const types = taskTypes(doc, assets);
  if (!types.includes('video editing')) {
    const words = countWords(detailText);
    if (words < 350 || words > 500) {
      out.push(issue('detail.words', 'warning', `The shot descriptions are ${words} words; generation tasks target 350–500 (dialogue-heavy scenes may run longer).`, 'shots'));
    }
  }
}

export function summarizeLint(issues: LintIssue[]): { errors: number; warnings: number; infos: number } {
  return {
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    infos: issues.filter((i) => i.severity === 'info').length,
  };
}
