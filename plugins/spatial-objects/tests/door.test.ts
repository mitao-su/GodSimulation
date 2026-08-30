import { describe, expect, it } from "vitest";

import { InteractionContextSchema, ObservationContextSchema } from "@god-sim/plugin-sdk";

import { doorDefinition } from "../src/objects/door/definition";

const context = InteractionContextSchema.parse({
  worldTick: 5,
  trigger: "active_command",
  object: { entityId: "door-1", version: 0 },
  actor: {
    agentId: "alice",
    position: { x: 2, y: 2 },
    needs: { bladder: 20 },
  },
  distance: 1,
});

const visionContext = ObservationContextSchema.parse({
  kind: "vision",
  observerAgentId: "alice",
});

function interaction(id: string) {
  const found = doorDefinition.interactions.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing door interaction: ${id}`);
  return found;
}

describe("door definition", () => {
  it("offers four independent interactions", () => {
    expect(doorDefinition.interactions.map((candidate) => candidate.id)).toEqual([
      "open",
      "close",
      "lock",
      "unlock",
    ]);
  });

  it("proposes opening without mutating the supplied state", () => {
    const state = Object.freeze({ open: false, locked: false });
    const result = interaction("open").complete(state, context);

    expect(result.effects).toContainEqual({
      type: "replace_object_state",
      entityId: "door-1",
      expectedObjectVersion: 0,
      state: { open: true, locked: false },
    });
    expect(state).toEqual({ open: false, locked: false });
  });

  it("reports a locked door without exposing it through normal observation", () => {
    const state = Object.freeze({ open: false, locked: true });
    expect(interaction("open").canStart(state, context)).toMatchObject({
      available: false,
      reasonCode: "locked",
    });
    expect(doorDefinition.observe(state, visionContext)).toEqual({
      status: "closed",
      summary: "Closed door",
      details: { open: false },
    });
  });
});
