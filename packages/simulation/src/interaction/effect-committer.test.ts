import { describe, expect, it } from "vitest";

import type { EffectProposal } from "@god-sim/plugin-sdk";

import { commitProposal } from "./effect-committer";
import { simulationTestWorld, testPluginRegistry } from "../testing/simulation-test-fixtures";

const metadata = {
  causationId: "interaction-use-fridge" as const,
  correlationId: "goal-use-fridge" as const,
};

describe("commitProposal", () => {
  it("rejects every effect when one effect is invalid", () => {
    const before = simulationTestWorld();
    const proposal: EffectProposal = {
      effects: [
        { type: "set_agent_need", agentId: "alice" as never, need: "bladder", value: 5 },
        {
          type: "reserve_occupancy",
          entityId: "missing-object" as never,
          agentId: "alice" as never,
          expectedObjectVersion: 0,
        },
      ],
    };

    const result = commitProposal(before, testPluginRegistry, proposal, metadata);

    expect(result).toMatchObject({ accepted: false, world: before });
    expect(result.world).toBe(before);
    expect(before.agents.get("alice" as never)?.bladder).toBe(30);
  });

  it("commits validated effects and semantic events atomically", () => {
    const before = simulationTestWorld();
    const proposal: EffectProposal = {
      effects: [
        { type: "set_agent_need", agentId: "alice" as never, need: "bladder", value: 5 },
        {
          type: "reserve_occupancy",
          entityId: "fridge-1" as never,
          agentId: "alice" as never,
          expectedObjectVersion: 0,
        },
      ],
    };

    const result = commitProposal(before, testPluginRegistry, proposal, metadata);

    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.world.version).toBe(1);
    expect(result.world.agents.get("alice" as never)?.bladder).toBe(5);
    expect(result.world.objects.get("fridge-1" as never)).toMatchObject({
      version: 1,
      state: { occupiedBy: "alice" },
    });
    expect(result.events.map((event) => event.type)).toEqual([
      "agent_need_changed",
      "object_state_changed",
    ]);
    expect(before.version).toBe(0);
  });

  it("rejects occupancy for an agent that is not in the world", () => {
    const before = simulationTestWorld();
    const result = commitProposal(
      before,
      testPluginRegistry,
      {
        effects: [
          {
            type: "reserve_occupancy",
            entityId: "fridge-1" as never,
            agentId: "missing-agent" as never,
            expectedObjectVersion: 0,
          },
        ],
      },
      metadata,
    );

    expect(result).toMatchObject({
      accepted: false,
      reason: { code: "unknown_agent" },
      world: before,
    });
  });
});
