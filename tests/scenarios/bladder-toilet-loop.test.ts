import { describe, expect, it } from "vitest";

import {
  adoptTask,
  releaseCommand,
  selectInteraction,
  selectMoveTo,
  selectWait,
  snapshotAgent,
  snapshotObject,
  starterEngine,
} from "./fixtures/fixed-decision-provider";

describe("bladder and toilet loop", () => {
  it("rethinks at the urgent threshold and completes toilet use", () => {
    const engine = starterEngine({
      reviewRequired: true,
      aliceBladder: 74,
      bobBladder: 0,
    });
    adoptTask(engine, "alice" as never, selectWait);
    adoptTask(engine, "bob" as never, selectWait);
    engine.tick();
    engine.dispatch(releaseCommand(engine));
    engine.tick();
    engine.tick();

    expect(engine.getView().pauseReason?.code).toBe("urgent_bladder");
    expect(snapshotAgent(engine, "alice").bladder).toBe(75);

    adoptTask(engine, "alice" as never, selectMoveTo("toilet-1"));
    engine.tick();
    engine.dispatch(releaseCommand(engine));
    let completed = false;
    for (let count = 0; count < 500; count += 1) {
      if (snapshotAgent(engine, "alice").bladder === 5) {
        completed = true;
        break;
      }
      const pending = engine.getPendingDecisionInputs();
      if (pending.length > 0) {
        for (const input of pending) {
          const selector =
            input.agentId === "alice" &&
            input.taskOptions.some(selectInteraction("toilet-1"))
              ? selectInteraction("toilet-1")
              : selectWait;
          adoptTask(engine, input.agentId, selector);
        }
        engine.tick();
        engine.dispatch(releaseCommand(engine));
      }
      engine.tick();
    }

    expect(completed).toBe(true);
    expect(snapshotObject(engine, "toilet-1").state).toEqual({
      occupiedBy: null,
    });
    expect(engine.getView().mode).toBe("THINKING");
  });
});
