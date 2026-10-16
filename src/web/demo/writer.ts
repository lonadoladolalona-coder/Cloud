import type { EnhanceRequest } from '../../shared/api';
import { PRESETS } from '../../shared/presets';
import { ROLE_LABELS, blankDoc, type AudioDef, type LabeledAsset, type Mode, type PictureDef, type PromptDoc, type SubjectDef, type VideoDef } from '../../shared/types';

/**
 * Template-based stand-in for the Claude rewriter, used only by the offline demo. It turns a rough idea into a
 * guide-shaped document (shots, camera wording, speakers, soundscape, retention entries) so the editor, checker
 * and compiler can be tried without an API key. Real prompts come from Claude.
 */

interface Flavor {
  style: string;
  referenceStyle: string;
  sound: string;
  music: string;
  lines: string[];
}

const FLAVORS: Record<string, Flavor> = {
  sitcom: {
    style: 'Live-action, multi-camera sitcom',
    referenceStyle: 'The target video uses a realistic multi-camera sitcom style with warm, even indoor lighting.',
    sound: 'Soft cafe ambience with cups clinking and a low murmur of background chatter, followed by a short burst of recorded audience laughter at the punchline.',
    music: 'A light pizzicato string and upright bass groove at a medium tempo, played quietly under the opening and fading out before the final line.',
    lines: ['Did you just drink my coffee?', 'It was unattended. That makes it community coffee.'],
  },
  product: {
    style: 'Cinematic, live-action, shallow depth of field',
    referenceStyle: 'The target video uses a cinematic product-film style with controlled studio lighting and glossy reflections.',
    sound: 'A faint electrical hum under a smooth, airy whoosh as the light sweeps across the surface, with a soft metallic tick when the final frame settles.',
    music: 'A slow pulsing synthesizer bass with sparse piano notes and a long reverb tail, gradually rising in volume until the final frame.',
    lines: [],
  },
  'music-video': {
    style: 'Live-action, stylized music video',
    referenceStyle: 'The target video uses a stylized music-video look with saturated colors and rhythmic cutting.',
    sound: 'Crowd energy and footsteps on a stage floor, with microphone handling noise between phrases.',
    music: 'A four-on-the-floor drum machine at a fast tempo with a driving bass synthesizer and bright claps, constant in volume.',
    lines: ['Hold on to the night.', 'We are not coming down.'],
  },
  anime: {
    style: '2D anime, cel-shaded, painterly backgrounds',
    referenceStyle: 'The target video uses a 2D anime style with cel shading and soft painterly backgrounds.',
    sound: 'Wind moving through grass with distant cicadas, and the quiet rustle of fabric as the character moves.',
    music: 'A gentle solo piano with a soft string pad at a slow tempo, low in volume and steady.',
    lines: ['I will see you at the festival.'],
  },
  horror: {
    style: 'Live-action, horror, low-key lighting',
    referenceStyle: 'The target video uses a live-action horror style with low-key lighting and deep shadows.',
    sound: 'A faint floorboard creak, the slow drip of water somewhere off-screen and a held breath that cuts abruptly into silence.',
    music: 'A single sustained low cello note with sparse high violin harmonics, very quiet and slowly swelling.',
    lines: ['Did you hear that?'],
  },
  morph: {
    style: 'Live-action, seamless morph transition',
    referenceStyle: 'The target video uses a live-action style with smooth, continuous morph transitions.',
    sound: 'A rising airy whoosh that blends into soft fabric movement, ending on a clear single chime.',
    music: 'A shimmering harp glissando over a warm synthesizer pad at a slow tempo, steady in volume.',
    lines: [],
  },
  asmr: {
    style: 'Live-action, close-up ASMR',
    referenceStyle: 'The target video uses a macro close-up ASMR style with soft diffuse lighting.',
    sound: 'Close-miked, crisp tapping and slow brushing sounds with a quiet room tone, each texture clearly separated.',
    music: 'N/A',
    lines: [],
  },
  vlog: {
    style: 'Live-action, handheld vlog',
    referenceStyle: 'The target video uses a handheld vlog style with natural daylight and a slightly wide selfie lens.',
    sound: 'Street ambience with passing cars and footsteps, and light wind across the microphone.',
    music: 'N/A',
    lines: ['Okay, we made it. Look at this view.'],
  },
  documentary: {
    style: 'Live-action, documentary, natural light',
    referenceStyle: 'The target video uses a documentary style with natural light and unobtrusive, observational framing.',
    sound: 'Natural location ambience with distant voices, gentle wind and the soft sounds of hands at work.',
    music: 'A sparse acoustic guitar with a low, warm cello drone at a slow tempo, quiet and steady.',
    lines: [],
  },
};
const DEFAULT_FLAVOR: Flavor = {
  style: 'Live-action, cinematic',
  referenceStyle: 'The target video uses a realistic cinematic style with soft, natural lighting.',
  sound: 'Quiet room tone with subtle cloth rustles, small object contacts and soft footsteps matching the action on screen.',
  music: 'A slow acoustic guitar with a soft string pad, gentle in volume and steady in tempo.',
  lines: ['Here we go.'],
};

