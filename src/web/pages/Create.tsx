import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AssetRecord, BackendKind, JobRecord, SettingsView } from '../../shared/api';
import { compile } from '../../shared/compile';
import { deriveMode, labelAssets, reconcileAssets } from '../../shared/labels';
import { lint, summarizeLint } from '../../shared/lint';
import { parsePrompt } from '../../shared/parse';
import { PRESETS, type DialogueMode, type Preset } from '../../shared/presets';
import { ASPECT_RATIOS, RESOLUTIONS } from '../../shared/presets';
import { blankDoc, type AssetRef, type GenParams, type Mode } from '../../shared/types';
import { api, lintFromError, messageOf } from '../api';
import { AssetTray, type PendingUpload } from '../components/AssetTray';
import { JobCard } from '../components/JobCard';
import { PresetGallery } from '../components/PresetGallery';
import { PromptEditor } from '../components/PromptEditor';
import { DRAFT_KEY, initialDraft, type Draft } from '../draft';
import { usePersistentState, type Toast } from '../hooks';
import { makePreview } from '../media';
import { Field, Icon, Modal, Pill, Spinner, Toggle, severityTone } from '../ui';

const MODE_NAMES: Record<Mode, string> = {
  T2VA: 'Text → video',
  I2VA: 'Image → video (first frame)',
  FL2VA: 'First → last frame',
  L2VA: 'Last frame → video',
  REFERENCE: 'Full reference',
};

interface Props {
  settings: SettingsView | null;
  jobs: JobRecord[];
  push: (kind: Toast['kind'], text: string) => void;
  reuse: JobRecord | null;
  onReuseDone: () => void;
  onReuse: (j: JobRecord) => void;
  onCancel: (j: JobRecord) => void;
  onDelete: (j: JobRecord) => void;
  openLibrary: () => void;
  openSettings: () => void;
}

const STRIP = (a: AssetRef): AssetRef => ({ id: a.id, kind: a.kind, filename: a.filename, role: a.role, note: a.note });

