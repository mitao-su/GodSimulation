import { z } from "zod";
import { describe, expect, it } from "vitest";

import { OperationManualSchema } from "@god-sim/protocol";

import {
  OperationStartResultSchema,
  OperationTerminalProposalSchema,
  OperationTickResultSchema,
  type HostOperationContract,
} from "./operation-contract";
import type { AgentDefinition } from "../agent/agent-definition";
import { AgentOperationDefinitionSchema } from "../agent/agent-operation";
import { ObjectCapabilitiesSchema } from "../object/object-definition";

const manual = OperationManualSchema.parse({
  operationId: "core.read",
  displayName: "Read manual",
  summary: "Read the static manual for one host definition.",
  taskSlots: ["HEAD"],
  parametersSchema: {
    type: "object",
    properties: { hostDefinitionId: { type: "string" } },
    required: ["hostDefinitionId"],
    additionalProperties: false,
  },
  target: { kind: "none" },
  duration: { kind: "indeterminate" },
  worldPreconditions: [],
});

describe("hosted operation SDK contract", () => {
  it("requires static metadata for an agent operation", () => {
    expect(
      AgentOperationDefinitionSchema.parse({
        id: "core.read",
        displayName: "Read manual",
        trigger: "active_command",
        manual,
        target: { kind: "none" },
      }),
    ).toMatchObject({ id: "core.read", manual });
    expect(
      AgentOperationDefinitionSchema.safeParse({
        id: "core.read",
        displayName: "Read manual",
        trigger: "active_command",
        target: { kind: "none" },
      }).success,
    ).toBe(false);
    expect(
      AgentOperationDefinitionSchema.safeParse({
        id: "core.observe",
        displayName: "Read manual",
        trigger: "active_command",
        manual,
        target: { kind: "none" },
      }).success,
    ).toBe(false);
  });

  it("validates typed start and tick outcomes", () => {
    expect(
      OperationStartResultSchema.parse({
        kind: "started",
        proposal: { effects: [] },
      }),
    ).toEqual({ kind: "started", proposal: { effects: [] } });
    expect(
      OperationStartResultSchema.parse({
        kind: "domain_failure",
        code: "unknown_target",
        details: {},
      }).kind,
    ).toBe("domain_failure");
    expect(
      OperationTickResultSchema.parse({ kind: "complete" }),
    ).toEqual({ kind: "complete" });
    expect(
      OperationTickResultSchema.safeParse({
        kind: "technical_failure",
        code: "plugin_exception",
        message: "Plugin threw.",
        retryable: true,
      }).success,
    ).toBe(false);
  });

  it("keeps lifecycle result data separate from proposed effects", () => {
    expect(
      OperationTerminalProposalSchema.parse({
        effects: [],
        result: { status: "completed" },
      }),
    ).toEqual({ effects: [], result: { status: "completed" } });
    expect(
      OperationTerminalProposalSchema.safeParse({ effects: [] }).success,
    ).toBe(false);
  });

  it("validates object capabilities independently from category tags", () => {
    expect(ObjectCapabilitiesSchema.parse(["heating", "container"])).toEqual([
      "heating",
      "container",
    ]);
    expect(
      ObjectCapabilitiesSchema.safeParse(["kitchen appliance"]).success,
    ).toBe(false);
  });

  it("exposes one complete lifecycle signature for hosted operations", () => {
    const definition: HostOperationContract<
      Record<string, never>,
      { readonly worldTick: number },
      Record<string, never>
    > = {
      manual,
      target: { kind: "none" },
      taskSlots: ["HEAD"],
      parametersSchema: z.object({}).strict(),
      eventIgnore: [],
      publicBehavior: { kind: "hidden" },
      domainFailures: [],
      resultSchema: z.object({}).strict(),
      resolveDuration: () => ({ kind: "indeterminate" }),
      start: () => ({ kind: "started", proposal: { effects: [] } }),
      tick: () => ({ kind: "complete" }),
      complete: () => ({ effects: [], result: {} }),
      fail: () => ({ effects: [], result: {} }),
      cancel: () => ({ effects: [], result: {} }),
      fuse: () => null,
    };

    expect(definition.start({}, { worldTick: 0 }, {})).toEqual({
      kind: "started",
      proposal: { effects: [] },
    });
    expect(definition.tick?.({}, { worldTick: 0 }, {})).toEqual({
      kind: "complete",
    });

    const agent: AgentDefinition = {
      id: "starter.test-agent",
      version: "1.0.0",
      displayName: "Test agent",
      persona: {
        background: "Test",
        personality: "Test",
        values: [],
        language: "English",
        thinkingStyle: "Test",
      },
      initialMemories: [],
      resourceId: "starter.test-agent",
      animationSetId: "starter.humanoid",
      operations: [
        {
          ...definition,
          id: "core.read" as never,
          displayName: "Read manual",
          trigger: "active_command",
        },
      ],
    };
    expect(agent.operations?.[0]?.manual).toEqual(manual);
  });
});
