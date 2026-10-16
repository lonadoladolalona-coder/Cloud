import type { GenParams } from './types';

export type DialogueMode = 'none' | 'as_written' | 'write';

export interface Preset {
  id: string;
  name: string;
  tagline: string;
  /** CSS gradient stops for the card. */
  colors: [string, string];
  /** Starter text dropped into the idea box — bracketed parts are for the user to replace. */
  idea: string;
  /** Craft guidance handed to the rewriter alongside the idea (shot structure, camera habits…). */
  guidance: string;
  dialogue: DialogueMode;
  music: boolean;
  params?: Partial<GenParams>;
  /** Assets this preset needs to make sense, shown as a hint. */
  needs?: string;
}

export const PRESETS: Preset[] = [
  {
    id: 'sitcom',
    name: 'Sitcom exchange',
    tagline: 'Multi-camera dialogue with a laugh-track button',
    colors: ['#ff8a3d', '#ff3d6e'],
    idea: '[Two characters] in [a coffee shop]. [One] [does something small and annoying]; [the other] reacts. Three quick lines, ends on a punchline and an audience laugh.',
    guidance:
      'Realistic multi-camera sitcom: warm even indoor lighting, 3–4 shots, a wide establishing shot first, then close-ups that cut on each line. Each speaker gets a stable ID and a distinct voice description. The punchline lands in the final shot, followed by a canned audience laugh.',
    dialogue: 'write',
    music: false,
    params: { durationSec: 10, aspectRatio: '16:9' },
  },
  {
    id: 'product',
    name: 'Cinematic reveal',
    tagline: 'Slow push-in on a hero product or object',
    colors: ['#38bdf8', '#6366f1'],
    idea: 'A [product] rests on [a dark reflective surface]. Light sweeps across it, revealing [key detail]. Ends on a clean hero frame.',
    guidance:
      'Product-film look: macro and medium shots, controlled studio lighting, shallow depth of field, precise slow camera moves (push in / arc / pedestal) with small amplitude. Describe materials, reflections and light movement concretely. Sound is sparse foley; music is minimal and rhythmic.',
    dialogue: 'none',
    music: true,
    params: { durationSec: 6, aspectRatio: '16:9' },
  },
  {
    id: 'music-video',
    name: 'Music-video performance',
    tagline: 'Performer, rhythm cuts, lyrics on screen time',
    colors: ['#a855f7', '#ec4899'],
    idea: '[Singer] performs [a chorus] on [a rain-lit rooftop at night]. Cuts follow the beat. Lyrics: [paste the exact lyric lines].',
    guidance:
      'Stylised performance video. Cut on the beat (every 1.5–3 s), alternate wide / close-up / insert shots, strong colored practical lighting. Lyrics are sung by one stable speaker ID and must be reproduced exactly as given, in their original language, inside <d>. If a line spans a cut, mark the continuity.',
    dialogue: 'as_written',
    music: true,
    params: { durationSec: 12, aspectRatio: '16:9' },
  },
  {
    id: 'anime',
    name: 'Anime action beat',
    tagline: '2D-animated clash with hard impacts',
    colors: ['#22d3ee', '#f43f5e'],
    idea: '[Hero] faces [rival] on [a collapsing bridge]. One decisive exchange: wind-up, strike, impact, aftermath.',
    guidance:
      '2D-animated, hand-drawn look with speed lines and impact frames. 3–5 short shots, fast cuts at the strike, exaggerated camera moves (fast arc, quick zoom). Sound design carries the action: whooshes, metal ring, debris. Music only if requested.',
    dialogue: 'none',
    music: false,
    params: { durationSec: 8, aspectRatio: '16:9' },
  },
  {
    id: 'horror',
    name: 'Slow-burn horror',
    tagline: 'One quiet, wrong detail in a still room',
    colors: ['#64748b', '#0f172a'],
    idea: '[Someone] [does a mundane thing] in [a dim hallway at night]. Something small is wrong: [detail]. Hold, then reveal.',
    guidance:
      'Photoreal, low-key lighting, long held shots, minimal camera movement (static or very slow push-in). Build dread through specific visible details and sparse physical sound (floorboards, a hum, breath). No jump-cut montage. Music is optional and should be a single sustained texture.',
    dialogue: 'none',
    music: false,
    params: { durationSec: 8, aspectRatio: '16:9' },
  },
  {
    id: 'morph',
    name: 'First → last frame',
    tagline: 'Continuous transformation between two stills',
    colors: ['#b6ff3b', '#14b8a6'],
    idea: 'Transform from the first frame to the last: [what physically changes and how].',
    guidance:
      'Single continuous shot. Describe the physical path between the two frames: how poses, objects, composition and light change step by step, converging on the last frame at the very end.',
    dialogue: 'none',
    music: false,
    params: { durationSec: 6 },
    needs: 'Attach two images: one as First frame, one as Last frame.',
  },
  {
    id: 'asmr',
    name: 'ASMR close-up',
    tagline: 'Macro visuals, sound-led',
    colors: ['#f0abfc', '#fb7185'],
    idea: 'Macro shot of [hands doing a slow tactile task: e.g. slicing, pouring, tapping] on [surface].',
    guidance:
      'Extreme close-ups, shallow depth of field, slow deliberate action, soft diffused light. The overall_soundscape is the star: describe each distinct texture and rhythm in 3–4 sentences. No speech, no music.',
    dialogue: 'none',
    music: false,
    params: { durationSec: 6, aspectRatio: '9:16' },
  },
  {
    id: 'vlog',
    name: 'Talking head',
    tagline: 'Vertical selfie, direct address',
    colors: ['#facc15', '#f97316'],
    idea: '[Presenter] speaks to camera in [a bright room]: "[exact line]"',
    guidance:
      'Handheld selfie framing, vertical, natural window light, slight shake. A single speaker addressing the lens; keep the spoken line exactly as written. Room tone only; no score.',
    dialogue: 'as_written',
    music: false,
    params: { durationSec: 8, aspectRatio: '9:16' },
  },
  {
    id: 'documentary',
    name: 'Documentary vignette',
    tagline: 'Observed moment with voiceover',
    colors: ['#34d399', '#0ea5e9'],
    idea: '[Subject] [working or living in a place]. Quiet observation, then a voiceover line: "[line]"',
    guidance:
      'Observational documentary look: natural light, handheld or tripod, medium and detail shots, real-world ambience. If there is a voiceover, use the exact voiceover phrasing from the guide and state that the on-screen person\'s lips stay closed.',
    dialogue: 'as_written',
    music: true,
    params: { durationSec: 10 },
  },
];

export const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
export const RESOLUTIONS = ['768p', '720p', '1080p'];
