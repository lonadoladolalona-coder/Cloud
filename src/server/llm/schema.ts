import { z } from 'zod';

const visible = z.enum(['fully_preserved', 'partially_preserved', 'attribute_transfer', 'weak_reference']);
const audio = z.enum(['fully_copy', 'partially_copy', 'reference', 'weak_reference']);

/**
 * What the model returns. The application assembles section headers, [Shot N] markers,
 * timestamps, the alignment line and the [task type] prefix from these fields, so none of
 * that formatting is the model's job (and none of it can drift).
 */
export const EnhanceSchema = z.object({
  style: z.string(),
  shots: z.array(z.object({ startMs: z.number().int(), text: z.string() })),
  soundscape: z.string(),
  music: z.string(),
  summary: z.string(),
  subjects: z.array(z.object({ text: z.string(), appearsIn: z.array(z.number().int()), marker: visible, note: z.string() })),
  pictures: z.array(z.object({ label: z.string(), text: z.string(), anchor: z.string(), marker: visible, note: z.string() })),
  videos: z.array(z.object({ label: z.string(), text: z.string(), aspect: z.string(), marker: visible, note: z.string() })),
  audios: z.array(z.object({ label: z.string(), text: z.string(), marker: audio, note: z.string() })),
});

export type EnhanceOutput = z.infer<typeof EnhanceSchema>;