const CAMERA = [
  'The camera pushes in with small amplitude at slow speed.',
  'The camera trucks right with small amplitude at slow speed.',
  'The camera holds a steady frame.',
  'The camera tilts up slowly.',
];
const SHOT_TYPES = ['a close-up', 'a low-angle shot', 'an over-the-shoulder view'];
const CONTINUE = ['while {c}', 'as the action reaches its peak', 'as the moment resolves'];
const asClause = (c: string) => (/^(ends?|ending|finishes|fades|holds|cuts)\b/i.test(c) ? `the scene ${c}` : c);
const VOICES = ['calm, slightly husky voice', 'bright, quick voice', 'deep, measured voice'];
const FILLER = [
  'Soft key light shapes the faces and surfaces while a gentle falloff keeps the background quiet and slightly out of focus.',
  'Fine details stay legible throughout: the weave of the fabric, the grain of the wood and the small highlights on glass and metal.',
  'Movement stays natural and unhurried, with weight shifting from one foot to the other and hands settling on nearby objects.',
  'Colors remain consistent from frame to frame, with warm skin tones set against slightly cooler shadows.',
  'Depth is built in layers, with a sharp foreground element, the main action in the midground and softly blurred shapes behind it.',
  'Small environmental motion keeps the frame alive, such as drifting dust, a flickering reflection or fabric moving in a light draft.',
  'Expressions change gradually, with a glance, a short breath and a subtle shift in posture marking each beat of the action.',
  'The composition keeps the main subject on a strong third, leaving breathing room in the direction they look or move.',
];

const lowerFirst = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);
const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

