import { z } from "zod";

import {
  OperationCallIdSchema,
  OperationIdSchema,
  TaskOptionIdSchema,
} from "../identity/ids";
import { JsonObjectSchema } from "../json/json-value";

export const TaskTrackSchema = z.enum(["HEAD", "BODY"]);
export type TaskTrack = z.infer<typeof TaskTrackSchema>;

const TASK_TRACK_ORDER: readonly TaskTrack[] = ["HEAD", "BODY"];

export function canonicalTaskTracks(
  input: readonly TaskTrack[],
): readonly TaskTrack[] {
  const tracks = input.map((track) => TaskTrackSchema.parse(track));
  if (tracks.length === 0) {
    throw new Error("An operation requires at least one task track");
  }
  if (new Set(tracks).size !== tracks.length) {
    throw new Error("Operation task tracks contain a duplicate");
  }
  const canonical = TASK_TRACK_ORDER.filter((track) => tracks.includes(track));
  if (canonical.some((track, index) => track !== tracks[index])) {
    throw new Error("Operation task tracks are not in canonical order");
  }
  return canonical;
}

export const CanonicalTaskTracksSchema = z
  .array(TaskTrackSchema)
  .min(1)
  .max(2)
  .superRefine((tracks, context) => {
    try {
      canonicalTaskTracks(tracks);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

export const OperationDurationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("fixed"),
      totalTicks: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.literal("indeterminate") }).strict(),
]);
export type OperationDuration = z.infer<typeof OperationDurationSchema>;

const TaskOptionBaseShape = {
  id: TaskOptionIdSchema,
  label: z.string().min(1).max(160),
  taskSlots: CanonicalTaskTracksSchema,
  argumentSchema: JsonObjectSchema,
};

const EmptyTaskOptionSchema = z
  .object({
    kind: z.literal("empty"),
    ...TaskOptionBaseShape,
  })
  .strict()
  .refine((option) => option.taskSlots.length === 1, {
    message: "An empty task option belongs to exactly one task track",
  });

const OperationTaskOptionSchema = z
  .object({
    kind: z.literal("operation"),
    ...TaskOptionBaseShape,
    operationId: OperationIdSchema,
    fixedArguments: JsonObjectSchema,
  })
  .strict();

export const TaskOptionSchema = z.discriminatedUnion("kind", [
  EmptyTaskOptionSchema,
  OperationTaskOptionSchema,
]);
export type TaskOption = z.infer<typeof TaskOptionSchema>;

export const TaskSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("continue") }).strict(),
  z
    .object({
      kind: z.literal("replace"),
      taskOptionId: TaskOptionIdSchema,
      arguments: JsonObjectSchema,
    })
    .strict(),
]);
export type TaskSelection = z.infer<typeof TaskSelectionSchema>;

export const TaskDecisionSchema = z
  .object({
    schemaVersion: z.literal(2),
    head: TaskSelectionSchema,
    body: TaskSelectionSchema,
    reason: z.string().min(1).max(500),
  })
  .strict();
export type TaskDecision = z.infer<typeof TaskDecisionSchema>;

export const ActiveOperationContextSchema = z
  .object({
    callId: OperationCallIdSchema,
    operationId: OperationIdSchema,
    label: z.string().min(1).max(160),
    taskSlots: CanonicalTaskTracksSchema,
    arguments: JsonObjectSchema,
    duration: OperationDurationSchema,
    startedAtTick: z.number().int().nonnegative(),
    progressTicks: z.number().int().nonnegative(),
  })
  .strict();

export const ActiveTasksContextSchema = z
  .object({
    tracks: z
      .object({
        HEAD: OperationCallIdSchema.nullable(),
        BODY: OperationCallIdSchema.nullable(),
      })
      .strict(),
    operations: z.array(ActiveOperationContextSchema),
  })
  .strict();
export type ActiveTasksContext = z.infer<typeof ActiveTasksContextSchema>;
