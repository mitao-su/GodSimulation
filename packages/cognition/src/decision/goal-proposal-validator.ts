import {
  TaskDecisionSchema,
  TaskOptionSchema,
  type JsonObject,
  type TaskDecision,
  type TaskOption,
  type TaskTrack,
} from "@god-sim/protocol";

export type ResolvedTaskSelection =
  | { readonly kind: "continue" }
  | {
      readonly kind: "replace";
      readonly option: TaskOption;
      readonly arguments: JsonObject;
    };

export type ResolvedTaskDecision = Readonly<
  Record<TaskTrack, ResolvedTaskSelection>
>;

export function resolveTaskDecision(
  decisionValue: TaskDecision,
  offeredTaskValues: readonly TaskOption[],
): ResolvedTaskDecision {
  const decision = TaskDecisionSchema.parse(decisionValue);
  const offeredTasks = offeredTaskValues.map((option) => TaskOptionSchema.parse(option));
  const duplicateIds = offeredTasks.filter(
    (option, index) => offeredTasks.findIndex((candidate) => candidate.id === option.id) !== index,
  );
  if (duplicateIds.length > 0) {
    throw new Error(`Duplicate offered task option ID ${duplicateIds[0]!.id}`);
  }

  const resolve = (
    track: TaskTrack,
    selection: TaskDecision["head"] | TaskDecision["body"],
  ): ResolvedTaskSelection => {
    if (selection.kind === "continue") return selection;
    const original = offeredTaskValues.find(
      (option) => option.id === selection.taskOptionId,
    );
    if (!original) {
      throw new Error(`Task option ${selection.taskOptionId} was not offered`);
    }
    if (!original.taskSlots.includes(track)) {
      throw new Error(`Task option ${selection.taskOptionId} does not occupy ${track}`);
    }
    return {
      kind: "replace",
      option: original,
      arguments: selection.arguments,
    };
  };

  return {
    HEAD: resolve("HEAD", decision.head),
    BODY: resolve("BODY", decision.body),
  };
}
