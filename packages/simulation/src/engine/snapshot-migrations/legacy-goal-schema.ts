import { z } from "zod";

import { EntityIdSchema } from "@god-sim/protocol";

const LegacyGoalOptionIdSchema = z.string().min(1);

export const LegacyUseObjectGoalSchema = z
  .object({
    kind: z.literal("use_object"),
    targetEntityId: EntityIdSchema,
    interactionId: z.string().min(1),
  })
  .strict();

export const LegacyWaitGoalSchema = z
  .object({
    kind: z.literal("wait"),
    durationTicks: z.number().int().positive().max(600),
  })
  .strict();

export const LegacyObserveGoalSchema = z
  .object({
    kind: z.literal("observe"),
    targetEntityId: EntityIdSchema,
  })
  .strict();

export const LegacyGoalSchema = z.discriminatedUnion("kind", [
  LegacyUseObjectGoalSchema,
  LegacyWaitGoalSchema,
  LegacyObserveGoalSchema,
]);
export type LegacyGoal = z.infer<typeof LegacyGoalSchema>;

export const LegacyGoalOptionSchema = z
  .object({
    id: LegacyGoalOptionIdSchema,
    label: z.string().min(1).max(160),
    goal: LegacyGoalSchema,
  })
  .strict();

export const LegacyGoalProposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    goalOptionId: LegacyGoalOptionIdSchema,
    reason: z.string().min(1).max(500),
  })
  .strict();

export const LegacyCurrentGoalContextSchema = z
  .object({
    goal: LegacyGoalSchema,
    label: z.string().min(1).max(160),
    actionKind: z.string().min(1).nullable(),
    actionProgress: z.number().int().nonnegative().nullable(),
    lastFailure: z.string().max(500).nullable(),
  })
  .strict();
