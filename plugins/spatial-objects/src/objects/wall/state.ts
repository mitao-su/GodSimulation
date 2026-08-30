import { z } from "zod";

export const WallStateSchema = z.object({}).strict();
export type WallState = z.infer<typeof WallStateSchema>;
