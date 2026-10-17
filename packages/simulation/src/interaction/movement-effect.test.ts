import { describe, expect, it } from "vitest";

import { EffectProposalSchema, type Effect, type MoveAgentEffect } from "@god-sim/plugin-sdk";
import { AgentMovedEventSchema, DomainEventSchema, type JsonObject } from "@god-sim/protocol";

import { commitProposal } from "./effect-committer";
import { prepareDirectOperationCall } from "../execution/operation-planner";
import { type ActiveOperation } from "../execution/operation";
import { simulationTestWorld, testPluginRegistry } from "../testing/simulation-test-fixtures";
import { type WorldState } from "../world/world-state";

const agentId = "alice" as never;
const callId = "operation-call:movement-effect" as never;
const metadata = { causationId: "movement:test", correlationId: callId };
const move: MoveAgentEffect = {
  type: "move_agent", agentId, callId, expectedProgressTicks: 1,
  from: { x: 3, y: 2 }, to: { x: 4, y: 2 },
};

function movingWorld(): WorldState {
  const world = simulationTestWorld();
  const prepared = prepareDirectOperationCall(world, testPluginRegistry, agentId, "BODY", {
    kind: "operation", operationId: "core.move" as never, arguments: { targetEntityId: "fridge-1" },
  }, callId);
  if (prepared.kind !== "prepared") throw new Error("Expected a move call");
  const alice = world.agents.get(agentId)!;
  return {
    ...world, tick: 2, mode: "RUNNING",
    agents: new Map(world.agents).set(agentId, {
      ...alice,
      taskTracks: { HEAD: { kind: "empty" }, BODY: { kind: "operation", callId } },
      activeOperations: new Map([[callId, {
        ...prepared.operation, firstStepState: "started", progressTicks: 1,
        state: { ...prepared.operation.state, movement: { kind: "walking", progressTicks: 1 } },
      } as unknown as ActiveOperation]]),
    }),
  };
}

describe("movement effects", () => {
  it("exports strict effect and fact schemas at package roots", () => {
    expect(EffectProposalSchema.parse({ effects: [move] })).toEqual({ effects: [move] });
    expect(EffectProposalSchema.safeParse({ effects: [{ ...move, to: { x: 1.5, y: 2 } }] }).success).toBe(false);
    expect(EffectProposalSchema.safeParse({ effects: [{ ...move, teleport: true }] }).success).toBe(false);
    const result = commitProposal(movingWorld(), testPluginRegistry, { effects: [move] }, metadata);
    if (!result.accepted) throw new Error(result.reason.message);
    expect(AgentMovedEventSchema.parse(result.events[0])).toEqual(result.events[0]);
    expect(DomainEventSchema.parse(result.events[0])).toEqual(result.events[0]);
  });

  it("commits exactly the proposed position and its causal fact together", () => {
    const before = movingWorld();
    const result = commitProposal(before, testPluginRegistry, { effects: [move] }, metadata);
    if (!result.accepted) throw new Error(result.reason.message);
    expect(before.agents.get(agentId)!.position).toEqual(move.from);
    expect(result.world.agents.get(agentId)!.position).toEqual(move.to);
    expect(result.events).toEqual([expect.objectContaining({
      type: "agent_moved", agentId, callId, from: move.from, to: move.to,
      ...metadata, worldTick: before.tick, worldVersion: before.version + 1,
      sequence: before.lastEventSequence + 1,
    })]);
    expect(result.world.lastEventSequence).toBe(before.lastEventSequence + 1);
    const replay = commitProposal(result.world, testPluginRegistry, { effects: [move] }, metadata);
    expect(replay).toMatchObject({ accepted: false, reason: { code: "stale_agent_position" } });
    expect(replay.world).toBe(result.world);
  });

  it.each([
    ["non-adjacent", { to: { x: 5, y: 2 } }, "invalid_movement_step"],
    ["diagonal", { to: { x: 4, y: 3 } }, "invalid_movement_step"],
    ["no movement", { to: move.from }, "invalid_movement_step"],
    ["stale departure", { from: { x: 3, y: 1 } }, "stale_agent_position"],
    ["wall", { to: { x: 2, y: 2 } }, "movement_blocked"],
    ["wrong call", { callId: "operation-call:missing" }, "invalid_movement_call"],
    ["stale progress", { expectedProgressTicks: 0 }, "invalid_movement_call"],
    ["missing actor", { agentId: "missing" }, "invalid_movement_call"],
  ] as const)("rejects %s without changing any world state", (_name, override: JsonObject, code) => {
    const before = movingWorld();
    const effect = EffectProposalSchema.parse({ effects: [{ ...move, ...override }] }).effects[0]!;
    const result = commitProposal(before, testPluginRegistry, { effects: [effect] }, metadata);
    expect(result).toMatchObject({ accepted: false, reason: { code } });
    expect(result.world).toBe(before);
  });

  it("rejects a cell outside the map and a move before its travel time", () => {
    const before = movingWorld();
    const alice = before.agents.get(agentId)!;
    const edge = { ...before, agents: new Map(before.agents).set(agentId, { ...alice, position: { x: 5, y: 2 } }) };
    expect(commitProposal(edge, testPluginRegistry, { effects: [{ ...move, from: { x: 5, y: 2 }, to: { x: 6, y: 2 } }] }, metadata))
      .toMatchObject({ accepted: false, reason: { code: "movement_out_of_bounds" } });
    const operation = alice.activeOperations.get(callId)!;
    const early = { ...before, agents: new Map(before.agents).set(agentId, {
      ...alice, activeOperations: new Map([[callId, { ...operation, progressTicks: 0,
        state: { ...operation.state, movement: { kind: "walking", progressTicks: 0 } },
      }]]),
    }) };
    expect(commitProposal(early, testPluginRegistry, { effects: [{ ...move, expectedProgressTicks: 0 }] }, metadata))
      .toMatchObject({ accepted: false, reason: { code: "movement_too_early" } });
  });

  it("rejects movement in a frozen world", () => {
    const before = { ...movingWorld(), mode: "THINKING" as const };
    const result = commitProposal(before, testPluginRegistry, { effects: [move] }, metadata);
    expect(result).toMatchObject({ accepted: false, reason: { code: "invalid_movement_call" } });
    expect(result.world).toBe(before);
  });

  it.each(["before", "after"])("rolls back movement when another effect %s it is invalid", (order) => {
    const before = movingWorld();
    const invalid: Effect = {
      type: "reserve_occupancy", agentId, entityId: "missing" as never, expectedObjectVersion: 0,
    };
    const result = commitProposal(before, testPluginRegistry,
      { effects: order === "before" ? [invalid, move] : [move, invalid] }, metadata);
    expect(result.accepted).toBe(false);
    expect(result.world.agents.get(agentId)!.position).toEqual(move.from);
    expect(result.world).toEqual(before);
    expect(before.agents.get(agentId)!.position).toEqual(move.from);
    expect(result).not.toHaveProperty("events");
  });

  it("rejects multiple movements in one proposal atomically", () => {
    const before = movingWorld();
    const result = commitProposal(before, testPluginRegistry, { effects: [move, { ...move, from: move.to, to: move.from }] }, metadata);
    expect(result).toMatchObject({ accepted: false, reason: { code: "duplicate_movement_effect" } });
    expect(result.world).toBe(before);
  });
});
