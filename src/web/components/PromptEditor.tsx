import { useRef, useState } from 'react';
import { countWords } from '../../shared/lint';
import { formatTimecode, parseTimecode } from '../../shared/timecode';
import {
  AUDIO_MARKERS,
  VISIBLE_MARKERS,
  type AudioDef,
  type AudioMarker,
  type LabeledAsset,
  type LintIssue,
  type Mode,
  type PictureDef,
  type PromptDoc,
  type Shot,
  type SubjectDef,
  type VideoDef,
  type VisibleMarker,
} from '../../shared/types';
import { removeSubject } from '../../shared/labels';
import { Icon } from '../ui';

const CAMERA_PHRASES = [
  'The camera pushes in with small amplitude at slow speed',
  'The camera pulls out with small amplitude at slow speed',
  'The camera pans left with large amplitude at fast speed',
  'The camera pans right with small amplitude at slow speed',
  'The camera tilts up with small amplitude at slow speed',
  'The camera tilts down with small amplitude at slow speed',
  'The camera trucks right with small amplitude at slow speed',
  'The camera trucks left with small amplitude at slow speed',
  'The camera pedestals up at slow speed',
  'The camera arcs around the subject at slow speed',
  'The camera tracks the subject as it moves',
  'The camera holds a static shot',
  'The camera shakes slightly',
  'The camera zooms in with small amplitude at slow speed',
  'The camera rolls clockwise with small amplitude at slow speed',
];

interface Props {
  doc: PromptDoc;
  mode: Mode;
  assets: LabeledAsset[];
  issues: LintIssue[];
  onChange: (doc: PromptDoc) => void;
}

const has = (issues: LintIssue[], where: string) => issues.some((i) => i.severity === 'error' && (i.where === where || i.where?.startsWith(`${where}:`)));
const warns = (issues: LintIssue[], where: string) => issues.some((i) => i.severity === 'warning' && i.where === where);
const cls = (issues: LintIssue[], where: string) => (has(issues, where) ? 'is-error' : warns(issues, where) ? 'is-warn' : '');

