import {
  GoalProposalSchema,
  ModelDecisionResultSchema,
  TechnicalFailureSchema,
  type ModelDecisionRequest,
  type ModelDecisionResult,
  type TechnicalFailure,
} from "@god-sim/protocol";
import type { DecisionProvider } from "@god-sim/model-gateway";

import type { PersistenceWriter } from "../persistence/persistence-writer";

export type CoordinatedDecision =
  | { readonly type: "result"; readonly result: ModelDecisionResult }
  | { readonly type: "failure"; readonly failure: TechnicalFailure }
  | { readonly type: "cancelled" };

export type CompletedDecision = Exclude<CoordinatedDecision, { readonly type: "cancelled" }>;

export class DecisionPersistenceError extends Error {
  readonly outcome: CompletedDecision;

  constructor(cause: unknown, outcome: CompletedDecision) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "DecisionPersistenceError";
    this.outcome = outcome;
  }
}

export interface DecisionRequestCoordinatorOptions {
  readonly provider: DecisionProvider;
  readonly persistence: PersistenceWriter;
  readonly modelId: string;
  readonly now: () => string;
  readonly monotonicNow?: () => number;
}

export class DecisionRequestCoordinator {
  readonly #provider: DecisionProvider;
  readonly #persistence: PersistenceWriter;
  readonly #modelId: string;
  readonly #now: () => string;
  readonly #monotonicNow: () => number;
  readonly #controllers = new Map<string, AbortController>();

  constructor(options: DecisionRequestCoordinatorOptions) {
    this.#provider = options.provider;
    this.#persistence = options.persistence;
    this.#modelId = options.modelId;
    this.#now = options.now;
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now());
  }

  async decide(request: ModelDecisionRequest): Promise<CoordinatedDecision> {
    if (this.#controllers.has(request.requestId)) {
      throw new Error(`Decision request ${request.requestId} is already in flight`);
    }
    const controller = new AbortController();
    this.#controllers.set(request.requestId, controller);
    const startedAt = this.#monotonicNow();
    try {
      let proposal: ReturnType<typeof GoalProposalSchema.parse>;
      try {
        proposal = GoalProposalSchema.parse(
          await this.#provider.decide(request, controller.signal),
        );
        if (!request.goalOptions.some((option) => option.id === proposal.goalOptionId)) {
          throw new Error(`Goal option ${proposal.goalOptionId} was not offered`);
        }
      } catch (error) {
        if (controller.signal.aborted) return { type: "cancelled" };
        const message = error instanceof Error ? error.message : String(error);
        const failure = TechnicalFailureSchema.parse({
          id: `failure:model:${request.requestId}`,
          category: "model",
          message: message.slice(0, 2_000),
          requestId: request.requestId,
          retryable: true,
          occurredAtRealTime: this.#now(),
        });
        const outcome: CompletedDecision = { type: "failure", failure };
        try {
          await this.#persistence.saveModelCall({
            requestId: request.requestId,
            worldId: request.worldId,
            worldVersion: request.worldVersion,
            agentId: request.agentId,
            modelId: this.#modelId,
            status: "failed",
            goalOptionId: null,
            responseReason: failure.message,
            latencyMs: Math.max(0, Math.round(this.#monotonicNow() - startedAt)),
            retryOfRequestId: request.retryOfRequestId ?? null,
            recordedAtRealTime: failure.occurredAtRealTime,
          });
        } catch (persistenceError) {
          try {
            await this.#persistence.recordFailure(request.worldId, failure);
          } catch {
            // The blocked writer retains this operation behind the failed model record.
          }
          throw new DecisionPersistenceError(persistenceError, outcome);
        }
        try {
          await this.#persistence.recordFailure(request.worldId, failure);
        } catch (persistenceError) {
          throw new DecisionPersistenceError(persistenceError, outcome);
        }
        return outcome;
      }

      const result = ModelDecisionResultSchema.parse({
        requestId: request.requestId,
        agentId: request.agentId,
        worldId: request.worldId,
        worldVersion: request.worldVersion,
        decisionCycleId: request.decisionCycleId,
        schemaVersion: request.schemaVersion,
        pluginLockHash: request.pluginLockHash,
        ...(request.retryOfRequestId === undefined
          ? {}
          : { retryOfRequestId: request.retryOfRequestId }),
        proposal,
      });
      const outcome: CompletedDecision = { type: "result", result };
      try {
        await this.#persistence.saveModelCall({
          requestId: request.requestId,
          worldId: request.worldId,
          worldVersion: request.worldVersion,
          agentId: request.agentId,
          modelId: this.#modelId,
          status: "accepted",
          goalOptionId: proposal.goalOptionId,
          responseReason: proposal.reason,
          latencyMs: Math.max(0, Math.round(this.#monotonicNow() - startedAt)),
          retryOfRequestId: request.retryOfRequestId ?? null,
          recordedAtRealTime: this.#now(),
        });
      } catch (persistenceError) {
        throw new DecisionPersistenceError(persistenceError, outcome);
      }
      return outcome;
    } finally {
      this.#controllers.delete(request.requestId);
    }
  }

  cancelAll(reason = "Session stopped"): void {
    for (const controller of this.#controllers.values()) controller.abort(new Error(reason));
  }
}
