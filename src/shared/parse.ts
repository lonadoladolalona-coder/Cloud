import { parseTimecode } from './timecode';
import type { AudioMarker, AudioDef, Mode, PictureDef, PromptDoc, Shot, SubjectDef, VideoDef, VisibleMarker } from './types';
import { AUDIO_MARKERS, VISIBLE_MARKERS, blankDoc } from './types';

export type ParseResult =
  | { ok: true; mode: Mode; doc: PromptDoc; warnings: string[] }
  | { ok: false; error: string };

const REF_HEADERS = ['subject_definitions', 'summary', 'retention_analysis', 'detailed_description', 'overall_soundscape', 'non_diegetic_music'];
const BASE_HEADERS = ['integrated_multimodal_description', 'overall_soundscape', 'non_diegetic_music'];

const STYLE_TOKEN =
  /^(live-action|cinematic|2d-animated|3d cg|claymation|watercolor|vintage film|photorealistic|documentary|anime|stop-motion|hand-drawn|noir|black-and-white|animated|realistic)$/i;

function splitSections(text: string, headers: string[], ownLine: boolean): Record<string, string> {
  const re = new RegExp(`^(${headers.join('|')}):${ownLine ? '[ \\t]*$' : '[ \\t]*'}`, 'gm');
  const hits = [...text.matchAll(re)];
  const out: Record<string, string> = {};
  hits.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < hits.length ? (hits[i + 1]!.index ?? text.length) : text.length;
    out[m[1]!] = text.slice(start, end).trim();
  });
  return out;
}

function parseShots(body: string, warnings: string[]): { lead: string; shots: Shot[] } {
  const chunks = body.split(/(?=\[Shot \d+\])/);
  let lead = '';
  const shots: Shot[] = [];
  for (const chunk of chunks) {
    const m = /^\[Shot (\d+)\]\s*([\s\S]*)$/.exec(chunk);
    if (!m) {
      lead = chunk.trim();
      continue;
    }
    const n = Number(m[1]);
    let rest = m[2]!.trim();
    let startMs = 0;
    if (shots.length > 0) {
      const t = /^At (\d{1,2}:\d{2}(?:\.\d{1,3})?),\s*([\s\S]*)$/.exec(rest);
      if (t) {
        startMs = parseTimecode(t[1]!) ?? 0;
        rest = t[2]!;
      } else {
        startMs = shots[shots.length - 1]!.startMs + 1000;
        warnings.push(`Shot ${n} had no "At MM:SS.mmm," timestamp; set to ${(startMs / 1000).toFixed(1)}s.`);
      }
    }
    shots.push({ startMs, text: rest });
  }
  return { lead, shots };
}

/** Splits "Live-action, cinematic, a medium shot…" into style + body using the guide's style vocabulary. */
function splitLeadingStyle(text: string): { style: string; body: string } {
  const styles: string[] = [];
  let rest = text;
  for (;;) {
    const m = /^([^,]+),\s*([\s\S]*)$/.exec(rest);
    if (!m || !STYLE_TOKEN.test(m[1]!.trim())) break;
    styles.push(m[1]!.trim());
    rest = m[2]!;
  }
  return { style: styles.join(', '), body: rest };
}

const label = (kind: string, n: string) => `${kind} ${n}`;

