import {
  DirectTaskDecisionSchema,
  type JsonObject,
  type ModelDecisionRequest,
  type ModelDecisionProposal,
  type OperationId,
} from "@god-sim/protocol";

import type { DecisionProvider } from "../decision-provider";

export type FixedTrackChoice =
  | { readonly kind: "continue" }
  | { readonly kind: "empty" }
  | {
      readonly kind: "operation";
      readonly operationId: OperationId;
      readonly hostEntityId?: string;
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

export class FixedDecisionProvider implements DecisionProvider {
  readonly #rules: FixedDecisionRules;

  constructor(rules: FixedDecisionRules) {
    this.#rules = rules;
  }

  async decide(
    request: ModelDecisionRequest,
    signal: AbortSignal,
  ): Promise<ModelDecisionProposal> {
    if (signal.aborted) throw signal.reason;
    const reasonKey = `${request.agentId}:${request.decisionReason.code}`;
    const template =
      this.#rules.byRequestId?.[request.requestId] ??
      this.#rules.byAgentAndReason?.[reasonKey] ??
      this.#rules.defaultDecision;
    if (!template) {
      throw new Error(`No fixed decision configured for ${request.requestId}`);
    }
    const directChoice = (choice: FixedTrackChoice) => {
      if (choice.kind === "continue") return choice;
      if (choice.kind === "empty") {
        return { kind: "replace" as const, task: { kind: "empty_task" as const } };
      }
      return {
        kind: "replace" as const,
        task: {
          kind: "operation" as const,
          operationId: choice.operationId,
          ...(choice.hostEntityId === undefined ? {} : { hostEntityId: choice.hostEntityId }),
          arguments: choice.arguments,
        },
      };
    };
    return DirectTaskDecisionSchema.parse({
      schemaVersion: 3,
      head: directChoice(template.head),
      body: directChoice(template.body),
      reason:
        template.reason ??
        `Fixed decision for ${request.decisionReason.code}`,
    });
  }
}