function TimeInput({ ms, onCommit, disabled }: { ms: number; onCommit: (ms: number) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && parseTimecode(draft) === null;
  return (
    <input
      className={`time ${invalid ? 'is-error' : ''}`}
      value={draft ?? formatTimecode(ms)}
      disabled={disabled}
      aria-label="Shot start time"
      inputMode="decimal"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const parsed = draft === null ? null : parseTimecode(draft);
        if (parsed !== null) onCommit(parsed);
        setDraft(null);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function ShotCard({ index, shot, total, labels, issues, onChange, onDelete }: {
  index: number;
  shot: Shot;
  total: number;
  labels: string[];
  issues: LintIssue[];
  onChange: (s: Shot) => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (snippet: string, cursorBack = 0) => {
    const ta = ref.current;
    const start = ta?.selectionStart ?? shot.text.length;
    const end = ta?.selectionEnd ?? shot.text.length;
    onChange({ ...shot, text: shot.text.slice(0, start) + snippet + shot.text.slice(end) });
    requestAnimationFrame(() => {
      ta?.focus();
      const pos = start + snippet.length - cursorBack;
      ta?.setSelectionRange(pos, pos);
    });
  };
  const where = `shot:${index}`;
  return (
    <div className={`shot ${cls(issues, where)}`} data-testid={`shot-${index + 1}`}>
      <div className="shot-head">
        <span className="chip-label">Shot {index + 1}</span>
        <TimeInput ms={shot.startMs} disabled={index === 0} onCommit={(ms) => onChange({ ...shot, startMs: ms })} />
        <div className="toolbar">
          <button type="button" className="mini" onClick={() => insert('<d>[English] </d>', 4)} title="Insert a dialogue block">Dialogue</button>
          <button type="button" className="mini" onClick={() => insert('(S1)')} title="Insert a speaker ID — numbered in order of first speech">(S#)</button>
          <select className="mini" value="" aria-label="Insert camera phrase" onChange={(e) => e.target.value && insert(`${e.target.value}`)}>
            <option value="">Camera…</option>
            {CAMERA_PHRASES.map((p) => <option key={p} value={p}>{p.replace('The camera ', '')}</option>)}
          </select>
          {labels.length > 0 && (
            <select className="mini" value="" aria-label="Insert label" onChange={(e) => e.target.value && insert(e.target.value)}>
              <option value="">Label…</option>
              {labels.map((l) => <option key={l} value={`<${l}>`}>{l}</option>)}
            </select>
          )}
        </div>
        {total > 1 && <button className="icon-btn" onClick={onDelete} aria-label={`Delete shot ${index + 1}`}><Icon name="trash" size={14} /></button>}
      </div>
      <textarea
        ref={ref}
        rows={5}
        value={shot.text}
        aria-label={`Shot ${index + 1} description`}
        placeholder={index === 0 ? 'What the first frame shows, who is in it, what happens…' : 'The camera cuts to…'}
        onChange={(e) => onChange({ ...shot, text: e.target.value })}
      />
    </div>
  );
}

function MarkerSelect<T extends string>({ value, options, onChange, label }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: string }) {
  return (
    <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function DefCard({ title, children, onDelete }: { title: string; children: React.ReactNode; onDelete?: () => void }) {
  return (
    <div className="def">
      <div className="def-head">
        <span className="chip-label">{title}</span>
        {onDelete && <button className="icon-btn" onClick={onDelete} aria-label={`Delete ${title}`}><Icon name="trash" size={14} /></button>}
      </div>
      {children}
    </div>
  );
}

export function PromptEditor({ doc, mode, assets, issues, onChange }: Props) {
  const reference = mode === 'REFERENCE';
  const set = (patch: Partial<PromptDoc>) => onChange({ ...doc, ...patch });
  const setShot = (i: number, s: Shot) => set({ shots: doc.shots.map((x, j) => (j === i ? s : x)) });
  const labels = [...assets.map((a) => a.label), ...(reference ? doc.subjects.map((_, i) => `Subject ${i + 1}`) : [])];
  const detailWords = countWords([doc.style, ...doc.shots.map((s) => s.text)].join('\n'));

  const addShot = () => {
    const last = doc.shots[doc.shots.length - 1]!;
    const gap = Math.max(1000, Math.round((doc.durationSec * 1000 - last.startMs) / 2 / 500) * 500);
    set({ shots: [...doc.shots, { startMs: Math.min(last.startMs + gap, Math.max(last.startMs + 500, doc.durationSec * 1000 - 500)), text: '' }] });
  };

  const updateAt = <T,>(list: T[], i: number, patch: Partial<T>) => list.map((x, j) => (j === i ? { ...x, ...patch } : x));

  return (
    <div className="editor">
      <div className={`block ${cls(issues, 'style')}`}>
        <div className="block-head">
          <h4>{reference ? 'Style opening' : 'Style'}</h4>
          <span className="muted">{reference ? 'One or two sentences before [Shot 1]' : 'Placed right after [Shot 1]'}</span>
        </div>
        <input
          value={doc.style}
          aria-label="Style"
          placeholder={reference ? 'The target video uses a realistic multi-camera sitcom style with warm indoor lighting.' : 'Live-action, cinematic'}
          onChange={(e) => set({ style: e.target.value })}
        />
      </div>

      <div className="block">
        <div className="block-head">
          <h4>Shots</h4>
          <span className="muted">{reference ? `${detailWords} words (target 350–500)` : `${doc.shots.length} shot${doc.shots.length === 1 ? '' : 's'}`}</span>
        </div>
        {doc.shots.map((shot, i) => (
          <ShotCard
            key={i}
            index={i}
            shot={shot}
            total={doc.shots.length}
            labels={labels}
            issues={issues}
            onChange={(s) => setShot(i, s)}
            onDelete={() => set({ shots: doc.shots.filter((_, j) => j !== i) })}
          />
        ))}
        <button className="btn ghost" onClick={addShot}><Icon name="plus" size={14} /> Add shot</button>
      </div>

      {reference && (
        <>
          <div className="block">
            <div className="block-head"><h4>Subjects</h4><span className="muted">Reusable people, objects, places, styles — each gets a &lt;Subject N&gt; label</span></div>
            {doc.subjects.map((s: SubjectDef, i) => (
              <DefCard key={i} title={`Subject ${i + 1}`} onDelete={() => onChange(removeSubject(doc, i))}>
                <textarea rows={2} aria-label={`Subject ${i + 1} definition`} value={s.text} placeholder="is the young woman in <Picture 1>, with long dark hair…" onChange={(e) => set({ subjects: updateAt(doc.subjects, i, { text: e.target.value }) })} />
                <div className="def-row">
                  <MarkerSelect<VisibleMarker> label={`Subject ${i + 1} retention`} value={s.marker} options={VISIBLE_MARKERS} onChange={(marker) => set({ subjects: updateAt(doc.subjects, i, { marker }) })} />
                  <input aria-label={`Subject ${i + 1} appears in shots`} className="narrow" value={s.appearsIn.join(', ')} placeholder="shots: 1, 3" onChange={(e) => set({ subjects: updateAt(doc.subjects, i, { appearsIn: e.target.value.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0) }) })} />
                  <input aria-label={`Subject ${i + 1} note`} value={s.note} placeholder="What is kept or changed" onChange={(e) => set({ subjects: updateAt(doc.subjects, i, { note: e.target.value }) })} />
                </div>
              </DefCard>
            ))}
            <button className="btn ghost" onClick={() => set({ subjects: [...doc.subjects, { text: '', appearsIn: [], marker: 'fully_preserved', note: '' }] })}><Icon name="plus" size={14} /> Add subject</button>
          </div>

          <div className="block">
            <div className="block-head"><h4>Attached files</h4><span className="muted">Frame anchors, source videos and audio get their own entry</span></div>
            {assets.length === 0 && <p className="muted">No files attached.</p>}
            {assets.map((a) => {
              const picture = a.kind === 'image' ? doc.pictures.find((p) => p.label === a.label) : undefined;
              const video = a.kind === 'video' ? doc.videos.find((p) => p.label === a.label) : undefined;
              const audio = a.kind === 'audio' ? doc.audios.find((p) => p.label === a.label) : undefined;
              const entry = picture ?? video ?? audio;
              if (!entry) {
                const add = () => {
                  if (a.kind === 'image') set({ pictures: [...doc.pictures, { label: a.label, text: '', anchor: '', marker: 'fully_preserved', note: '' }] });
                  else if (a.kind === 'video') set({ videos: [...doc.videos, { label: a.label, text: '', aspect: '', marker: 'fully_preserved', note: '' }] });
                  else set({ audios: [...doc.audios, { label: a.label, text: '', marker: 'reference', note: '' }] });
                };
                return (
                  <div className="def def-empty" key={a.id}>
                    <span className="chip-label">{a.label}</span><span className="muted">{a.filename} — cited inside a subject</span>
                    <button className="btn ghost" onClick={add}><Icon name="plus" size={14} /> Add its own entry</button>
                  </div>
                );
              }
              const remove = () => set({ pictures: doc.pictures.filter((p) => p !== picture), videos: doc.videos.filter((p) => p !== video), audios: doc.audios.filter((p) => p !== audio) });
              return (
                <DefCard key={a.id} title={`${a.label} · ${a.filename}`} onDelete={remove}>
                  <textarea rows={2} aria-label={`${a.label} definition`} value={entry.text} placeholder={a.kind === 'audio' ? 'is the voice-timbre reference for <Subject 1> (S1)' : 'is the first frame of [Shot 1], showing…'} onChange={(e) => {
                    if (picture) set({ pictures: updateAt<PictureDef>(doc.pictures, doc.pictures.indexOf(picture), { text: e.target.value }) });
                    if (video) set({ videos: updateAt<VideoDef>(doc.videos, doc.videos.indexOf(video), { text: e.target.value }) });
                    if (audio) set({ audios: updateAt<AudioDef>(doc.audios, doc.audios.indexOf(audio), { text: e.target.value }) });
                  }} />
                  <div className="def-row">
                    {audio ? (
                      <MarkerSelect<AudioMarker> label={`${a.label} relationship`} value={audio.marker} options={AUDIO_MARKERS} onChange={(marker) => set({ audios: updateAt<AudioDef>(doc.audios, doc.audios.indexOf(audio), { marker }) })} />
                    ) : (
                      <MarkerSelect<VisibleMarker> label={`${a.label} retention`} value={(picture ?? video)!.marker} options={VISIBLE_MARKERS} onChange={(marker) => {
                        if (picture) set({ pictures: updateAt<PictureDef>(doc.pictures, doc.pictures.indexOf(picture), { marker }) });
                        if (video) set({ videos: updateAt<VideoDef>(doc.videos, doc.videos.indexOf(video), { marker }) });
                      }} />
                    )}
                    {picture && <input aria-label={`${a.label} anchor`} className="narrow" value={picture.anchor} placeholder="[Shot 1] first frame" onChange={(e) => set({ pictures: updateAt<PictureDef>(doc.pictures, doc.pictures.indexOf(picture), { anchor: e.target.value }) })} />}
                    {video && <input aria-label={`${a.label} aspect`} className="narrow" value={video.aspect} placeholder="cut and pacing structure" onChange={(e) => set({ videos: updateAt<VideoDef>(doc.videos, doc.videos.indexOf(video), { aspect: e.target.value }) })} />}
                    <input aria-label={`${a.label} note`} value={entry.note} placeholder="How it is preserved, transferred or referenced" onChange={(e) => {
                      if (picture) set({ pictures: updateAt<PictureDef>(doc.pictures, doc.pictures.indexOf(picture), { note: e.target.value }) });
                      if (video) set({ videos: updateAt<VideoDef>(doc.videos, doc.videos.indexOf(video), { note: e.target.value }) });
                      if (audio) set({ audios: updateAt<AudioDef>(doc.audios, doc.audios.indexOf(audio), { note: e.target.value }) });
                    }} />
                  </div>
                </DefCard>
              );
            })}
          </div>

          <div className={`block ${cls(issues, 'summary')}`}>
            <div className="block-head"><h4>Summary</h4><span className="muted">The [task type] prefix is added for you</span></div>
            <textarea rows={3} aria-label="Summary" value={doc.summary} placeholder="The target video shows <Subject 1> … <Audio 1> serves as …" onChange={(e) => set({ summary: e.target.value })} />
          </div>
        </>
      )}

      <div className={`block ${cls(issues, 'soundscape')}`}>
        <div className="block-head"><h4>Soundscape</h4><span className="muted">Ambience & physical sounds, 1–4 sentences. No dialogue.</span></div>
        <textarea rows={3} aria-label="Soundscape" value={doc.soundscape} placeholder="Steady rain taps against the café windows while low room ambience continues underneath." onChange={(e) => set({ soundscape: e.target.value })} />
      </div>

      <div className={`block ${cls(issues, 'music')}`}>
        <div className="block-head">
          <h4>Background music</h4>
          <span className="muted">Audience-only score: instruments, tempo, dynamics</span>
          <button className="mini" onClick={() => set({ music: 'N/A' })}>No music</button>
        </div>
        <textarea rows={2} aria-label="Background music" value={doc.music} placeholder="Sparse piano notes at a slow tempo, joined by sustained low strings." onChange={(e) => set({ music: e.target.value })} />
      </div>
    </div>
  );
}
