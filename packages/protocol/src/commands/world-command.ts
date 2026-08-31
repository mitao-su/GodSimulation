import { z } from "zod";

import { ReleaseExecutionCommandSchema } from "./release-execution.command";
import { RetryDecisionCommandSchema } from "./retry-decision.command";
import { RetryTechnicalFailureCommandSchema } from "./retry-technical-failure.command";
import { SetReviewModeCommandSchema } from "./set-review-mode.command";
import { StopSessionCommandSchema } from "./stop-session.command";

export const WorldCommandSchema = z.discriminatedUnion("type", [
  ReleaseExecutionCommandSchema,
  SetReviewModeCommandSchema,
  RetryDecisionCommandSchema,
  RetryTechnicalFailureCommandSchema,
  StopSessionCommandSchema,
]);

export type WorldCommand = z.infer<typeof WorldCommandSchema>;