export function CreatePage({ settings, jobs, push, reuse, onReuseDone, onReuse, onCancel, onDelete, openLibrary, openSettings }: Props) {
  const [draft, setDraft] = usePersistentState<Draft>(DRAFT_KEY, initialDraft);
  const [info, setInfo] = useState<Record<string, AssetRecord>>({});
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [busy, setBusy] = useState<null | 'enhance' | 'generate'>(null);
  const [tab, setTab] = useState<'edit' | 'text'>('edit');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [backend, setBackend] = useState<BackendKind | null>(null);

  const labeled = useMemo(() => labelAssets(draft.assets), [draft.assets]);
  const mode: Mode = draft.modeOverride ?? deriveMode(draft.assets);
  const derived = deriveMode(draft.assets);
  const text = useMemo(() => (draft.doc ? compile(draft.doc, labeled, mode) : ''), [draft.doc, labeled, mode]);
  const issues = useMemo(() => (draft.doc ? lint(draft.doc, labeled, mode) : []), [draft.doc, labeled, mode]);
  const counts = summarizeLint(issues);
  const activeBackend = backend ?? settings?.generation.backend ?? 'mock';

  // Saving a different default backend in Settings should win over an earlier per-session choice.
  const savedBackend = settings?.generation.backend;
  useEffect(() => setBackend(null), [savedBackend]);

  // Forget attachments whose files are gone from the server (deleted data dir, other machine…).
  useEffect(() => {
    api.assets().then((list) => {
      const map = Object.fromEntries(list.map((a) => [a.id, a]));
      setInfo(map);
      setDraft((d) => (d.assets.every((a) => map[a.id]) ? d : { ...d, assets: d.assets.filter((a) => map[a.id]) }));
    }).catch(() => undefined);
  }, [setDraft]);

  // "Reuse prompt" from a finished job.
  useEffect(() => {
    if (!reuse) return;
    api.assets().then((list) => {
      const map = Object.fromEntries(list.map((a) => [a.id, a]));
      setInfo(map);
      const kept: AssetRef[] = reuse.assets.filter((a) => map[a.assetId]).map((a) => ({ id: a.assetId, kind: a.kind, filename: a.filename, role: a.role, note: a.note }));
      if (kept.length < reuse.assets.length) push('info', `${reuse.assets.length - kept.length} reference file(s) from that job no longer exist and were left out.`);
      setDraft((d) => ({ ...d, assets: labelAssets(kept), doc: reuse.doc, params: reuse.params, modeOverride: reuse.mode === deriveMode(kept) ? null : reuse.mode, presetId: null }));
    }).finally(onReuseDone);
  }, [reuse, onReuseDone, push, setDraft]);

  const setParams = (patch: Partial<GenParams>) =>
    setDraft((d) => ({ ...d, params: { ...d.params, ...patch }, doc: d.doc && patch.durationSec ? { ...d.doc, durationSec: patch.durationSec } : d.doc }));

  const updateAssets = useCallback((next: AssetRef[]) => {
    setDraft((d) => {
      const r = d.doc ? reconcileAssets(d.doc, labelAssets(d.assets), next) : { assets: labelAssets(next), doc: null };
      return { ...d, assets: r.assets, doc: r.doc };
    });
  }, [setDraft]);

  const onFiles = async (files: File[]) => {
    for (const file of files) {
      const tempId = `${Date.now()}-${Math.random()}`;
      setPending((p) => [...p, { tempId, name: file.name, progress: 0 }]);
      try {
        const preview = await makePreview(file);
        const rec = await api.upload(file, preview, (progress) => setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, progress } : x))));
        setInfo((m) => ({ ...m, [rec.id]: rec }));
        setDraft((d) => {
          const role = rec.kind === 'audio' ? 'audio_reference' : rec.kind === 'image' && !d.assets.some((a) => a.kind === 'image') ? 'first_frame' : 'subject';
          const next: AssetRef[] = [...d.assets, { id: rec.id, kind: rec.kind, filename: rec.filename, role, note: '' }];
          const r = d.doc ? reconcileAssets(d.doc, labelAssets(d.assets), next) : { assets: labelAssets(next), doc: null };
          return { ...d, assets: r.assets, doc: r.doc };
        });
      } catch (e) {
        push('error', `${file.name}: ${messageOf(e)}`);
      } finally {
        setPending((p) => p.filter((x) => x.tempId !== tempId));
      }
    }
  };

  const removeAsset = (id: string) => {
    updateAssets(draft.assets.filter((a) => a.id !== id));
    api.deleteAsset(id).catch(() => undefined);
  };

  const applyPreset = (p: Preset | null) =>
    setDraft((d) => {
      if (!p) return { ...d, presetId: null };
      const isTemplate = !d.idea.trim() || PRESETS.some((x) => x.idea === d.idea);
      const params = { ...d.params, ...p.params };
      return { ...d, presetId: p.id, idea: isTemplate ? p.idea : d.idea, dialogue: p.dialogue, music: p.music, params, doc: d.doc && p.params?.durationSec ? { ...d.doc, durationSec: p.params.durationSec } : d.doc };
    });

  const enhance = async () => {
    setBusy('enhance');
    try {
      const res = await api.enhance({
        idea: draft.idea,
        presetId: draft.presetId ?? undefined,
        durationSec: draft.params.durationSec,
        aspectRatio: draft.params.aspectRatio,
        dialogue: draft.dialogue,
        dialogueLanguage: draft.dialogueLanguage,
        music: draft.music,
        assets: draft.assets.map(STRIP),
        modeOverride: draft.modeOverride ?? undefined,
      });
      setDraft((d) => ({ ...d, doc: res.doc }));
      setTab('edit');
      push('ok', res.revised ? 'Prompt ready — it failed validation once and was revised automatically.' : 'Prompt ready.');
    } catch (e) {
      push('error', messageOf(e));
    } finally {
      setBusy(null);
    }
  };

  const generate = async (force = false): Promise<void> => {
    if (!draft.doc) return;
    setBusy('generate');
    try {
      await api.createJob({ doc: draft.doc, assets: draft.assets.map(STRIP), modeOverride: draft.modeOverride ?? undefined, params: { ...draft.params, durationSec: draft.doc.durationSec }, backend: activeBackend, force });
      push('ok', 'Queued. Progress appears below.');
    } catch (e) {
      const details = lintFromError(e);
      if (!force && details.length && window.confirm(`${details.filter((i) => i.severity === 'error').length} validation error(s):\n\n${details.filter((i) => i.severity === 'error').map((i) => `• ${i.message}`).join('\n')}\n\nGenerate anyway?`)) {
        setBusy(null);
        return generate(true);
      }
      push('error', messageOf(e));
    } finally {
      setBusy(null);
    }
  };

  const doImport = () => {
    const r = parsePrompt(importText);
    if (!r.ok) return push('error', r.error);
    setDraft((d) => ({ ...d, doc: r.doc, params: { ...d.params, durationSec: r.doc.durationSec }, modeOverride: r.mode === deriveMode(d.assets) ? null : r.mode }));
    r.warnings.forEach((w) => push('info', w));
    push('ok', `Imported a ${r.mode} prompt.`);
    setImportOpen(false);
    setImportText('');
  };

  const copy = () => navigator.clipboard.writeText(text).then(() => push('ok', 'Copied.'), () => push('error', 'Clipboard is not available.'));
  const preset = PRESETS.find((p) => p.id === draft.presetId);
  const commandMissing = activeBackend === 'command' && !settings?.generation.command.program;
  const h3Missing = activeBackend === 'h3' && settings?.generation.h3.serverMode === 'managed' && !settings.generation.h3.modelDir;

  return (
    <div className="create">
      <section className="col col-left" aria-label="Compose">
        <PresetGallery selected={draft.presetId} onSelect={applyPreset} />
        {preset?.needs && <p className="hint">{preset.needs}</p>}

        <Field label="Your idea" hint="Rough is fine — Claude turns it into the structured prompt.">
          <textarea
            className="idea"
            rows={5}
            value={draft.idea}
            maxLength={6000}
            placeholder="A baker opens the shutters of a small street bakery before sunrise and says “First batch of the morning.”"
            onChange={(e) => setDraft((d) => ({ ...d, idea: e.target.value }))}
          />
        </Field>

        <AssetTray
          assets={labeled}
          info={info}
          pending={pending}
          onFiles={onFiles}
          onChange={(id, patch) => updateAssets(draft.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)))}
          onRemove={removeAsset}
        />

        <div className="params">
          <Field label="Duration (s)">
            <input type="number" min={1} max={60} step={1} value={draft.params.durationSec} onChange={(e) => setParams({ durationSec: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} />
          </Field>
          <Field label="Aspect">
            <select value={draft.params.aspectRatio} onChange={(e) => setParams({ aspectRatio: e.target.value })}>{ASPECT_RATIOS.map((a) => <option key={a}>{a}</option>)}</select>
          </Field>
          <Field label="Resolution">
            <select value={draft.params.resolution} onChange={(e) => setParams({ resolution: e.target.value })}>{RESOLUTIONS.map((a) => <option key={a}>{a}</option>)}</select>
          </Field>
          <Field label="Seed" hint="optional">
            <input type="number" value={draft.params.seed ?? ''} placeholder="random" onChange={(e) => setParams({ seed: e.target.value === '' ? null : Math.trunc(Number(e.target.value)) })} />
          </Field>
          <Field label="Dialogue">
            <select value={draft.dialogue} onChange={(e) => setDraft((d) => ({ ...d, dialogue: e.target.value as DialogueMode }))}>
              <option value="none">No speech</option>
              <option value="as_written">Use my lines exactly</option>
              <option value="write">Write lines for me</option>
            </select>
          </Field>
          <Field label="Language">
            <input value={draft.dialogueLanguage} disabled={draft.dialogue === 'none'} onChange={(e) => setDraft((d) => ({ ...d, dialogueLanguage: e.target.value }))} />
          </Field>
        </div>
        <div className="switches">
          <Toggle checked={draft.music} onChange={(music) => setDraft((d) => ({ ...d, music }))} label="Background music" />
          <Toggle checked={draft.params.generateAudio} onChange={(generateAudio) => setParams({ generateAudio })} label="Generate audio" />
        </div>

        <div className="actions">
          <button className="btn primary" onClick={enhance} disabled={busy !== null || !draft.idea.trim()}>
            {busy === 'enhance' ? <Spinner /> : <Icon name="spark" />} Enhance with Claude
          </button>
          <button className="btn" onClick={() => setDraft((d) => ({ ...d, doc: blankDoc(d.params.durationSec) }))} disabled={busy !== null}>Blank template</button>
          <button className="btn" onClick={() => setImportOpen(true)}><Icon name="import" size={14} /> Import prompt</button>
        </div>
        <p className="hint">Reference images are sent to the Claude API when you enhance. {settings && !settings.llm.apiKeySet && !settings.llm.envKeyAvailable && <button className="link" onClick={openSettings}>Add an API key</button>}</p>
      </section>

      <section className="col col-right" aria-label="Prompt">
        {!draft.doc ? (
          <div className="empty">
            <Icon name="film" size={30} />
            <h3>Your structured prompt appears here</h3>
            <p>Describe a scene and press <strong>Enhance with Claude</strong>, start from a blank template, or import a prompt you already have. Every part stays editable, and a live checker applies the Minimax H3 prompt guide.</p>
          </div>
        ) : (
          <>
            <div className="editor-head">
              <div className="mode">
                <Pill tone="accent">{mode}</Pill>
                <span>{MODE_NAMES[mode]}</span>
                <select value={draft.modeOverride ?? ''} aria-label="Prompt mode" onChange={(e) => setDraft((d) => ({ ...d, modeOverride: (e.target.value || null) as Mode | null }))}>
                  <option value="">Auto ({derived})</option>
                  {(['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REFERENCE'] as Mode[]).map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="lint-sum" data-testid="lint-summary">
                <Pill tone={counts.errors ? 'danger' : 'ok'}>{counts.errors} error{counts.errors === 1 ? '' : 's'}</Pill>
                <Pill tone={counts.warnings ? 'warn' : 'neutral'}>{counts.warnings} warning{counts.warnings === 1 ? '' : 's'}</Pill>
              </div>
              <div className="tabs" role="tablist">
                <button role="tab" aria-selected={tab === 'edit'} className={tab === 'edit' ? 'on' : ''} onClick={() => setTab('edit')}>Edit</button>
                <button role="tab" aria-selected={tab === 'text'} className={tab === 'text' ? 'on' : ''} onClick={() => setTab('text')}>Final text</button>
              </div>
            </div>

            {issues.length > 0 && (
              <details className="lint" open={counts.errors > 0}>
                <summary>Checks ({issues.length})</summary>
                <ul>
                  {issues.map((i, k) => (
                    <li key={k}><Pill tone={severityTone[i.severity]}>{i.severity}</Pill> {i.message}</li>
                  ))}
                </ul>
              </details>
            )}

            {tab === 'edit' ? (
              <PromptEditor doc={draft.doc} mode={mode} assets={labeled} issues={issues} onChange={(doc) => setDraft((d) => ({ ...d, doc }))} />
            ) : (
              <div className="final">
                <div className="final-bar"><span className="muted">Exactly what the model receives</span><button className="btn ghost" onClick={copy}><Icon name="copy" size={14} /> Copy</button></div>
                <pre className="prompt-text" data-testid="final-text">{text}</pre>
              </div>
            )}

            <div className="generate-bar">
              <Field label="Run on">
                <select value={activeBackend} onChange={(e) => setBackend(e.target.value as BackendKind)}>
                  <option value="mock">Mock (no model)</option>
                  <option value="h3">MiniMax H3 (local folder)</option>
                  <option value="command">Custom command</option>
                </select>
              </Field>
              {commandMissing && <span className="hint">No program set. <button className="link" onClick={openSettings}>Open Settings</button></span>}
              {h3Missing && <span className="hint">No model folder set. <button className="link" onClick={openSettings}>Open Settings</button></span>}
              {activeBackend === 'h3' && !h3Missing && <span className="hint">768p native · 4–15 s · the first job loads the model (a few minutes).</span>}
              <button className="btn primary big" onClick={() => generate(false)} disabled={busy !== null || commandMissing || h3Missing} data-testid="generate">
                {busy === 'generate' ? <Spinner /> : <Icon name="play" />} Generate
              </button>
            </div>
          </>
        )}
      </section>

      <section className="recent" aria-label="Recent generations">
        <div className="recent-head"><h3>Recent</h3>{jobs.length > 3 && <button className="link" onClick={openLibrary}>View all {jobs.length}</button>}</div>
        {jobs.length === 0 ? <p className="muted">Nothing generated yet.</p> : (
          <div className="job-grid">{jobs.slice(0, 3).map((j) => <JobCard key={j.id} job={j} onReuse={onReuse} onCancel={onCancel} onDelete={onDelete} />)}</div>
        )}
      </section>

      {importOpen && (
        <Modal title="Import an existing prompt" onClose={() => setImportOpen(false)} wide>
          <p className="muted">Paste a finished prompt in either guide format (“integrated_multimodal_description: …” or the six-section full-reference form). It becomes editable and gets checked.</p>
          <textarea rows={14} value={importText} onChange={(e) => setImportText(e.target.value)} aria-label="Prompt to import" className="mono" />
          <div className="modal-actions"><button className="btn" onClick={() => setImportOpen(false)}>Cancel</button><button className="btn primary" onClick={doImport} disabled={!importText.trim()}>Import</button></div>
        </Modal>
      )}
    </div>
  );
}
