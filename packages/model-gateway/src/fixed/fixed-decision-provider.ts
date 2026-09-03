import {
  TaskDecisionSchema,
  type JsonObject,
  type ModelDecisionRequest,
  type OperationId,
  type TaskDecision,
  type TaskOption,
  type TaskOptionId,
  type TaskSelection,
  type TaskTrack,
} from "@god-sim/protocol";

import type { DecisionProvider } from "../decision-provider";

export type FixedTrackChoice =
  | { readonly kind: "continue" }
  | { readonly kind: "empty" }
  | {
      readonly kind: "operation";
      readonly operationId: OperationId;
      readonly arguments: JsonObject;
    }
  | {
      readonly kind: "option";
      readonly taskOptionId: TaskOptionId;
      readonly arguments: JsonObject;
    };

export interface FixedDecisionTemplate {
  readonly head: FixedTrackChoice;
  readonly body: FixedTrackChoice;
  readonly reason?: string;
}

export interface FixedDecisionRules {
  readonly byRequestId?: Readonly<Record<string, FixedDecisionTemplate>>;
  readonly byAgentAndReason?: Readonly<Record<string, FixedDecisionTemplate>>;
  readonly defaultDecision?: FixedDecisionTemplate;
}

function offeredOnTrack(option: TaskOption, track: TaskTrack): boolean {
  return option.taskSlots.includes(track);
}

function resolveChoice(
  request: ModelDecisionRequest,
  track: TaskTrack,
  choice: FixedTrackChoice,
): TaskSelection {
  if (choice.kind === "continue") return choice;

  let candidates: readonly TaskOption[];
  if (choice.kind === "empty") {
    candidates = request.taskOptions.filter(
      (option) => option.kind === "empty" && offeredOnTrack(option, track),
    );
  } else if (choice.kind === "operation") {
    candidates = request.taskOptions.filter(
      (option) =>
        option.kind === "operation" &&
        option.operationId === choice.operationId &&
        offeredOnTrack(option, track),
    );
  } else {
    candidates = request.taskOptions.filter(
      (option) =>
        option.id === choice.taskOptionId && offeredOnTrack(option, track),
    );
  }

  if (candidates.length === 0) {
    const selector =
      choice.kind === "empty"
        ? "empty task"
        : choice.kind === "operation"
          ? `operation ${choice.operationId}`
          : `task option ${choice.taskOptionId}`;
    throw new Error(`${selector} was not offered on ${track}`);
  }
  if (candidates.length > 1) {
    throw new Error(`Fixed choice for ${track} is ambiguous`);
  }
  return {
    kind: "replace",
    taskOptionId: candidates[0]!.id,
    arguments:
      choice.kind === "empty" ? {} : choice.arguments,
  };
}

export class FixedDecisionProvider implements DecisionProvider {
  readonly #rules: FixedDecisionRules;

  constructor(rules: FixedDecisionRules) {
    this.#rules = rules;
  }

  async decide(
    request: ModelDecisionRequest,
    signal: AbortSignal,
  ): Promise<TaskDecision> {
    if (signal.aborted) throw signal.reason;
    const reasonKey = `${request.agentId}:${request.decisionReason.code}`;
    const template =
      this.#rules.byRequestId?.[request.requestId] ??
      this.#rules.byAgentAndReason?.[reasonKey] ??
      this.#rules.defaultDecision;
    if (!template) {
      throw new Error(`No fixed decision configured for ${request.requestId}`);
    }
    return TaskDecisionSchema.parse({
      schemaVersion: 2,
      head: resolveChoice(request, "HEAD", template.head),
      body: resolveChoice(request, "BODY", template.body),
      reason:
        template.reason ??
        `Fixed decision for ${request.decisionReason.code}`,
    });
  }
}
