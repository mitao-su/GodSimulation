import { describe, expect, it } from "vitest";

import {
  adoptGoal,
  releaseCommand,
  runUntil,
  selectUseObject,
  selectWait,
  snapshotAgent,
  starterEngine,
} from "./fixtures/fixed-decision-provider";

describe("thinking pause", () => {
  it("preserves the other agent's action progress while one agent rethinks", () => {
    const engine = starterEngine({ reviewRequired: true });
    adoptGoal(engine, "alice" as never, selectUseObject("fridge-1"));
    adoptGoal(engine, "bob" as never, selectUseObject("fridge-1"));
    engine.tick();
    engine.dispatch(releaseCommand(engine));
    runUntil(
      engine,
      (candidate) => candidate.getView().pauseReason?.code === "perceived_goal_conflict",
    );

    const before = snapshotAgent(engine, "bob").actionPlan;
    const beforeTick = engine.getView().worldTick;
    for (let count = 0; count < 5; count += 1) engine.tick();

    expect(engine.getView().worldTick).toBe(beforeTick);
    expect(snapshotAgent(engine, "bob").actionPlan).toEqual(before);

    adoptGoal(engine, "alice" as never, selectWait);
    engine.tick();
    engine.dispatch(releaseCommand(engine));
    engine.tick();

    expect(engine.getView().mode).toBe("RUNNING");
    expect(snapshotAgent(engine, "bob").actionPlan).not.toBeNull();
  });
});