function quotedLines(idea: string): string[] {
  return [...idea.matchAll(/["“]([^"”]{2,200})["”]/g)].map((m) => m[1]!.trim());
}

function clausesOf(idea: string): string[] {
  const cleaned = idea.replace(/[\[\]]/g, '').replace(/["“][^"”]*["”]/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = cleaned
    .split(/(?<=[.!?])\s+|;\s*|\s+then\s+/i)
    .map((p) => p.replace(/[.!?]+$/, '').replace(/\s+(and\s+)?(says?|said|shouts?|whispers?|sings?)\s*:?$/i, '').trim())
    .filter((p) => p.length > 3);
  return (parts.length ? parts : ['a quiet scene unfolds']).map(lowerFirst);
}

function shotTimes(durationSec: number, count: number): number[] {
  const step = durationSec / count;
  return Array.from({ length: count }, (_, i) => (i === 0 ? 0 : Math.round((step * i * 1000) / 500) * 500));
}

export function writeDoc(req: EnhanceRequest, assets: LabeledAsset[], mode: Mode): PromptDoc {
  const flavor = FLAVORS[req.presetId ?? ''] ?? DEFAULT_FLAVOR;
  const preset = PRESETS.find((p) => p.id === req.presetId);
  const reference = mode === 'REFERENCE';
  const duration = req.durationSec;
  const doc = blankDoc(duration);
  const count = duration <= 6 ? 2 : duration <= 10 ? 3 : 4;
  const clauses = clausesOf(req.idea);

  // dialogue to place, in order
  const given = quotedLines(req.idea);
  const spoken = req.dialogue === 'none' ? [] : given.length > 0 ? given : req.dialogue === 'write' ? flavor.lines : [];
  const lang = req.dialogueLanguage.trim() || 'English';

  const images = assets.filter((a) => a.kind === 'image');
  const first = images.find((a) => a.role === 'first_frame');
  const last = images.find((a) => a.role === 'last_frame');
  const subjectAssets = reference ? assets.filter((a) => (a.kind === 'image' || a.kind === 'video') && a.role === 'subject') : [];
  const subjectRef = (i: number) => `<Subject ${i + 1}>`;

  const times = shotTimes(duration, count);
  const introduced = new Set<number>();
  doc.shots = times.map((startMs, i) => {
    const own = clauses[i];
    let text: string;
    if (i === 0) {
      const subject = reference && subjectAssets.length > 0 ? subjectAssets.map((_, k) => subjectRef(k)).join(' and ') : !reference && first ? `the scene shown in <${first.label}>` : 'the scene';
      text = `a medium-wide shot frames ${subject} as ${asClause(clauses[0]!)}`;
    } else {
      const tail = own ? `as ${asClause(own)}` : CONTINUE[(i - clauses.length) % CONTINUE.length]!.replace('{c}', asClause(clauses[0]!));
      text = `the camera cuts to ${SHOT_TYPES[(i - 1) % SHOT_TYPES.length]} ${tail}`;
    }
    if (i === count - 1 && !reference && last) text += `, settling into the composition shown in <${last.label}>`;
    text += `. ${CAMERA[i % CAMERA.length]}`;

    const line = spoken[i];
    if (line !== undefined) {
      const who = (i % 2) + 1; // numbered by first speech: the first speaker is S1, a reply is S2
      const voice = VOICES[(who - 1) % VOICES.length]!;
      const intro = !introduced.has(who);
      introduced.add(who);
      if (reference && subjectAssets.length > 0) text += ` ${subjectRef(Math.min(who - 1, subjectAssets.length - 1))} (S${who}) speaks in a ${voice}: <d>[${lang}] ${line}</d>`;
      else if (intro) text += ` The person on screen with a ${voice} (S${who}) says: <d>[${lang}] ${line}</d>`;
      else text += ` (S${who}) replies: <d>[${lang}] ${line}</d>`;
    }
    return { startMs, text };
  });

  doc.soundscape = flavor.sound;
  doc.music = req.music ? flavor.music : 'N/A';

  if (!reference) {
    doc.style = flavor.style;
    return doc;
  }

  // ---- full-reference entries -----------------------------------------------------------------
  doc.style = flavor.referenceStyle;
  let subjectIndex = 0;
  const subjects: SubjectDef[] = [];
  const pictures: PictureDef[] = [];
  const videos: VideoDef[] = [];
  const audios: AudioDef[] = [];
  const everyShot = doc.shots.map((_, i) => i + 1);
  for (const a of assets) {
    const what = a.note.trim() || (a.kind === 'video' ? 'subject' : 'person or object');
    if (subjectAssets.includes(a)) {
      subjects.push({ text: `is the ${what} shown in <${a.label}>.`, appearsIn: everyShot, marker: 'fully_preserved', note: 'identity, outfit and overall look are carried over unchanged' });
      subjectIndex++;
    } else if (a.kind === 'image') {
      const frame = a.role === 'last_frame' ? `[Shot ${count}] last frame` : a.role === 'first_frame' ? '[Shot 1] first frame' : `[Shot 1] ${ROLE_LABELS[a.role].toLowerCase()}`;
      pictures.push({ label: a.label, text: `is the ${ROLE_LABELS[a.role].toLowerCase()} for the target video.`, anchor: frame, marker: 'fully_preserved', note: 'composition and lighting follow the image' });
    } else if (a.kind === 'video') {
      const spec = { edit_source: ['is the source video for the editing task.', 'source video editing', 'fully_preserved', 'original framing and lighting are maintained'], continuation_source: ['is the video the target continues from.', 'continuation start', 'fully_preserved', 'the last moments are continued without a visible seam'], structure_reference: ['provides the cut and pacing structure.', 'cut and pacing structure', 'weak_reference', 'only the rhythm of the cuts is followed'] }[a.role as 'edit_source'] ?? ['is a reference video.', 'reference', 'weak_reference', 'used loosely as inspiration'];
      videos.push({ label: a.label, text: spec[0]!, aspect: spec[1]!, marker: spec[2] as VideoDef['marker'], note: spec[3]! });
    } else {
      const copy = a.role === 'audio_copy';
      audios.push({ label: a.label, text: copy ? 'is reused as the soundtrack of the target video.' : 'is the timbre and rhythm reference for the target audio.', marker: copy ? 'partially_copy' : 'reference', note: copy ? 'played beneath the new sounds' : 'only its character is followed' });
    }
  }
  doc.subjects = subjects;
  doc.pictures = pictures;
  doc.videos = videos;
  doc.audios = audios;
  doc.summary = `${subjectAssets.length > 0 ? subjectAssets.map((_, k) => subjectRef(k)).join(' and ') : 'The scene'} appears in a short sequence where ${clauses[0]}${preset ? `, in the spirit of a ${preset.name.toLowerCase()}` : ''}. ${assets.length > 0 ? `The attached ${assets.map((a) => `<${a.label}>`).join(', ')} guide${assets.length === 1 ? 's' : ''} how the target video looks and sounds.` : ''}`.trim();

  // Generation tasks target 350–500 words of description; pad with plain production detail until it fits.
  const total = () => words([doc.style, ...doc.shots.map((s) => s.text)].join(' '));
  for (let i = 0; total() < 360 && i < 40; i++) {
    const shot = doc.shots[i % doc.shots.length]!;
    shot.text += ` ${FILLER[i % FILLER.length]}`;
  }
  void subjectIndex;
  return doc;
}
