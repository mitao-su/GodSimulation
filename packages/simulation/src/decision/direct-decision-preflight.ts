import type {
  AgentId,
  DirectTaskDecision,
  JsonObject,
  TaskTrack,
} from "@god-sim/protocol";

import {
  createOperationRuntimeContext,
  type HostedOperationRuntimeRegistry,
  type ResolvedOperationReference,
} from "../execution/operation-runtime";
import type { WorldState } from "../world/world-state";
import {
  validateGoalUpdates,
  type GoalUpdateValidator,
} from "./goal-update-validator";

const TASK_TRACKS = ["HEAD", "BODY"] as const;

export type DirectDecisionPreflightResult =
  | {
      readonly kind: "valid";
      readonly bindings: Readonly<
        Record<TaskTrack, ResolvedOperationReference | null>
      >;
    }
  | { readonly kind: "invalid"; readonly reason: string };

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

export function directOperationBindingKey(binding: {
  readonly runtime: { readonly id: string };
  readonly host: unknown;
  readonly arguments: JsonObject;
}): string {
  return JSON.stringify(
    canonicalJson({
      operationId: binding.runtime.id,
      host: binding.host,
      arguments: binding.arguments,
    }),
  );
}

export function preflightDirectDecision(
  world: WorldState,
  registry: HostedOperationRuntimeRegistry,
  agentId: AgentId,
  proposal: DirectTaskDecision,
  goalUpdateValidator?: GoalUpdateValidator,
): DirectDecisionPreflightResult {
  const agent = world.agents.get(agentId);
  if (!agent) return { kind: "invalid", reason: `Unknown agent instance: ${agentId}` };
  const goalUpdateError = validateGoalUpdates(
    goalUpdateValidator,
    world,
    agentId,
    proposal.goalUpdates,
  );
  if (goalUpdateError) return { kind: "invalid", reason: goalUpdateError };

  const selections = { HEAD: proposal.head, BODY: proposal.body } as const;
  for (const operation of agent.activeOperations.values()) {
    if (operation.taskSlots.length < 2) continue;
    const replacementCount = operation.taskSlots.filter(
      (track) => selections[track].kind === "replace",
    ).length;
    if (replacementCount > 0 && replacementCount !== operation.taskSlots.length) {
      return {
        kind: "invalid",
        reason: `Existing synchronized call ${operation.callId} must be replaced on every occupied track`,
      };
    }
  }

  const context = createOperationRuntimeContext(world, registry, agentId);
  const bindings: Record<TaskTrack, ResolvedOperationReference | null> = {
    HEAD: null,
    BODY: null,
  };
  for (const track of TASK_TRACKS) {
    const selection = selections[track];
    if (selection.kind !== "replace" || selection.task.kind !== "operation") {
      continue;
    }
    const resolved = registry.resolveOperationReference(
      context,
      track,
      selection.task,
    );
    if (resolved.kind === "invalid_reference") {
      return { kind: "invalid", reason: resolved.message };
    }
    bindings[track] = resolved.binding;
  }

  for (const track of TASK_TRACKS) {
    const binding = bindings[track];
    if (!binding || binding.runtime.taskSlots.length < 2) continue;
    for (const requiredTrack of binding.runtime.taskSlots) {
      const peer = bindings[requiredTrack];
      if (
        !peer ||
        peer.runtime.id !== binding.runtime.id ||
        !sameJson(peer.host, binding.host) ||
        !sameJson(peer.arguments, binding.arguments)
      ) {
        return {
          kind: "invalid",
          reason: `Operation ${binding.runtime.id} must be selected with the same host and normalized arguments on all declared tracks`,
        };
      }
    }
  }

  return { kind: "valid", bindings };
}
