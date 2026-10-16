import { promises as fs } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { EnhanceRequest, EnhanceResponse } from '../../shared/api';
import { compile } from '../../shared/compile';
import { deriveMode, labelAssets } from '../../shared/labels';
import { lint } from '../../shared/lint';
import { PRESETS } from '../../shared/presets';
import { blankDoc, type LabeledAsset, type LintIssue, type Mode, type PromptDoc } from '../../shared/types';
import type { Settings } from '../settings';
import type { Store } from '../store';
import { buildRepairContent, buildUserContent, systemBlocks, type ImageInput, type SystemBlock, type UserBlock } from './prompt';
import { EnhanceSchema, type EnhanceOutput } from './schema';

export class EnhanceError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

export interface CompleteArgs {
  settings: Settings;
  system: SystemBlock[];
  content: UserBlock[];
}
/** Sends one request and returns the model's raw JSON text. Injectable so the pipeline is testable offline. */
export type Complete = (args: CompleteArgs) => Promise<string>;

export const completeWithClaude: Complete = async ({ settings, system, content }) => {
  const client = new Anthropic({ apiKey: settings.llm.apiKey || undefined });
  let res;
  try {
    res = await client.beta.messages.create({
      model: settings.llm.model,
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content }],
      output_config: { effort: settings.llm.effort, format: zodOutputFormat(EnhanceSchema) },
      // Claude's safety classifiers can decline a request; this re-runs it server-side on the recommended fallback.
      ...(settings.llm.refusalFallback ? { betas: ['server-side-fallback-2026-07-01' as const], fallbacks: 'default' as const } : {}),
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new EnhanceError('Claude rejected the API key. Check it under Settings.', 401);
    if (err instanceof Anthropic.RateLimitError) throw new EnhanceError('Claude is rate-limiting requests. Wait a moment and try again.', 429);
    if (err instanceof Anthropic.BadRequestError) throw new EnhanceError(`Claude rejected the request: ${err.message}`, 400);
    if (err instanceof Anthropic.APIConnectionError) throw new EnhanceError('Could not reach the Claude API. Check your connection.', 502);
    if (err instanceof Anthropic.APIError) throw new EnhanceError(`Claude API error ${err.status}: ${err.message}`, 502);
    if (err instanceof Error && /authentication method|apiKey|credential/i.test(err.message)) {
      throw new EnhanceError('No Claude credentials found. Add an API key under Settings, export ANTHROPIC_API_KEY, or run `ant auth login`.', 401);
    }
    throw err;
  }
  if (res.stop_reason === 'refusal') {
    const cat = res.stop_details && 'category' in res.stop_details ? ` (${String(res.stop_details.category)})` : '';
    throw new EnhanceError(`Claude declined this request${cat}. Try rewording the idea.`, 422);
  }
  if (res.stop_reason === 'max_tokens') throw new EnhanceError('The response was cut off before it finished. Try a shorter idea.', 502);
  const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  if (!text.trim()) throw new EnhanceError('Claude returned no content.', 502);
  return text;
};

const IMAGE_TYPES: Record<string, ImageInput['mediaType']> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const MAX_ORIGINAL_BYTES = 3_500_000;

async function loadImages(store: Store, assets: LabeledAsset[]): Promise<ImageInput[]> {
  const out: ImageInput[] = [];
  for (const a of assets) {
    if (a.kind === 'audio') continue;
    const meta = store.getAsset(a.id);
    if (!meta) continue;
    const preview = store.assetPath(a.id, 'preview');
    if (preview) {
      out.push({ assetId: a.id, mediaType: 'image/jpeg', base64: (await fs.readFile(preview)).toString('base64'), posterOf: a.kind === 'video' ? 'video' : undefined });
    } else if (a.kind === 'image' && IMAGE_TYPES[meta.ext] && meta.size <= MAX_ORIGINAL_BYTES) {
      const original = store.assetPath(a.id, 'original');
      if (original) out.push({ assetId: a.id, mediaType: IMAGE_TYPES[meta.ext]!, base64: (await fs.readFile(original)).toString('base64') });
    }
  }
  return out;
}

const SHOT_MARKER = /^\s*(?:\[Shot\s+\d+\]\s*)?(?:At\s+\d{1,2}:\d{2}(?:\.\d{1,3})?,\s*)?/i;

/** Turns the model's JSON into a document the editor and compiler can use, repairing harmless structural slips. */
export function toDoc(out: EnhanceOutput, req: EnhanceRequest, mode: Mode, assets: LabeledAsset[]): PromptDoc {
  const doc = blankDoc(req.durationSec);
  const shots = [...out.shots].sort((a, b) => a.startMs - b.startMs).map((s) => ({ startMs: Math.max(0, s.startMs), text: s.text.replace(SHOT_MARKER, '').trim() }));
  doc.shots = shots.length ? shots : doc.shots;
  doc.shots[0] = { ...doc.shots[0]!, startMs: 0 };
  doc.style = out.style.trim();
  doc.soundscape = out.soundscape.trim();
  doc.music = req.music ? out.music.trim() : 'N/A';
  if (mode === 'REFERENCE') {
    const known = new Set(assets.map((a) => a.label));
    doc.summary = out.summary.replace(/^\s*\[[^\]]+\]\s*/, '').trim();
    doc.subjects = out.subjects;
    doc.pictures = out.pictures.filter((p) => known.has(p.label));
    doc.videos = out.videos.filter((v) => known.has(v.label));
    doc.audios = out.audios.filter((a) => known.has(a.label));
  }
  return doc;
}

const score = (issues: LintIssue[]) => issues.filter((i) => i.severity === 'error').length * 10 + issues.filter((i) => i.severity === 'warning').length;
const needsRepair = (issues: LintIssue[]) => issues.some((i) => i.severity === 'error' || i.id === 'detail.words');

function parseOutput(raw: string): EnhanceOutput {
  try {
    return EnhanceSchema.parse(JSON.parse(raw));
  } catch (err) {
    throw new EnhanceError(`Claude's reply did not match the expected structure (${err instanceof Error ? err.message.slice(0, 160) : 'parse error'}).`, 502);
  }
}

export async function enhance(req: EnhanceRequest, deps: { store: Store; settings: Settings; complete?: Complete }): Promise<EnhanceResponse> {
  const complete = deps.complete ?? completeWithClaude;
  const assets = labelAssets(req.assets);
  const mode = req.modeOverride ?? deriveMode(req.assets);
  const preset = PRESETS.find((p) => p.id === req.presetId);
  const images = await loadImages(deps.store, assets);
  const content = buildUserContent(req, assets, mode, preset, images);
  const system = systemBlocks();

  const draft = async (raw: string) => {
    const doc = toDoc(parseOutput(raw), req, mode, assets);
    return { doc, issues: lint(doc, assets, mode), raw };
  };

  let best = await draft(await complete({ settings: deps.settings, system, content }));
  let revised = false;
  if (needsRepair(best.issues)) {
    try {
      const second = await draft(await complete({ settings: deps.settings, system, content: buildRepairContent(content, best.raw, best.issues) }));
      revised = true;
      if (score(second.issues) < score(best.issues)) best = second;
    } catch (err) {
      // The first draft is still usable; a failed revision shouldn't discard it.
      if (!(err instanceof EnhanceError)) throw err;
    }
  }
  return { doc: best.doc, mode, assets, text: compile(best.doc, assets, mode), lint: best.issues, revised };
}
