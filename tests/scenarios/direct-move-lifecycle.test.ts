import { describe, expect, it, vi } from "vitest";

import homePlugin from "@god-sim/home-objects";
import spatialPlugin from "@god-sim/spatial-objects";
import agentsPlugin from "@god-sim/starter-agents";
import { type DirectOperationReference, type DomainEvent, type EntityId, type OperationCallId } from "@god-sim/protocol";

import {
  createSimulationRegistry,
  loadWorldDefinition,
  prepareDirectOperationCall,
  runTickPipeline,
  OperationTechnicalFailureError,
  type ActiveOperation,
  type ObjectInstance,
  type WorldState,
} from "@god-sim/simulation";
import starterHome from "../../content/worlds/starter-home/world.json" with { type: "json" };
import { testSimulationRulesLock } from "../fixtures/simulation-rules";

const agentId = "alice" as never;
const targetId = "target" as EntityId;
const doorId = "door" as EntityId;
const moveCallId = "operation-call:scenario:move" as OperationCallId;
const useCallId = "operation-call:scenario:use" as OperationCallId;
const registry = createSimulationRegistry([agentsPlugin, spatialPlugin, homePlugin]);

function place(id: string, definitionId: string, x: number, y: number, state: ObjectInstance["state"]): ObjectInstance {
  return { id: id as EntityId, definitionId, version: 0, position: { x, y }, facing: "south", state };
}

function scenario(options: { locked?: boolean; alternative?: boolean; target?: "home.refrigerator" | "home.toilet" } = {}): WorldState {
  const base = loadWorldDefinition(starterHome, registry, { seed: 1, simulationRulesLock: testSimulationRulesLock }).world;
  const objects = new Map<EntityId, ObjectInstance>();
  for (let x = 0; x < base.map.width; x += 1) {
    if (x === 3 || (options.alternative && x === 1)) continue;
    const wall = place(`wall-${x}`, "spatial.wall", x, 2, {});
    objects.set(wall.id, wall);
  }
  const door = place(doorId, "spatial.door", 3, 2, { open: false, locked: options.locked ?? false });
  objects.set(door.id, door);
  const target = place(targetId, options.target ?? "home.refrigerator", 3, 0, { occupiedBy: null });
  objects.set(target.id, target);
  return {
    ...base, objects, mode: "RUNNING",
    agents: new Map([[agentId, { ...base.agents.get(agentId)!, position: { x: 3, y: 4 } }]]),
  };
}

function establish(world: WorldState, reference: DirectOperationReference, callId = moveCallId): WorldState {
  const result = prepareDirectOperationCall(world, registry, agentId, "BODY", reference, callId);
  if (result.kind !== "prepared") throw new Error(`Call preparation failed: ${result.kind}`);
  const agent = world.agents.get(agentId)!;
  expect(agent.taskTracks.BODY).toEqual({ kind: "empty" });
  return {
    ...world,
    agents: new Map(world.agents).set(agentId, {
      ...agent,
      taskTracks: { ...agent.taskTracks, BODY: { kind: "operation", callId } },
      activeOperations: new Map(agent.activeOperations).set(callId, result.operation as unknown as ActiveOperation),
    }),
  };
}

function moveToTarget(world: WorldState): WorldState {
  return establish(world, { kind: "operation", operationId: "core.move" as never, arguments: { targetEntityId: targetId } });
}

function finish(worldInput: WorldState, callId = moveCallId, selectedRegistry = registry) {
  let world = worldInput;
  const events: DomainEvent[] = [];
  for (let tick = 0; tick < 100 && world.agents.get(agentId)!.activeOperations.has(callId); tick += 1) {
    const step = runTickPipeline(world, selectedRegistry);
    world = step.world;
    events.push(...step.events);
  }
  expect(world.agents.get(agentId)!.activeOperations.has(callId)).toBe(false);
  expect(world.agents.get(agentId)!.taskTracks.BODY).toEqual({ kind: "empty" });
  return { world, events };
}

