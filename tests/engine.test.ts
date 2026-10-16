import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  alignmentInstruction,
  blankDoc,
  compile,
  deriveMode,
  formatTimecode,
  labelAssets,
  lint,
  parsePrompt,
  parseTimecode,
  reconcileAssets,
  removeSubject,
  taskTypes,
  type AssetRef,
  type Mode,
  type PromptDoc,
} from '../src/shared';

const baseGuide = readFileSync('src/server/guides/base_guide.md', 'utf8');
const fullGuide = readFileSync('src/server/guides/full_reference_guide.md', 'utf8');

const asset = (id: string, kind: AssetRef['kind'], role: AssetRef['role']): AssetRef => ({ id, kind, role, filename: `${id}.bin`, note: '' });

/** The guides' worked examples, extracted verbatim from the vendored guide files. */
function baseExamples(): string[] {
  return [...baseGuide.matchAll(/### Case \d: [^\n]*\n[\s\S]*?```text\n([\s\S]*?)\n```/g)].map((m) => m[1]!);
}
function referenceExample(): string {
  return /Show the complete example<\/summary>\s*```text\n([\s\S]*?)\n```/.exec(fullGuide)![1]!;
}

const CASES: Array<{ name: string; mode: Mode; assets: AssetRef[] }> = [
  { name: 'T2VA', mode: 'T2VA', assets: [] },
  { name: 'I2VA', mode: 'I2VA', assets: [asset('a', 'image', 'first_frame')] },
  { name: 'FL2VA', mode: 'FL2VA', assets: [asset('a', 'image', 'first_frame'), asset('b', 'image', 'last_frame')] },
  { name: 'L2VA', mode: 'L2VA', assets: [asset('a', 'image', 'last_frame')] },
];

describe('golden: the guides\' own worked examples', () => {
  const examples = baseExamples();

  it('extracts all four base cases and the full-reference example', () => {
    expect(examples).toHaveLength(4);
    expect(referenceExample()).toContain('subject_definitions:');
  });

  CASES.forEach((c, i) => {
    it(`${c.name}: parse → compile reproduces the guide example byte-for-byte`, () => {
      const example = examples[i]!;
      const parsed = parsePrompt(example);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.mode).toBe(c.mode);
      expect(deriveMode(c.assets)).toBe(c.mode);
      expect(compile(parsed.doc, labelAssets(c.assets), c.mode)).toBe(example);
    });

    it(`${c.name}: the guide example has no lint errors`, () => {
      const parsed = parsePrompt(examples[i]!);
      if (!parsed.ok) throw new Error(parsed.error);
      const errors = lint(parsed.doc, labelAssets(c.assets), c.mode).filter((x) => x.severity === 'error');
      expect(errors).toEqual([]);
    });
  });

  it('REFERENCE: parse → compile reproduces the complete example byte-for-byte', () => {
    const example = referenceExample();
    const assets = [
      ...[1, 2, 3, 4].map((n) => asset(`p${n}`, 'image', 'subject')),
      ...[1, 2].map((n) => asset(`v${n}`, 'video', 'subject')),
      asset('a1', 'audio', 'audio_reference'),
    ];
    const parsed = parsePrompt(example);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.mode).toBe('REFERENCE');
    expect(parsed.warnings).toEqual([]);
    expect(compile(parsed.doc, labelAssets(assets), 'REFERENCE')).toBe(example);
    expect(lint(parsed.doc, labelAssets(assets), 'REFERENCE').filter((x) => x.severity === 'error')).toEqual([]);
  });
});

describe('timecode', () => {
  it('formats and parses the MM:SS.mmm form', () => {
    expect(formatTimecode(3500)).toBe('00:03.500');
    expect(formatTimecode(65_250)).toBe('01:05.250');
    expect(parseTimecode('00:03.500')).toBe(3500);
    expect(parseTimecode('1:05')).toBe(65_000);
    expect(parseTimecode('3.5')).toBe(3500);
    expect(parseTimecode('0:75')).toBeNull();
    expect(parseTimecode('abc')).toBeNull();
  });
});

