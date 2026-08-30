import { z } from "zod";

export const WorldModeSchema = z.enum([
  "THINKING",
  "READY_FOR_RELEASE",
  "RUNNING",
  "TECHNICALLY_BLOCKED",
]);

export type WorldMode = z.infer<typeof WorldModeSchema>;
