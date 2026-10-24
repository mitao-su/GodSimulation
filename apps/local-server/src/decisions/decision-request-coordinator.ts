import {
  DirectTaskDecisionSchema,
  ModelDecisionResultSchema,
  TechnicalFailureSchema,
  type ModelDecisionProposal,
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
  /** 单个冻结请求允许的完整模型重答次数。 */
  readonly maxAttempts?: number;
}

function validateProposal(
  _request: ModelDecisionRequest,
  value: ModelDecisionProposal,
): ModelDecisionProposal {
  const direct = DirectTaskDecisionSchema.safeParse(value);
  if (!direct.success) {
    throw new Error(
      "Model returned a legacy task decision; production requests require a direct task decision",
    );
  }
  return direct.data;
}

export class DecisionRequestCoordinator {
  readonly #provider: DecisionProvider;
  readonly #persistence: PersistenceWriter;
  readonly #modelId: string;
  readonly #now: () => string;
  readonly #monotonicNow: () => number;
  readonly #maxAttempts: number;
  readonly #controllers = new Map<string, AbortController>();
  readonly #attempts = new Map<string, number>();
  readonly #persistedRequests = new Set<string>();

  constructor(options: DecisionRequestCoordinatorOptions) {
    this.#provider = options.provider;
    this.#persistence = options.persistence;
    this.#modelId = options.modelId;
    this.#now = options.now;
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now());
    const maxAttempts = options.maxAttempts ?? 3;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new Error("Decision correction maxAttempts must be a positive integer");
    }
    this.#maxAttempts = maxAttempts;
  }

  async decide(
    request: ModelDecisionRequest,
    correctionFeedback?: string,
  ): Promise<CoordinatedDecision> {
    if (this.#controllers.has(request.requestId)) {
      throw new Error(`Decision request ${request.requestId} is already in flight`);
    }
    const controller = new AbortController();
    this.#controllers.set(request.requestId, controller);
    const startedAt = this.#monotonicNow();
    try {
      const previousAttempts = this.#attempts.get(request.requestId) ?? 0;
      let proposal: ModelDecisionProposal | null = null;
      let lastError: unknown = correctionFeedback ?? null;
      for (let attempt = previousAttempts + 1; attempt <= this.#maxAttempts; attempt += 1) {
        this.#attempts.set(request.requestId, attempt);
        const attemptRequest: ModelDecisionRequest = correctionFeedback === undefined && attempt === 1
          ? request
          : {
              ...request,
              messages: [
                ...request.messages,
                {
                  role: "user",
                  content: [
                    "[TEMPORARY VALIDATION FEEDBACK]",
                    String(lastError ?? "The previous response was invalid."),
                    "Return the complete head/body/goalUpdates decision again. Do not return only a corrected field.",
                  ].join("\n"),
                },
              ],
            };
        try {
          proposal = validateProposal(
            request,
            await this.#provider.decide(attemptRequest, controller.signal),
          );
          break;
        } catch (error) {
          if (controller.signal.aborted) return { type: "cancelled" };
          lastError = error;
        }
      }

      if (proposal === null) {
        const message = lastError instanceof Error
          ? lastError.message
          : String(lastError ?? "unknown validation error");
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
          if (!this.#persistedRequests.has(request.requestId)) {
            await this.#persistence.saveModelCall({
              requestId: request.requestId,
              worldId: request.worldId,
              worldVersion: request.worldVersion,
              agentId: request.agentId,
              protocolSchemaVersion: request.schemaVersion,
              decisionCycleId: request.decisionCycleId,
              pluginLockHash: request.pluginLockHash,
              decisionReasonCode: request.decisionReason.code,
              modelId: this.#modelId,
              status: "failed",
              taskDecision: null,
              responseReason: failure.message,
              latencyMs: Math.max(0, Math.round(this.#monotonicNow() - startedAt)),
              retryOfRequestId: request.retryOfRequestId ?? null,
              recordedAtRealTime: failure.occurredAtRealTime,
            });
            this.#persistedRequests.add(request.requestId);
          }
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
        if (!this.#persistedRequests.has(request.requestId)) {
          await this.#persistence.saveModelCall({
            requestId: request.requestId,
            worldId: request.worldId,
            worldVersion: request.worldVersion,
            agentId: request.agentId,
            protocolSchemaVersion: request.schemaVersion,
            decisionCycleId: request.decisionCycleId,
            pluginLockHash: request.pluginLockHash,
            decisionReasonCode: request.decisionReason.code,
            modelId: this.#modelId,
            status: "accepted",
            taskDecision: proposal,
            responseReason: proposal.reason,
            latencyMs: Math.max(0, Math.round(this.#monotonicNow() - startedAt)),
            retryOfRequestId: request.retryOfRequestId ?? null,
            recordedAtRealTime: this.#now(),
          });
          this.#persistedRequests.add(request.requestId);
        }
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