describe('asset labels and mode', () => {
  it('numbers per kind and puts the first-frame image first, last-frame image last', () => {
    const labeled = labelAssets([
      asset('last', 'image', 'last_frame'),
      asset('mid', 'image', 'subject'),
      asset('aud', 'audio', 'audio_reference'),
      asset('first', 'image', 'first_frame'),
      asset('vid', 'video', 'subject'),
    ]);
    const byId = Object.fromEntries(labeled.map((a) => [a.id, a.label]));
    expect(byId).toEqual({ first: 'Picture 1', mid: 'Picture 2', last: 'Picture 3', vid: 'Video 1', aud: 'Audio 1' });
  });

  it('derives the mode from roles', () => {
    expect(deriveMode([])).toBe('T2VA');
    expect(deriveMode([asset('a', 'image', 'subject')])).toBe('REFERENCE');
    expect(deriveMode([asset('a', 'video', 'edit_source')])).toBe('REFERENCE');
    expect(deriveMode([asset('a', 'image', 'first_frame'), asset('b', 'image', 'first_frame')])).toBe('REFERENCE');
    expect(deriveMode([asset('a', 'image', 'first_frame'), asset('b', 'audio', 'audio_copy')])).toBe('REFERENCE');
  });

  it('renumbers label references in the text when assets change', () => {
    const before = labelAssets([asset('x', 'image', 'subject'), asset('y', 'image', 'subject'), asset('z', 'image', 'subject')]);
    const doc: PromptDoc = {
      ...blankDoc(),
      shots: [{ startMs: 0, text: 'A shot of <Picture 3> and <Picture 1>.' }],
      pictures: [{ label: 'Picture 3', text: 'is z', anchor: '', marker: 'fully_preserved', note: '' }],
    };
    // delete the middle asset: z becomes Picture 2
    const afterDelete = reconcileAssets(doc, before, [before[0]!, before[2]!]);
    expect(afterDelete.doc.shots[0]!.text).toBe('A shot of <Picture 2> and <Picture 1>.');
    expect(afterDelete.doc.pictures[0]!.label).toBe('Picture 2');
    // delete the asset the text points at: reference becomes visibly broken and the entry is dropped
    const afterRemoveZ = reconcileAssets(doc, before, [before[0]!, before[1]!]);
    expect(afterRemoveZ.doc.shots[0]!.text).toBe('A shot of <Picture ?> and <Picture 1>.');
    expect(afterRemoveZ.doc.pictures).toHaveLength(0);
  });

  it('swapping two numbers does not collide', () => {
    const before = labelAssets([asset('a', 'image', 'subject'), asset('b', 'image', 'subject')]);
    const doc: PromptDoc = { ...blankDoc(), shots: [{ startMs: 0, text: '<Picture 1> then <Picture 2>' }] };
    // making b the first frame sorts it to Picture 1
    const next = reconcileAssets(doc, before, [before[0]!, { ...before[1]!, role: 'first_frame' }]);
    expect(next.assets.map((a) => [a.id, a.label])).toEqual([['b', 'Picture 1'], ['a', 'Picture 2']]);
    expect(next.doc.shots[0]!.text).toBe('<Picture 2> then <Picture 1>');
  });

  it('removing a subject shifts later subject numbers down', () => {
    const doc: PromptDoc = {
      ...blankDoc(),
      shots: [{ startMs: 0, text: '<Subject 1> meets <Subject 2> and <Subject 3>.' }],
      subjects: ['a', 'b', 'c'].map((t) => ({ text: t, appearsIn: [1], marker: 'fully_preserved' as const, note: 'n' })),
    };
    const next = removeSubject(doc, 1);
    expect(next.subjects.map((s) => s.text)).toEqual(['a', 'c']);
    expect(next.shots[0]!.text).toBe('<Subject 1> meets <Subject ?> and <Subject 2>.');
  });
});

