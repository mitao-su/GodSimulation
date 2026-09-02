import {
  ModelDecisionResultSchema,
  TaskDecisionSchema,
  TechnicalFailureSchema,
  type ModelDecisionRequest,
  type ModelDecisionResult,
  type TaskDecision,
  type TaskOption,
  type TaskTrack,
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

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalJson(entry)]),
  );
}

function sameArguments(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function validateProposal(
  request: ModelDecisionRequest,
  value: TaskDecision,
): TaskDecision {
  const proposal = TaskDecisionSchema.parse(value);
  const selected = new Map<TaskTrack, TaskOption>();
  for (const [track, selection] of [
    ["HEAD", proposal.head],
    ["BODY", proposal.body],
  ] as const) {
    if (selection.kind === "continue") continue;
    const option = request.taskOptions.find(
      (candidate) => candidate.id === selection.taskOptionId,
    );
    if (!option) {
      throw new Error(`Task option ${selection.taskOptionId} was not offered`);
    }
    if (!option.taskSlots.includes(track)) {
      throw new Error(`Task option ${selection.taskOptionId} does not occupy ${track}`);
    }
    if (option.kind === "empty" && Object.keys(selection.arguments).length > 0) {
      throw new Error(`Empty task option ${selection.taskOptionId} accepts no arguments`);
    }
    selected.set(track, option);
  }

  for (const [track, option] of selected) {
    if (option.taskSlots.length === 1) continue;
    const selection = track === "HEAD" ? proposal.head : proposal.body;
    if (selection.kind !== "replace") continue;
    for (const requiredTrack of option.taskSlots) {
      const peer = requiredTrack === "HEAD" ? proposal.head : proposal.body;
      const peerOption = selected.get(requiredTrack);
      if (
        peer.kind !== "replace" ||
        peerOption?.id !== option.id ||
        !sameArguments(peer.arguments, selection.arguments)
      ) {
        throw new Error(
          `Task option ${option.id} must use the same arguments on all declared tracks`,
        );
      }
    }
  }
  return proposal;
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
      let proposal: TaskDecision;
      try {
        proposal = validateProposal(
          request,
          await this.#provider.decide(request, controller.signal),
        );
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
