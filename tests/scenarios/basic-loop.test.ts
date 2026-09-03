import { describe, expect, it } from "vitest";

import {
  adoptTask,
  releaseCommand,
  runUntil,
  selectMoveTo,
  starterEngine,
} from "./fixtures/fixed-decision-provider";

describe("basic headless loop", () => {
  it("freezes, adopts tasks, runs, and freezes when an operation completes", () => {
    const engine = starterEngine({ reviewRequired: true });

    expect(engine.getView()).toMatchObject({ mode: "THINKING", worldTick: 0 });
    expect(engine.getPendingDecisionInputs()).toHaveLength(2);

    adoptTask(engine, "alice" as never, selectMoveTo("fridge-1"));
    adoptTask(engine, "bob" as never, selectMoveTo("fridge-1"));
    engine.tick();

    expect(engine.getView()).toMatchObject({ mode: "READY_FOR_RELEASE", worldTick: 0 });
    engine.dispatch(releaseCommand(engine));
    runUntil(
      engine,
      (candidate) =>
        candidate.getView().mode === "THINKING" &&
        candidate.getView().worldTick > 0,
    );

    const paused = engine.getView();
    expect(paused.mode).toBe("THINKING");
    expect(paused.worldTick).toBeGreaterThan(0);
    expect(paused.pauseReason?.code).toBe("operation_completed");
    expect(paused.pauseReason?.agentIds.length).toBeGreaterThan(0);
    expect(engine.getPendingDecisionInputs().length).toBeGreaterThan(0);
  });
});
