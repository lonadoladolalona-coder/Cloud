import { useCallback, useEffect, useState } from 'react';
import type { H3Scan, H3ServerStatus, H3Settings, H3Variant } from '../../shared/api';
import { api, messageOf } from '../api';
import type { Toast } from '../hooks';
import { Field, Pill, Spinner } from '../ui';
import { FolderPicker } from './FolderPicker';

const VARIANT_TITLE: Record<H3Variant, string> = {
  fl2va: 'FL2VA — text, first-frame and last-frame prompts',
  ref2va: 'Ref2VA — reference image, video and audio prompts',
};
const COMPONENT_LABEL = { ok: '✓', missing: '✗ missing', no_weights: '✗ no weights', lfs_pointer: '✗ LFS stub' } as const;
const gb = (n: number) => `${(n / 2 ** 30).toFixed(1)} GB`;
const STATE_TONE = { stopped: 'neutral', starting: 'warn', ready: 'ok', error: 'danger' } as const;

const envToText = (env: Record<string, string>) => Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n');
const textToEnv = (t: string): Record<string, string> =>
  Object.fromEntries(t.split('\n').map((l) => l.trim()).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1)]));

interface Props {
  value: H3Settings;
  onChange: (patch: Partial<H3Settings>) => void;
  /** Saves the settings (so the server sees them) and resolves false on failure. */
  saveNow: () => Promise<boolean>;
  push: (kind: Toast['kind'], text: string) => void;
}

