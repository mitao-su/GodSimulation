import { z } from "zod";

export const ModelConfigSchema = z
  .object({
    endpoint: z.url(),
    apiKey: z.string().min(1),
    model: z.string().min(1),
    timeoutMs: z.number().int().positive().max(300_000),
    appUrl: z.url().optional(),
    appTitle: z.string().min(1).max(160).optional(),
  })
  .strict();

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

