import { describe, expect, it } from "vitest";

import {
  adoptTask,
  releaseCommand,
  runUntil,
  selectMoveTo,
  selectWait,
  snapshotAgent,
  starterEngine,
} from "./fixtures/fixed-decision-provider";

describe("thinking pause", () => {
  it("preserves the other agent's action progress while one agent rethinks", () => {
    const engine = starterEngine({ reviewRequired: true });
    adoptTask(engine, "alice" as never, selectMoveTo("fridge-1"));
    adoptTask(engine, "bob" as never, selectMoveTo("fridge-1"));
    engine.tick();
    engine.dispatch(releaseCommand(engine));
    runUntil(
      engine,
      (candidate) =>
        candidate.getView().mode === "THINKING" &&
        candidate.getView().worldTick > 0,
    );

    const pending = engine.getPendingDecisionInputs()[0];
    if (!pending) throw new Error("Expected a completed operation decision");
    const continuingAgentId = pending.agentId === "alice" ? "bob" : "alice";
    const before = snapshotAgent(engine, continuingAgentId).activeOperations;
    const beforeTick = engine.getView().worldTick;
    for (let count = 0; count < 5; count += 1) engine.tick();

    expect(engine.getView().worldTick).toBe(beforeTick);
    expect(snapshotAgent(engine, continuingAgentId).activeOperations).toEqual(before);

    adoptTask(engine, pending.agentId, selectWait);
    engine.tick();
    engine.dispatch(releaseCommand(engine));
    engine.tick();

    expect(engine.getView().mode).toBe("RUNNING");
    expect(snapshotAgent(engine, continuingAgentId).activeOperations.length)
      .toBeGreaterThan(0);
  });
});
