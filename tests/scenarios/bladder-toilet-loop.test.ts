import { describe, expect, it } from "vitest";

import {
  adoptTask,
  releaseCommand,
  selectInteraction,
  selectContinue,
  selectWait,
  snapshotAgent,
  snapshotObject,
  starterEngine,
  starterInteractionPosition,
} from "./fixtures/fixed-decision-provider";

describe("bladder and toilet loop", () => {
  it("rethinks at the urgent threshold and completes toilet use", () => {
    const front = starterInteractionPosition("toilet-1");
    const engine = starterEngine({
      reviewRequired: true,
      aliceBladder: 74,
      bobBladder: 0,
      alicePosition: front,
      aliceFacing: "north",
    });
    adoptTask(engine, "alice" as never, selectWait);
    adoptTask(engine, "bob" as never, selectWait);
    engine.tick();
    engine.dispatch(releaseCommand(engine));
    engine.tick();
    engine.tick();

    expect(engine.getView().pauseReason?.code).toBe("urgent_bladder");
    expect(snapshotAgent(engine, "alice").bladder).toBe(75);
    const aliceView = () => engine.getView().entities.find(({ entityId }) => entityId === "alice");
    expect(aliceView()).toMatchObject({ facing: "north", position: front });

    adoptTask(engine, "alice" as never, selectInteraction("toilet-1"));
    engine.tick();
    engine.dispatch(releaseCommand(engine));
    let interactionPose: ReturnType<typeof aliceView>;
    let completed = false;
    for (let count = 0; count < 500; count += 1) {
      if (snapshotAgent(engine, "alice").bladder === 5) {
        completed = true;
        break;
      }
      const pending = engine.getPendingDecisionInputs();
      if (pending.length > 0) {
        for (const input of pending) {
          const selector = input.agentId === "alice" ? selectContinue() : selectWait;
          adoptTask(engine, input.agentId, selector);
        }
        engine.tick();
        engine.dispatch(releaseCommand(engine));
      }
      engine.tick();
      if (!interactionPose) {
        const pose = aliceView();
        if (pose?.status === "interact_object") interactionPose = pose;
      }
    }

    expect(interactionPose).toMatchObject({
      facing: "east", position: front, status: "interact_object",
    });
    expect(completed).toBe(true);
    expect(snapshotObject(engine, "toilet-1").state).toEqual({
      occupiedBy: null,
    });
    expect(engine.getView().mode).toBe("THINKING");
  }, 15_000);
});
