import { describe, expect, it } from "vitest";

import {
  adoptGoal,
  releaseCommand,
  runUntil,
  selectUseObject,
  starterEngine,
} from "./fixtures/fixed-decision-provider";

describe("basic headless loop", () => {
  it("freezes, adopts goals, runs, perceives a conflict, and freezes again", () => {
    const engine = starterEngine({ reviewRequired: true });

    expect(engine.getView()).toMatchObject({ mode: "THINKING", worldTick: 0 });
    expect(engine.getPendingDecisionInputs()).toHaveLength(2);

    adoptGoal(engine, "alice" as never, selectUseObject("fridge-1"));
    adoptGoal(engine, "bob" as never, selectUseObject("fridge-1"));
    engine.tick();

    expect(engine.getView()).toMatchObject({ mode: "READY_FOR_RELEASE", worldTick: 0 });
    engine.dispatch(releaseCommand(engine));
    runUntil(
      engine,
      (candidate) => candidate.getView().pauseReason?.code === "perceived_goal_conflict",
    );

    const paused = engine.getView();
    expect(paused.mode).toBe("THINKING");
    expect(paused.worldTick).toBeGreaterThan(0);
    expect(paused.pauseReason?.agentIds).toEqual(["alice"]);
    expect(engine.getPendingDecisionInputs()).toHaveLength(1);
  });
});