describe('alignment instructions', () => {
  const doc = { ...blankDoc(6), shots: [{ startMs: 0, text: 'x' }, { startMs: 3000, text: 'y' }] };
  it('uses the exact wording per variant, with the final shot index and two-decimal duration', () => {
    const fl = labelAssets(CASES[2]!.assets);
    expect(alignmentInstruction('FL2VA', doc, fl)).toBe(
      'How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 2) aligns with the 6.00-second mark of the target video.',
    );
    expect(alignmentInstruction('L2VA', doc, labelAssets(CASES[3]!.assets))).toBe(
      'How the reference pictures align with the target video — <Picture 1> (from [Shot 2]) aligns with the 6.00-second mark of the target video.',
    );
    expect(alignmentInstruction('I2VA', doc, labelAssets(CASES[1]!.assets))).toBe(
      'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.',
    );
    expect(alignmentInstruction('T2VA', doc, [])).toBeNull();
  });
});

describe('summary task types', () => {
  const doc = blankDoc();
  it('derives combined task types from asset roles', () => {
    expect(taskTypes(doc, labelAssets([asset('v', 'video', 'edit_source'), asset('s', 'image', 'subject'), asset('a', 'audio', 'audio_copy')]))).toEqual([
      'video editing',
      'reference generation',
      'audio reuse',
    ]);
    expect(taskTypes(doc, labelAssets([asset('v', 'video', 'continuation_source'), asset('p', 'image', 'last_frame')]))).toEqual([
      'video continuation',
      'keyframe completion',
    ]);
    expect(taskTypes(doc, labelAssets([asset('s', 'image', 'subject'), asset('a', 'audio', 'audio_reference')]))).toEqual([
      'reference generation',
      'audio reference',
    ]);
  });

  it('adds the "edited version" sentence when editing a source video', () => {
    const assets = labelAssets([asset('v', 'video', 'edit_source')]);
    const d: PromptDoc = { ...blankDoc(), summary: 'The woman now wears a red coat.', shots: [{ startMs: 0, text: 'x' }] };
    expect(compile(d, assets, 'REFERENCE')).toContain('summary:\n[video editing] The target video is an edited version of <Video 1>. The woman now wears a red coat.');
  });
});

