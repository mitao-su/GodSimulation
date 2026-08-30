import { z } from "zod";

import { ReleaseExecutionCommandSchema } from "./release-execution.command";
import { RetryDecisionCommandSchema } from "./retry-decision.command";
import { SetReviewModeCommandSchema } from "./set-review-mode.command";
import { StopSessionCommandSchema } from "./stop-session.command";

export const WorldCommandSchema = z.discriminatedUnion("type", [
  ReleaseExecutionCommandSchema,
  SetReviewModeCommandSchema,
  RetryDecisionCommandSchema,
  StopSessionCommandSchema,
]);

export type WorldCommand = z.infer<typeof WorldCommandSchema>;
