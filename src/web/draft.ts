import type { DialogueMode } from '../shared/presets';
import type { AssetRef, GenParams, Mode, PromptDoc } from '../shared/types';

/** Everything on the Create page that should survive a reload. */
export interface Draft {
  idea: string;
  presetId: string | null;
  params: GenParams;
  dialogue: DialogueMode;
  dialogueLanguage: string;
  music: boolean;
  assets: AssetRef[];
  modeOverride: Mode | null;
  doc: PromptDoc | null;
}

export const initialDraft = (): Draft => ({
  idea: '',
  presetId: null,
  params: { durationSec: 8, aspectRatio: '16:9', resolution: '720p', seed: null, generateAudio: true },
  dialogue: 'none',
  dialogueLanguage: 'English',
  music: false,
  assets: [],
  modeOverride: null,
  doc: null,
});

export const DRAFT_KEY = 'studio-h3.draft.v1';
