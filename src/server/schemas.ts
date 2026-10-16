import { z } from 'zod';
import { ROLES_BY_KIND, type AssetRole } from '../shared/types';

const text = (max: number) => z.string().max(max);
const marker = z.enum(['fully_preserved', 'partially_preserved', 'attribute_transfer', 'weak_reference']);
const audioMarker = z.enum(['fully_copy', 'partially_copy', 'reference', 'weak_reference']);
const mode = z.enum(['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'REFERENCE']);

export const AssetRefSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{16}$/),
    kind: z.enum(['image', 'video', 'audio']),
    filename: text(200),
    role: z.string(),
    note: text(1000),
  })
  .refine((a) => ROLES_BY_KIND[a.kind].includes(a.role as AssetRole), { message: 'Role is not valid for this kind of asset.' })
  .transform((a) => ({ ...a, role: a.role as AssetRole }));

export const PromptDocSchema = z.object({
  durationSec: z.number().min(1).max(60),
  style: text(2000),
  shots: z.array(z.object({ startMs: z.number().int().min(0).max(3_600_000), text: text(8000) })).min(1).max(30),
  soundscape: text(4000),
  music: text(4000),
  summary: text(4000),
  subjects: z.array(z.object({ text: text(4000), appearsIn: z.array(z.number().int().min(1).max(99)).max(30), marker, note: text(2000) })).max(30),
  pictures: z.array(z.object({ label: text(20), text: text(4000), anchor: text(200), marker, note: text(2000) })).max(30),
  videos: z.array(z.object({ label: text(20), text: text(4000), aspect: text(200), marker, note: text(2000) })).max(30),
  audios: z.array(z.object({ label: text(20), text: text(4000), marker: audioMarker, note: text(2000) })).max(30),
});

export const GenParamsSchema = z.object({
  durationSec: z.number().min(1).max(60),
  aspectRatio: text(10),
  resolution: text(10),
  seed: z.number().int().nullable(),
  generateAudio: z.boolean(),
});

export const EnhanceRequestSchema = z.object({
  idea: z.string().trim().min(1, 'Describe the scene first.').max(6000),
  presetId: text(40).optional(),
  durationSec: z.number().min(1).max(60),
  aspectRatio: text(10),
  dialogue: z.enum(['none', 'as_written', 'write']),
  dialogueLanguage: text(40),
  music: z.boolean(),
  assets: z.array(AssetRefSchema).max(16),
  modeOverride: mode.optional(),
});

export const CreateJobSchema = z.object({
  doc: PromptDocSchema,
  assets: z.array(AssetRefSchema).max(16),
  modeOverride: mode.optional(),
  params: GenParamsSchema,
  backend: z.enum(['mock', 'command', 'h3']).optional(),
  force: z.boolean().optional(),
});
