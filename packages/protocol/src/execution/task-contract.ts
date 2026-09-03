import { z } from "zod";

import {
  OperationCallIdSchema,
  OperationIdSchema,
  TaskOptionIdSchema,
} from "../identity/ids";
import { JsonObjectSchema, type JsonObject } from "../json/json-value";

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

export type ResolvedTaskSelection =
  | { readonly kind: "continue" }
  | {
      readonly kind: "empty";
      readonly option: Extract<TaskOption, { kind: "empty" }>;
      readonly arguments: JsonObject;
    }
  | {
      readonly kind: "operation";
      readonly option: Extract<TaskOption, { kind: "operation" }>;
      readonly arguments: JsonObject;
    };

export interface ResolvedTaskDecision {
  readonly normalizedDecision: TaskDecision;
  readonly tracks: Readonly<Record<TaskTrack, ResolvedTaskSelection>>;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalJson(entry)]),
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

export function mergeTaskOptionArguments(
  option: Extract<TaskOption, { kind: "operation" }>,
  value: JsonObject,
): JsonObject {
  for (const [key, fixedValue] of Object.entries(option.fixedArguments)) {
    if (Object.hasOwn(value, key) && !sameJson(value[key], fixedValue)) {
      throw new Error(`Task option ${option.id} cannot change fixed argument ${key}`);
    }
  }
  return JsonObjectSchema.parse({ ...value, ...option.fixedArguments });
}

export function resolveTaskDecision(
  decisionValue: TaskDecision,
  offeredTaskValues: readonly TaskOption[],
): ResolvedTaskDecision {
  const decision = TaskDecisionSchema.parse(decisionValue);
  const offeredTasks = offeredTaskValues.map((option) => TaskOptionSchema.parse(option));
  const optionsById = new Map<string, TaskOption>();
  for (const option of offeredTasks) {
    if (optionsById.has(option.id)) {
      throw new Error(`Duplicate offered task option ID ${option.id}`);
    }
    optionsById.set(option.id, option);
  }

  const resolve = (
    track: TaskTrack,
    selection: TaskSelection,
  ): ResolvedTaskSelection => {
    if (selection.kind === "continue") return selection;
    const option = optionsById.get(selection.taskOptionId);
    if (!option) {
      throw new Error(`Task option ${selection.taskOptionId} was not offered`);
    }
    if (!option.taskSlots.includes(track)) {
      throw new Error(`Task option ${selection.taskOptionId} does not occupy ${track}`);
    }
    if (option.kind === "empty") {
      if (Object.keys(selection.arguments).length > 0) {
        throw new Error(`Empty task option ${selection.taskOptionId} accepts no arguments`);
      }
      return { kind: "empty", option, arguments: {} };
    }
    return {
      kind: "operation",
      option,
      arguments: mergeTaskOptionArguments(option, selection.arguments),
    };
  };

  const tracks = {
    HEAD: resolve("HEAD", decision.head),
    BODY: resolve("BODY", decision.body),
  } as const;
  for (const track of TASK_TRACK_ORDER) {
    const selected = tracks[track];
    if (selected.kind !== "operation" || selected.option.taskSlots.length === 1) {
      continue;
    }
    for (const requiredTrack of selected.option.taskSlots) {
      const peer = tracks[requiredTrack];
      if (
        peer.kind !== "operation" ||
        peer.option.id !== selected.option.id
      ) {
        throw new Error(
          `Task option ${selected.option.id} must be selected on all declared tracks`,
        );
      }
      if (!sameJson(peer.arguments, selected.arguments)) {
        throw new Error(
          `Task option ${selected.option.id} requires the same arguments on every track`,
        );
      }
    }
  }

  const normalizedSelection = (
    selection: ResolvedTaskSelection,
  ): TaskSelection =>
    selection.kind === "continue"
      ? selection
      : {
          kind: "replace",
          taskOptionId: selection.option.id,
          arguments: selection.arguments,
        };

  return {
    normalizedDecision: {
      ...decision,
      head: normalizedSelection(tracks.HEAD),
      body: normalizedSelection(tracks.BODY),
    },
    tracks,
  };
}

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
