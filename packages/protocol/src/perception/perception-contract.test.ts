import { describe, expect, it } from "vitest";

import {
  AgentVisualSnapshotSchema,
  MovementTrajectorySchema,
  NearbyObservationSchema,
  PerceptionNowSchema,
} from "./perception-contract";
import {
  SoundPropagationInputSchema,
  SoundPropagationResultSchema,
} from "./sound-contract";

describe("L2 perception contracts", () => {
  it("keeps trajectory data ordered without requiring one-cell ticks", () => {
    const trajectory = {
      points: [
        { position: { x: 1, y: 1 }, facing: "east" },
        { position: { x: 3, y: 1 }, facing: "east" },
        { position: { x: 3, y: 2 }, facing: "south" },
      ],
    } as const;
    expect(MovementTrajectorySchema.parse(trajectory)).toEqual(trajectory);
  });

  it("allows public clothing and behavior in nearby while excluding private clothing", () => {
    const nearby = {
      kind: "agent",
      entityId: "bob",
      category: "person",
      summary: "Bob is moving nearby",
      publicBehavior: { kind: "visible", label: "moving" },
      externallyVisible: {
        head: "brown hair",
        upperBody: "white shirt",
        lowerBody: "blue trousers",
      },
    } as const;
    expect(NearbyObservationSchema.parse(nearby)).toEqual(nearby);
    expect(
      NearbyObservationSchema.safeParse({
        kind: "agent",
        entityId: "bob",
        category: "person",
        summary: "Bob is moving nearby",
      }).success,
    ).toBe(false);
    expect(
      NearbyObservationSchema.safeParse({
        kind: "object",
        entityId: "fridge",
        category: "appliance",
        summary: "A refrigerator is nearby",
      }).success,
    ).toBe(true);
    expect(
      NearbyObservationSchema.safeParse({
        ...nearby,
        internallyHidden: { head: "private", upperBody: "private", lowerBody: "private" },
      }).success,
    ).toBe(false);
  });

  it("keeps perception_now coordinate-free", () => {
    const now = {
      visibleEntities: [
        {
          kind: "agent",
          agent: {
            agentId: "bob",
            displayName: "Bob",
            direction: "front_left",
            distanceBand: "near",
            publicBehavior: { kind: "visible", label: "moving" },
            externallyVisible: {
              head: "brown hair",
              upperBody: "white shirt",
              lowerBody: "blue trousers",
            },
          },
        },
      ],
    } as const;
    expect(PerceptionNowSchema.parse(now)).toEqual(now);
    expect(
      PerceptionNowSchema.safeParse({
        ...now,
        visibleEntities: [{ ...now.visibleEntities[0], position: { x: 2, y: 2 } }],
      }).success,
    ).toBe(false);
  });

  it("does not leak source or direction for silent sounds", () => {
    expect(
      SoundPropagationResultSchema.parse({
        delivery: "silent",
        receiverAgentId: "alice",
      }),
    ).toEqual({ delivery: "silent", receiverAgentId: "alice" });
    expect(
      SoundPropagationResultSchema.safeParse({
        delivery: "silent",
        receiverAgentId: "alice",
        source: { kind: "agent", sourceId: "bob" },
      }).success,
    ).toBe(false);
  });

  it("requires locked sound rules and labels distance-unclear delivery", () => {
    const input = {
      source: { kind: "agent", sourceId: "bob" },
      soundRules: {
        speakSourceStrength: { quiet: 1, normal: 2, loud: 4 },
        attenuationPerTile: 0.25,
        attenuationPerWall: 1,
        attenuationPerOpenDoor: 0.1,
        attenuationPerClosedDoor: 0.75,
        fullContentThreshold: 1,
        unclearContentThreshold: 0.25,
      },
      sourcePosition: { x: 0, y: 0 },
      sourceStrength: 2,
      receiverAgentId: "alice",
      receiverPosition: { x: 2, y: 0 },
      receiverFacing: "west",
      distanceTiles: 2,
      wallCount: 0,
      openDoorCount: 0,
      closedDoorCount: 0,
      blurSample: 0.5,
      payload: { text: "hello" },
    } as const;
    expect(SoundPropagationInputSchema.parse(input)).toEqual(input);
    expect(
      SoundPropagationInputSchema.safeParse({ ...input, soundRules: undefined }).success,
    ).toBe(false);

    const muffled = {
      delivery: "muffled",
      receiverAgentId: "alice",
      receivedStrength: 0.5,
      relativeDirection: "front",
      contentClarity: "distance_unclear",
      source: { kind: "agent", sourceId: "bob" },
      payload: { text: "hello" },
    } as const;
    expect(SoundPropagationResultSchema.parse(muffled)).toEqual(muffled);
    expect(
      SoundPropagationResultSchema.safeParse({
        ...muffled,
        contentClarity: undefined,
      }).success,
    ).toBe(false);
  });

  it("rejects a visual snapshot whose move cursor exceeds its observations", () => {
    expect(
      AgentVisualSnapshotSchema.safeParse({
        agentId: "alice",
        continuous: { visibleEntities: [] },
        moveCalls: [
          {
            callId: "operation-call:move",
            accumulated: [],
            deliveryCursor: 1,
          },
        ],
      }).success,
    ).toBe(false);
  });
});

