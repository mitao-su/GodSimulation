import { z } from "zod";

import { AgentIdSchema } from "@god-sim/protocol";

export interface ToiletState {
  readonly occupiedBy: string | null;
}

export const ToiletStateSchema: z.ZodType<ToiletState> = z
  .object({ occupiedBy: AgentIdSchema.nullable() })
  .strict();