function parseReference(text: string): ParseResult {
  const warnings: string[] = [];
  const sec = splitSections(text, REF_HEADERS, true);
  if (!sec.detailed_description) return { ok: false, error: 'Missing "detailed_description:" section.' };
  const doc = blankDoc();

  const subjects: SubjectDef[] = [];
  const pictures: PictureDef[] = [];
  const videos: VideoDef[] = [];
  const audios: AudioDef[] = [];
  const subjectNumbers: number[] = [];

  for (const line of (sec.subject_definitions ?? '').split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = /^<(Subject|Picture|Video|Audio) (\d+)>\s*([\s\S]*)$/.exec(line);
    if (!m) {
      warnings.push(`Could not read definition line: ${line.slice(0, 60)}`);
      continue;
    }
    const kind = m[1]!;
    const n = m[2]!;
    const rest = m[3]!;
    if (kind === 'Subject') {
      subjects.push({ text: rest, appearsIn: [], marker: 'fully_preserved', note: '' });
      subjectNumbers.push(Number(n));
    } else if (kind === 'Picture') pictures.push({ label: label(kind, n), text: rest, anchor: '', marker: 'fully_preserved', note: '' });
    else if (kind === 'Video') videos.push({ label: label(kind, n), text: rest, aspect: '', marker: 'fully_preserved', note: '' });
    else audios.push({ label: label(kind, n), text: rest, marker: 'reference', note: '' });
  }

  for (const line of (sec.retention_analysis ?? '').split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = /^<(Subject|Picture|Video|Audio) (\d+)>(?: \(([^)]*)\))?: (\w+) - ([\s\S]*)$/.exec(line);
    if (!m) {
      warnings.push(`Could not read retention line: ${line.slice(0, 60)}`);
      continue;
    }
    const kind = m[1]!;
    const n = m[2]!;
    const paren = m[3];
    const marker = m[4]!;
    const note = m[5]!;
    const target = label(kind, n);
    if (kind === 'Subject') {
      const s = subjects[subjectNumbers.indexOf(Number(n))];
      if (s && VISIBLE_MARKERS.includes(marker as VisibleMarker)) {
        s.marker = marker as VisibleMarker;
        s.note = note;
        s.appearsIn = [...(paren ?? '').matchAll(/\[Shot (\d+)\]/g)].map((x) => Number(x[1]));
      }
    } else if (kind === 'Picture') {
      const p = pictures.find((x) => x.label === target);
      if (p) Object.assign(p, { marker: marker as VisibleMarker, note, anchor: paren ?? '' });
    } else if (kind === 'Video') {
      const v = videos.find((x) => x.label === target);
      if (v) Object.assign(v, { marker: marker as VisibleMarker, note, aspect: paren ?? '' });
    } else {
      const a = audios.find((x) => x.label === target);
      if (a && AUDIO_MARKERS.includes(marker as AudioMarker)) Object.assign(a, { marker: marker as AudioMarker, note });
    }
  }

  const summary = /^\[[^\]]+\]\s*([\s\S]*)$/.exec(sec.summary ?? '');
  doc.summary = (summary ? summary[1]! : (sec.summary ?? '')).replace(/^The target video is an edited version of <Video \d+>\.\s*/, '');

  const { lead, shots } = parseShots(sec.detailed_description, warnings);
  doc.style = lead;
  doc.shots = shots.length ? shots : doc.shots;
  doc.soundscape = sec.overall_soundscape ?? '';
  doc.music = sec.non_diegetic_music ?? '';
  doc.subjects = subjects;
  doc.pictures = pictures;
  doc.videos = videos;
  doc.audios = audios;
  doc.durationSec = Math.max(8, Math.ceil((doc.shots[doc.shots.length - 1]!.startMs + 3000) / 1000));
  return { ok: true, mode: 'REFERENCE', doc, warnings };
}

function parseBase(text: string): ParseResult {
  const warnings: string[] = [];
  const sec = splitSections(text, BASE_HEADERS, false);
  const body = sec.integrated_multimodal_description;
  if (!body) return { ok: false, error: 'Missing "integrated_multimodal_description:" section.' };

  const firstHeader = text.search(/^integrated_multimodal_description:/m);
  const preamble = text.slice(0, Math.max(0, firstHeader)).trim();

  let mode: Mode = 'T2VA';
  let durationSec: number | null = null;
  if (/^For the target video, at 0\.00 seconds/.test(preamble)) mode = 'I2VA';
  else if (/^How the reference pictures align/.test(preamble)) {
    mode = (preamble.match(/Picture \d+ \(from/g) ?? []).length >= 2 ? 'FL2VA' : 'L2VA';
    const secs = [...preamble.matchAll(/(\d+\.\d+)-second mark/g)].pop();
    if (secs) durationSec = Number(secs[1]);
  }

  const { shots } = parseShots(body, warnings);
  if (shots.length === 0) return { ok: false, error: 'No "[Shot 1]" found in the description.' };
  const { style, body: firstBody } = splitLeadingStyle(shots[0]!.text);
  shots[0] = { startMs: 0, text: firstBody };

  const doc = blankDoc();
  doc.style = style;
  doc.shots = shots;
  doc.soundscape = sec.overall_soundscape ?? '';
  doc.music = sec.non_diegetic_music ?? '';
  doc.durationSec = durationSec ?? Math.max(8, Math.ceil((shots[shots.length - 1]!.startMs + 3000) / 1000));
  return { ok: true, mode, doc, warnings };
}

/** Reads a finished prompt (either guide's format) back into the editable structure. */
export function parsePrompt(raw: string): ParseResult {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return { ok: false, error: 'Nothing to import.' };
  if (/^detailed_description:[ \t]*$/m.test(text)) return parseReference(text);
  if (/^integrated_multimodal_description:/m.test(text)) return parseBase(text);
  return { ok: false, error: 'Not recognised: expected an "integrated_multimodal_description:" or "detailed_description:" section.' };
}
