import { z } from "zod";

import { AgentIdSchema } from "@god-sim/protocol";

export interface RefrigeratorState {
  readonly occupiedBy: string | null;
}

export const RefrigeratorStateSchema: z.ZodType<RefrigeratorState> = z
  .object({ occupiedBy: AgentIdSchema.nullable() })
  .strict();
