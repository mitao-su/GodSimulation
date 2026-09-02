import { describe, expect, it } from "vitest";

import { restoreSimulation, type SimulationEngine } from "@god-sim/simulation";
import homePlugin from "@god-sim/home-objects";
import spatialPlugin from "@god-sim/spatial-objects";
import agentsPlugin from "@god-sim/starter-agents";

import starterHome from "../../content/worlds/starter-home/world.json" with { type: "json" };
import { testSimulationRulesLock } from "../fixtures/simulation-rules";

import {
  adoptTask,
  selectWait,
  starterEngine,
} from "./fixtures/fixed-decision-provider";

function blockForRetry(engine: SimulationEngine): string {
  const failureId = "failure:persistence:retry-test";
  const blocked = engine.reportTechnicalFailure({
    id: failureId,
    category: "persistence",
    message: "disk unavailable",
    retryable: true,
    occurredAtRealTime: "2026-08-31T00:00:00.000Z",
  });
  if (!blocked.accepted) throw new Error(blocked.reason);
  return failureId;
}

function retry(engine: SimulationEngine, failureId: string): void {
  const view = engine.getView();
  const queued = engine.dispatch({
    schemaVersion: 1,
    commandId: `command:retry:${view.worldVersion}` as never,
    worldId: view.worldId,
    expectedWorldVersion: view.worldVersion,
    issuedAtRealTime: "2026-08-31T00:00:01.000Z",
    type: "retry_technical_failure",
    failureId,
  });
  if (!queued.accepted) throw new Error(queued.reason);
  engine.tick();
}

describe("technical failure retry", () => {
  it("restores a thinking world to the same frozen mode", () => {
    const engine = starterEngine();
    const failureId = blockForRetry(engine);

    retry(engine, failureId);

    expect(engine.getView()).toMatchObject({
      mode: "THINKING",
      worldTick: 0,
      technicalFailure: null,
    });
  });

  it("restores a running world instead of forcing it into thinking", () => {
    const engine = starterEngine({ reviewRequired: false });
    adoptTask(engine, "alice" as never, selectWait);
    adoptTask(engine, "bob" as never, selectWait);
    engine.tick();
    expect(engine.getView().mode).toBe("RUNNING");
    const failureId = blockForRetry(engine);

    retry(engine, failureId);

    expect(engine.getView()).toMatchObject({
      mode: "RUNNING",
      technicalFailure: null,
    });
  });

  it("restores and retries a snapshot blocked while the world was running", () => {
    const engine = starterEngine({ reviewRequired: false });
    adoptTask(engine, "alice" as never, selectWait);
    adoptTask(engine, "bob" as never, selectWait);
    engine.tick();
    const failureId = blockForRetry(engine);

    const restored = restoreSimulation({
      snapshot: engine.createSnapshot(),
      worldDefinition: starterHome,
      plugins: [spatialPlugin, homePlugin, agentsPlugin],
      simulationRulesLock: testSimulationRulesLock,
    });
    retry(restored, failureId);

    expect(restored.getView()).toMatchObject({
      mode: "RUNNING",
      technicalFailure: null,
    });
  });

  it("does not release a blocked ready world until persistence recovery succeeds", () => {
    const engine = starterEngine({ reviewRequired: true });
    adoptTask(engine, "alice" as never, selectWait);
    adoptTask(engine, "bob" as never, selectWait);
    engine.tick();
    expect(engine.getView().mode).toBe("READY_FOR_RELEASE");
    const failureId = blockForRetry(engine);
    const blocked = engine.getView();

    const queued = engine.dispatch({
      schemaVersion: 1,
      commandId: "command:disable-review:blocked" as never,
      worldId: blocked.worldId,
      expectedWorldVersion: blocked.worldVersion,
      issuedAtRealTime: "2026-08-31T00:00:01.000Z",
      type: "set_review_mode",
      enabled: false,
    });
    if (!queued.accepted) throw new Error(queued.reason);
    engine.tick();

    expect(engine.getView()).toMatchObject({
      mode: "TECHNICALLY_BLOCKED",
      reviewRequired: false,
      technicalFailure: { id: failureId },
    });

    retry(engine, failureId);

    expect(engine.getView()).toMatchObject({
      mode: "RUNNING",
      reviewRequired: false,
      technicalFailure: null,
    });
  });
});