describe('lint', () => {
  const ids = (doc: PromptDoc, assets: AssetRef[], mode: Mode) => lint(doc, labelAssets(assets), mode).map((i) => i.id);
  const ok = (over: Partial<PromptDoc> = {}): PromptDoc => ({
    ...blankDoc(8),
    style: 'Live-action, cinematic',
    shots: [{ startMs: 0, text: 'a wide shot of a kitchen. The woman (S1) says: <d>[English] Hello.</d>' }],
    soundscape: 'A kettle hums.',
    music: 'N/A',
    ...over,
  });

  it('accepts a clean base prompt', () => {
    expect(ids(ok(), [], 'T2VA').filter((i) => !i.startsWith('shots.cutwording'))).toEqual([]);
  });

  it('flags shot timing problems', () => {
    const doc = ok({ shots: [{ startMs: 500, text: 'a' }, { startMs: 400, text: 'b' }, { startMs: 9000, text: 'c' }, { startMs: 9500, text: '' }] });
    const found = ids(doc, [], 'T2VA');
    expect(found).toContain('shots.first');
    expect(found).toContain('shots.order');
    expect(found).toContain('shots.range');
    expect(found).toContain('shots.empty');
  });

  it('checks dialogue tags, speakers and ID order', () => {
    const noLang = ok({ shots: [{ startMs: 0, text: 'The man (S1) says: <d>Hello there.</d>' }] });
    expect(ids(noLang, [], 'T2VA')).toContain('dialogue.lang');
    const noSpeaker = ok({ shots: [{ startMs: 0, text: 'Someone says: <d>[English] Hello.</d>' }] });
    expect(ids(noSpeaker, [], 'T2VA')).toContain('dialogue.speaker');
    const order = ok({ shots: [{ startMs: 0, text: 'He (S2) says: <d>[English] Hi.</d> She (S1) says: <d>[English] Hey.</d>' }] });
    expect(ids(order, [], 'T2VA')).toContain('speakers.order');
    const unclosed = ok({ shots: [{ startMs: 0, text: 'He (S1) says: <d>[English] Hi.' }] });
    expect(ids(unclosed, [], 'T2VA')).toContain('dialogue.unclosed');
  });

  it('requires lips-closed wording after a voiceover line', () => {
    const vo = ok({ shots: [{ startMs: 0, text: 'The man (S1) says in an off-screen voiceover: <d>[English] I remember.</d> and walks on.' }] });
    expect(ids(vo, [], 'T2VA')).toContain('dialogue.voiceover');
    const good = ok({ shots: [{ startMs: 0, text: 'The man (S1) says in an off-screen voiceover: <d>[English] I remember.</d> while his lips remain completely closed.' }] });
    expect(ids(good, [], 'T2VA')).not.toContain('dialogue.voiceover');
  });

  it('checks sound sections', () => {
    expect(ids(ok({ soundscape: '' }), [], 'T2VA')).toContain('soundscape.empty');
    expect(ids(ok({ soundscape: 'One. Two. Three. Four. Five.' }), [], 'T2VA')).toContain('soundscape.long');
    expect(ids(ok({ soundscape: 'He says <d>[English] hi</d>.' }), [], 'T2VA')).toContain('sound.dialogue');
    expect(ids(ok({ music: 'A sad, emotional piano melody.' }), [], 'T2VA')).toContain('music.mood');
    expect(ids(ok({ music: 'Sparse piano at a slow tempo.' }), [], 'T2VA')).not.toContain('music.mood');
  });

  it('warns about non-English description text but allows it inside <d> and quotes', () => {
    expect(ids(ok({ style: 'Live-action 电影' }), [], 'T2VA')).toContain('language');
    const fine = ok({ shots: [{ startMs: 0, text: 'A sign reading "营业中" glows. The man (S1) says: <d>[Chinese] 你好。</d>' }] });
    expect(ids(fine, [], 'T2VA')).not.toContain('language');
  });

  it('flags labels that are undefined or whose source was removed', () => {
    expect(ids(ok({ shots: [{ startMs: 0, text: 'shows <Picture 2>' }] }), [asset('a', 'image', 'first_frame')], 'I2VA')).toContain('labels.undefined');
    expect(ids(ok({ shots: [{ startMs: 0, text: 'shows <Picture ?>' }] }), [], 'T2VA')).toContain('labels.undefined');
    expect(ids(ok({ shots: [{ startMs: 0, text: 'shows <Subject 1>' }] }), [], 'T2VA')).toContain('labels.undefined');
  });

  it('full-reference: demands entries, notes, no speaker IDs in retention, valid summary', () => {
    const assets = [asset('p', 'image', 'first_frame'), asset('a', 'audio', 'audio_reference')];
    const doc: PromptDoc = {
      ...ok(),
      shots: [{ startMs: 0, text: 'A shot with <Subject 1> in <Picture 1>.' }],
      summary: '[reference generation] already prefixed',
      subjects: [{ text: 'is a woman', appearsIn: [], marker: 'fully_preserved', note: 'kept (S1)' }],
    };
    const found = ids(doc, assets, 'REFERENCE');
    expect(found).toContain('pictures.missing');
    expect(found).toContain('audios.missing');
    expect(found).toContain('subject.shots');
    expect(found).toContain('retention.speaker');
    expect(found).toContain('summary.prefix');
    expect(found).toContain('detail.words');
  });
});