export function H3Panel({ value, onChange, saveNow, push }: Props) {
  const [scan, setScan] = useState<H3Scan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [picker, setPicker] = useState(false);
  const [server, setServer] = useState<H3ServerStatus | null>(null);
  const [envText, setEnvText] = useState(envToText(value.env));
  const [argsText, setArgsText] = useState(value.extraArgs.join('\n'));

  const refresh = useCallback(() => void api.h3Status().then(setServer).catch(() => undefined), []);
  useEffect(refresh, [refresh]);
  useEffect(() => {
    if (server?.state !== 'starting') return;
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [server?.state, refresh]);

  const runScan = useCallback(
    async (folder: string) => {
      setScanning(true);
      try {
        const result = await api.scanH3(folder);
        setScan(result);
        // Apply what was found so the user doesn't have to: model root, SGLang path, GPU count.
        if (Object.keys(result.suggested).length > 0) onChange(result.suggested);
      } catch (e) {
        push('error', messageOf(e));
      } finally {
        setScanning(false);
      }
    },
    [onChange, push],
  );

  const control = async (action: () => Promise<H3ServerStatus>) => {
    if (!(await saveNow())) return;
    try {
      setServer(await action());
    } catch (e) {
      push('error', messageOf(e));
    }
  };

  const managed = value.serverMode === 'managed';
  const busyLoading = server?.state === 'starting';

  return (
    <div className="h3-panel" data-testid="h3-panel">
      <div className="field">
        <span className="field-label" id="h3-folder-label">Model folder</span>
        <div className="row">
          <input aria-labelledby="h3-folder-label" value={value.modelDir} placeholder="/home/me/models/MiniMax-H3   or   D:\models\MiniMax-H3" onChange={(e) => onChange({ modelDir: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && void runScan(value.modelDir)} />
          <button className="btn" onClick={() => setPicker(true)}>Browse…</button>
          <button className="btn primary" onClick={() => void runScan(value.modelDir)} disabled={scanning || !value.modelDir.trim()}>{scanning ? <Spinner /> : null} Scan folder</button>
        </div>
        <span className="field-hint">The folder you unzipped / downloaded MiniMax-H3 into — the one containing FL2VA and Ref2VA. A parent folder works too.</span>
      </div>

      {scan && (
        <div className="scan" data-testid="scan-result">
          {scan.variants.filter((v) => v.present).map((v) => (
            <div className="scan-variant" key={v.variant} data-testid={`scan-${v.variant}`}>
              <div className="scan-head">
                <Pill tone={v.complete ? 'ok' : 'danger'}>{v.complete ? 'ready' : 'incomplete'}</Pill>
                <strong>{VARIANT_TITLE[v.variant]}</strong>
                <span className="muted">{gb(v.sizeBytes)}</span>
              </div>
              <div className="scan-components">
                {(Object.keys(v.components) as Array<keyof typeof v.components>).map((c) => (
                  <span key={c} className={`comp ${v.components[c] === 'ok' ? 'comp-ok' : 'comp-bad'}`}>{c} {COMPONENT_LABEL[v.components[c]]}</span>
                ))}
              </div>
            </div>
          ))}
          <ul className="scan-notes">
            {scan.notes.map((n, i) => <li key={i} className={`note note-${n.level}`}><span className="note-dot" aria-hidden="true" />{n.text}</li>)}
          </ul>
          {scan.ready && scan.variants.filter((v) => v.present).every((v) => v.complete) && <p className="scan-ok" role="status">✓ Everything needed was found. Save, then press Generate.</p>}
          {scan.ready && scan.variants.some((v) => v.present && !v.complete) && (
            <p className="scan-ok" role="status">✓ {scan.variants.filter((v) => v.complete).map((v) => v.folder).join(' and ')} can be used now. Fix the red items above to enable the rest.</p>
          )}
        </div>
      )}

      <div className="radio-group" role="radiogroup" aria-label="Model server">
        <label className="radio"><input type="radio" name="h3-mode" checked={managed} onChange={() => onChange({ serverMode: 'managed' })} /> <span><strong>Studio runs the model server for me</strong> <span className="muted">— starts <code>sglang serve</code> from the folder when needed and stops it when idle</span></span></label>
        <label className="radio"><input type="radio" name="h3-mode" checked={!managed} onChange={() => onChange({ serverMode: 'external' })} /> <span><strong>I run the server myself</strong> <span className="muted">— SGLang in WSL/Docker/another machine; give its address</span></span></label>
      </div>

      {!managed && (
        <>
          <div className="grid2">
            <Field label="FL2VA server URL" hint="Text-to-video, first/last-frame"><input value={value.externalFl2vaUrl} onChange={(e) => onChange({ externalFl2vaUrl: e.target.value })} /></Field>
            <Field label="Ref2VA server URL" hint="Reference prompts"><input value={value.externalRef2vaUrl} onChange={(e) => onChange({ externalRef2vaUrl: e.target.value })} /></Field>
          </div>
          <Field label="How files reach the server" hint="“Path” only works if the server can read this computer's disk. Choose “Embedded” for Docker, WSL or another machine.">
            <select value={value.assetTransport} onChange={(e) => onChange({ assetTransport: e.target.value as H3Settings['assetTransport'] })}>
              <option value="file">Path on this computer</option>
              <option value="data">Embedded in the request (base64, up to 64 MB per file)</option>
            </select>
          </Field>
        </>
      )}

      {managed && (
        <div className="server-box" data-testid="server-status">
          <div className="scan-head">
            <strong>Model server</strong>
            <Pill tone={STATE_TONE[server?.state ?? 'stopped']}>{server?.state ?? 'stopped'}{server?.variant ? ` · ${server.variant.toUpperCase()}` : ''}</Pill>
            {server?.url && <span className="muted">{server.url}</span>}
            {busyLoading && <Spinner />}
          </div>
          {server?.error && <p className="field-error" role="alert">{server.error}</p>}
          <div className="actions">
            <button className="btn" onClick={() => void control(() => api.h3Start('fl2va'))} disabled={busyLoading}>Start FL2VA</button>
            <button className="btn" onClick={() => void control(() => api.h3Start('ref2va'))} disabled={busyLoading}>Start Ref2VA</button>
            <button className="btn ghost danger" onClick={() => void control(() => api.h3Stop())} disabled={!server || server.state === 'stopped'}>Stop</button>
            <span className="muted">Optional — generating starts the right one automatically. Loading takes a few minutes the first time.</span>
          </div>
          {server && server.log.length > 0 && (
            <details>
              <summary>Server log ({server.log.length} lines)</summary>
              <pre className="log">{server.log.slice(-40).join('\n')}</pre>
            </details>
          )}
        </div>
      )}

      <details className="contract">
        <summary>Advanced</summary>
        <div className="grid2">
          <Field label="SGLang program" hint="Blank = auto-detect (found by Scan)"><input value={value.sglangPath} placeholder="/home/me/.venv/bin/sglang" onChange={(e) => onChange({ sglangPath: e.target.value })} /></Field>
          <Field label="GPUs" hint="0 = detect automatically"><input type="number" min={0} max={64} value={value.numGpus} onChange={(e) => onChange({ numGpus: Number(e.target.value) })} /></Field>
          <Field label="Base port" hint="FL2VA uses this, Ref2VA uses the next one"><input type="number" min={1024} max={65534} value={value.port} onChange={(e) => onChange({ port: Number(e.target.value) })} /></Field>
          <Field label="Stop after idle (minutes)" hint="Frees the GPU; 0 = keep running"><input type="number" min={0} max={1440} value={value.idleStopMin} onChange={(e) => onChange({ idleStopMin: Number(e.target.value) })} /></Field>
          <Field label="Model load timeout (minutes)"><input type="number" min={1} max={720} value={value.startupTimeoutMin} onChange={(e) => onChange({ startupTimeoutMin: Number(e.target.value) })} /></Field>
          <Field label="Generation timeout (minutes)"><input type="number" min={1} max={1440} value={value.jobTimeoutMin} onChange={(e) => onChange({ jobTimeoutMin: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Extra sglang arguments" hint="One per line, appended to sglang serve (e.g. --performance-mode, speed)">
          <textarea rows={3} className="mono" value={argsText} onChange={(e) => { setArgsText(e.target.value); onChange({ extraArgs: e.target.value.split('\n').map((l) => l.trim()).filter(Boolean) }); }} />
        </Field>
        <Field label="Server environment" hint="KEY=value, one per line (e.g. CUDA_VISIBLE_DEVICES=0)">
          <textarea rows={2} className="mono" value={envText} onChange={(e) => { setEnvText(e.target.value); onChange({ env: textToEnv(e.target.value) }); }} />
        </Field>
        <p className="muted">Runs: <code>sglang serve --model-path {value.modelDir || '<folder>'} --model-variant fl2va|ref2va --num-gpus {value.numGpus || 'N'} --host 127.0.0.1 --port {value.port}</code></p>
      </details>

      {picker && <FolderPicker start={value.modelDir} onClose={() => setPicker(false)} onPick={(p) => { setPicker(false); onChange({ modelDir: p }); void runScan(p); }} />}
    </div>
  );
}