describe("direct move scenarios", () => {
  it.each(["home.refrigerator", "home.toilet"] as const)("moves through a door then independently uses %s", (definitionId) => {
    const initial = moveToTarget(scenario({ target: definitionId }));
    const moved = finish(initial);
    expect(moved.world.agents.get(agentId)!.position).toEqual({ x: 3, y: 1 });
    expect(moved.world.objects.get(doorId)!.state).toEqual({ open: true, locked: false });
    expect(moved.world.objects.get(targetId)).toEqual(initial.objects.get(targetId));
    const facts = moved.events.filter((event) => event.type === "agent_moved");
    expect(facts.map((event) => event.to)).toEqual([{ x: 3, y: 3 }, { x: 3, y: 2 }, { x: 3, y: 1 }]);
    expect(facts.every((event) => event.callId === moveCallId)).toBe(true);
    expect(moved.events.filter((event) => event.type === "operation_result" && event.terminal))
      .toEqual([expect.objectContaining({ callId: moveCallId, outcome: "completed",
        result: { nearby: expect.arrayContaining([expect.objectContaining({ entityId: doorId, summary: "Open door" })]) },
      })]);
    const using = establish(moved.world, {
      kind: "operation", operationId: `object.${definitionId}.use` as never,
      hostEntityId: targetId, arguments: {},
    }, useCallId);
    const started = runTickPipeline(using, registry);
    expect(started.world.objects.get(targetId)!.state).toEqual({ occupiedBy: agentId });
    const used = finish(started.world, useCallId);
    expect(used.world.objects.get(targetId)!.state).toEqual({ occupiedBy: null });
    if (definitionId === "home.toilet") expect(used.world.agents.get(agentId)!.bladder).toBe(5);
    expect(used.events.filter((event) => event.type === "operation_result" && event.terminal))
      .toEqual([expect.objectContaining({ callId: useCallId, outcome: "completed" })]);
    expect(used.events.filter((event) => event.type === "agent_moved")).toEqual([]);
  });

  it("records a locked door with its source event and follows an alternative route under the same callId", () => {
    const initial = moveToTarget(scenario({ locked: true, alternative: true }));
    const result = finish(initial);
    const failure = result.events.find((event) => event.type === "action_failed" && event.entityId === doorId);
    expect(failure).toMatchObject({ reasonCode: "locked", perceivedByAgent: true, correlationId: moveCallId });
    expect(result.world.agents.get(agentId)!.knowledge.knownTraversalBlockers.get(doorId))
      .toMatchObject({ observedObjectVersion: 0, reasonCode: "locked", sourceEventId: failure!.eventId });
    expect(result.world.agents.get(agentId)!.position).toEqual({ x: 3, y: 1 });
    const movements = result.events.filter((event) => event.type === "agent_moved");
    expect(movements.every((event) => event.callId === moveCallId)).toBe(true);
    expect(movements.map((event) => event.to)).toContainEqual({ x: 1, y: 2 });
    expect(movements.map((event) => event.to)).not.toContainEqual({ x: 3, y: 2 });
    expect(result.world.objects).toEqual(initial.objects);
    expect(result.events.filter((event) => event.type === "operation_terminated"))
      .toEqual([expect.objectContaining({ callId: moveCallId, outcome: "completed" })]);
  });

  it("fails only after a locked door leaves no route, preserving prior committed movement", () => {
    const initial = moveToTarget(scenario({ locked: true }));
    const result = finish(initial);
    expect(result.world.agents.get(agentId)!.position).toEqual({ x: 3, y: 3 });
    expect(result.events.filter((event) => event.type === "agent_moved")).toHaveLength(1);
    expect(result.events.filter((event) => event.type === "action_failed")).toHaveLength(1);
    expect(result.events.filter((event) => event.type === "operation_result"))
      .toEqual([expect.objectContaining({ outcome: "failed", result: expect.objectContaining({
        failure: { kind: "domain_failure", code: "no_known_route", details: {} },
        nearby: expect.arrayContaining([expect.objectContaining({ entityId: doorId, summary: "The door is locked" })]),
      }) })]);
    expect(result.events.filter((event) => event.type === "operation_result" && event.terminal)).toHaveLength(1);
    expect(result.world.objects).toEqual(initial.objects);
  });

  it.each(["unknown_target", "no_known_route", "movement_blocked"])("establishes the call before first-step %s failure", (code) => {
    const initial = scenario();
    const objects = new Map(initial.objects);
    if (code === "unknown_target") objects.delete(targetId);
    if (code === "no_known_route") objects.set(doorId, place(doorId, "spatial.wall", 3, 2, {}));
    if (code === "movement_blocked") {
      const getObject = registry.getObject;
      vi.spyOn(registry, "getObject").mockImplementation((id) => {
        const registered = getObject(id);
        return registered && id === "home.refrigerator"
          ? { ...registered, definition: { ...registered.definition, capabilities: [] } }
          : registered;
      });
    }
    const established = moveToTarget({ ...initial, objects });
    expect(established.agents.get(agentId)!.activeOperations.has(moveCallId)).toBe(true);
    const result = runTickPipeline(established, registry);
    expect(result.events.filter((event) => event.type === "operation_result"))
      .toEqual([expect.objectContaining({ outcome: "failed", result: expect.objectContaining({ failure: { kind: "domain_failure", code, details: {} } }) })]);
    expect(result.world.objects).toEqual(established.objects);
    expect(result.world.agents.get(agentId)!.position).toEqual({ x: 3, y: 4 });
    expect(result.world.agents.get(agentId)!.taskTracks.BODY).toEqual({ kind: "empty" });
  });

  it("locks automatic traversal duration once and does not advance it while frozen", () => {
    const interaction = registry.getObject("spatial.door")!.definition.interactions.find((entry) => entry.id === "open")!;
    const duration = vi.spyOn(interaction, "resolveDuration");
    let world = moveToTarget(scenario());
    for (let tick = 0; tick < 3; tick += 1) world = runTickPipeline(world, registry).world;
    const operation = world.agents.get(agentId)!.activeOperations.get(moveCallId)!;
    expect(duration).toHaveBeenCalledTimes(1);
    expect(operation.state).toMatchObject({ movement: { kind: "traversal", progressTicks: 1, durationTicks: 3 } });
    const frozen = runTickPipeline({ ...world, mode: "THINKING" }, registry);
    expect(frozen.events).toEqual([]);
    expect(frozen.world.agents.get(agentId)!.activeOperations.get(moveCallId)).toEqual(operation);
    duration.mockImplementation(() => { throw new Error("Duration must stay locked"); });
    const result = finish({ ...frozen.world, mode: "RUNNING" });
    expect(result.world.agents.get(agentId)!.position).toEqual({ x: 3, y: 1 });
    expect(duration).toHaveBeenCalledTimes(1);
  });

  it("keeps traversal exceptions technical and retains previously committed positions", () => {
    const interaction = registry.getObject("spatial.door")!.definition.interactions.find((entry) => entry.id === "open")!;
    vi.spyOn(interaction, "canStart").mockImplementation(() => { throw new Error("Injected plugin failure"); });
    let world = moveToTarget(scenario());
    world = runTickPipeline(world, registry).world;
    world = runTickPipeline(world, registry).world;
    expect(world.agents.get(agentId)!.position).toEqual({ x: 3, y: 3 });
    expect(() => runTickPipeline(world, registry)).toThrow(OperationTechnicalFailureError);
    expect(world.agents.get(agentId)!.activeOperations.has(moveCallId)).toBe(true);
    expect(world.objects.get(doorId)!.state).toEqual({ open: false, locked: false });
  });
});
