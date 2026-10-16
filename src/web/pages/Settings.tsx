import { useCallback, useEffect, useState } from 'react';
import type { BackendKind, Effort, H3Settings, SettingsView } from '../../shared/api';
import { api, messageOf } from '../api';
import type { Toast } from '../hooks';
import { H3Panel } from '../components/H3Panel';
import { Field, Spinner, Toggle } from '../ui';

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const envToText = (env: Record<string, string>) => Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n');
const textToEnv = (t: string): Record<string, string> =>
  Object.fromEntries(t.split('\n').map((l) => l.trim()).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1)]));

export function SettingsPage({ settings, onSaved, push }: { settings: SettingsView | null; onSaved: (s: SettingsView) => void; push: (k: Toast['kind'], t: string) => void }) {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState<Effort>('high');
  const [fallback, setFallback] = useState(true);
  const [backend, setBackend] = useState<BackendKind>('mock');
  const [program, setProgram] = useState('');
  const [args, setArgs] = useState('');
  const [cwd, setCwd] = useState('');
  const [env, setEnv] = useState('');
  const [timeoutMin, setTimeoutMin] = useState(60);
  const [h3, setH3] = useState<H3Settings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setModel(settings.llm.model);
    setEffort(settings.llm.effort);
    setFallback(settings.llm.refusalFallback);
    setBackend(settings.generation.backend);
    setProgram(settings.generation.command.program);
    setArgs(settings.generation.command.args.join('\n'));
    setCwd(settings.generation.command.cwd);
    setEnv(envToText(settings.generation.command.env));
    setTimeoutMin(settings.generation.command.timeoutMin);
    setH3(settings.generation.h3);
  }, [settings]);

  const patchH3 = useCallback((patch: Partial<H3Settings>) => setH3((cur) => (cur ? { ...cur, ...patch } : cur)), []);

  if (!settings || !h3) return <div className="page"><Spinner /></div>;

  const save = async (extra: { clearApiKey?: boolean } = {}): Promise<boolean> => {
    setSaving(true);
    try {
      const saved = await api.saveSettings({
        llm: { model, effort, refusalFallback: fallback, apiKey: apiKey || undefined, ...extra },
        generation: { backend, command: { program, args: args.split('\n').map((l) => l.trim()).filter(Boolean), cwd, env: textToEnv(env), timeoutMin }, h3 },
      });
      setApiKey('');
      onSaved(saved);
      push('ok', 'Settings saved.');
      return true;
    } catch (e) {
      push('error', messageOf(e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page settings">
      <h2>Settings</h2>

      <section className="card">
        <h3>Prompt rewriting — Claude</h3>
        <p className="muted">Used by “Enhance”. Your key stays on this machine (data/settings.json, owner-readable only) and is never sent to the browser.</p>
        <Field label="Anthropic API key" hint={settings.llm.apiKeySet ? `Saved: ${settings.llm.apiKeyHint}` : settings.llm.envKeyAvailable ? 'Using ANTHROPIC_API_KEY from the environment' : 'Not set — or export ANTHROPIC_API_KEY, or run `ant auth login`'}>
          <input type="password" autoComplete="off" value={apiKey} placeholder={settings.llm.apiKeySet ? 'Enter a new key to replace it' : 'sk-ant-…'} onChange={(e) => setApiKey(e.target.value)} />
        </Field>
        {settings.llm.apiKeySet && <button className="btn ghost" onClick={() => save({ clearApiKey: true })}>Remove saved key</button>}
        <div className="grid2">
          <Field label="Model"><input value={model} onChange={(e) => setModel(e.target.value)} /></Field>
          <Field label="Effort" hint="Higher = more careful, slower, costs more">
            <select value={effort} onChange={(e) => setEffort(e.target.value as Effort)}>{EFFORTS.map((x) => <option key={x}>{x}</option>)}</select>
          </Field>
        </div>
        <Toggle checked={fallback} onChange={setFallback} label="If Claude declines a request, retry it on Anthropic's recommended fallback model (server-side)" />
      </section>

      <section className="card">
        <h3>Video generation</h3>
        <Field label="Backend">
          <select value={backend} onChange={(e) => setBackend(e.target.value as BackendKind)}>
            <option value="h3">MiniMax H3 — my downloaded model folder</option>
            <option value="mock">Mock — simulates a render, produces no video</option>
            <option value="command">Custom command — run my own program per job</option>
          </select>
        </Field>
        {backend === 'h3' && <H3Panel value={h3} onChange={patchH3} saveNow={() => save()} push={push} />}
        {backend === 'command' && <div>
          <Field label="Program" hint="Started directly (no shell). Use a full path, or something on PATH such as python3.">
            <input value={program} placeholder="/home/me/h3/.venv/bin/python" onChange={(e) => setProgram(e.target.value)} />
          </Field>
          <Field label="Arguments" hint="One per line">
            <textarea rows={3} className="mono" value={args} placeholder={'/home/me/h3/generate.py'} onChange={(e) => setArgs(e.target.value)} />
          </Field>
          <div className="grid2">
            <Field label="Working directory" hint="Blank = the job folder"><input value={cwd} onChange={(e) => setCwd(e.target.value)} /></Field>
            <Field label="Timeout (minutes)"><input type="number" min={1} max={1440} value={timeoutMin} onChange={(e) => setTimeoutMin(Number(e.target.value))} /></Field>
          </div>
          <Field label="Extra environment" hint="KEY=value, one per line">
            <textarea rows={3} className="mono" value={env} placeholder={'CUDA_VISIBLE_DEVICES=0'} onChange={(e) => setEnv(e.target.value)} />
          </Field>
        </div>}
        {backend === 'command' && <details className="contract">
          <summary>How the program is called</summary>
          <p>For each job the program runs once with these environment variables:</p>
          <ul>
            <li><code>H3_JOB_JSON</code> — path to <code>job.json</code>: <code>{'{ id, mode, prompt, params, assets:[{ label, kind, role, path, filename, mime, note }] }'}</code></li>
            <li><code>H3_PROMPT_FILE</code> — the final structured prompt as plain text</li>
            <li><code>H3_JOB_DIR</code> — working folder; reference files are in <code>inputs/Picture_1.png</code>, <code>Video_1.mp4</code>, …</li>
            <li><code>H3_OUTPUT</code> — write the finished video here (<code>output.mp4</code>; <code>.webm/.mov/.m4v</code> also accepted)</li>
          </ul>
          <p>Print <code>PROGRESS 40 sampling</code> (percent) or <code>{'{"progress":0.4,"message":"sampling"}'}</code> to update the progress bar. Exit code 0 with an output file = success; anything else = failed, and the last log lines are shown on the job.</p>
        </details>}
      </section>

      <div className="actions">
        <button className="btn primary" onClick={() => save()} disabled={saving}>{saving ? <Spinner /> : null} Save settings</button>
      </div>
    </div>
  );
}
