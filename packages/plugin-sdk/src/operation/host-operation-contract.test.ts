import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  AgentIdSchema,
  EntityIdSchema,
  OperationManualSchema,
  type OperationTargetRequirement,
} from "@god-sim/protocol";

import {
  assertHostedOperationContract,
  OperationStartResultSchema,
  OperationTerminalProposalSchema,
  OperationTickResultSchema,
  operationParametersJsonSchema,
  validateOperationDomainFailureOutcome,
  validateOperationStateTransition,
  type HostedOperationDefinition,
} from "./operation-contract";
import type { AgentDefinition } from "../agent/agent-definition";
import { AgentOperationDefinitionSchema } from "../agent/agent-operation";
import { ObjectCapabilitiesSchema } from "../object/object-definition";

const parametersSchema = z
  .object({ hostDefinitionId: z.string().min(1) })
  .strict();
const operationStateSchema = z.object({ delivered: z.boolean() }).strict();
const failureDetailsSchema = z.object({ hostDefinitionId: z.string() }).strict();
const failureResultSchema = z.object({ reason: z.string() }).strict();

const manual = OperationManualSchema.parse({
  operationId: "core.read",
  displayName: "Read manual",
  summary: "Read the static manual for one host definition.",
  taskSlots: ["HEAD"],
  parametersSchema: operationParametersJsonSchema(parametersSchema),
  target: { kind: "none" },
  duration: { kind: "indeterminate" },
  worldPreconditions: [
    {
      failureCode: "unknown_definition",
      description: "The requested host definition must exist.",
    },
  ],
});

type HostState = Record<string, never>;
type Context = { readonly worldTick: number };
type Arguments = z.infer<typeof parametersSchema>;
type OperationState = z.infer<typeof operationStateSchema>;

const hostedDefinition: HostedOperationDefinition<
  HostState,
  Context,
  Arguments,
  OperationState
> = {
  id: manual.operationId,
  displayName: manual.displayName,
  trigger: "active_command",
  manual,
  target: manual.target,
  duration: manual.duration,
  taskSlots: manual.taskSlots,
  parametersSchema,
  eventIgnore: [],
  publicBehavior: { kind: "hidden" },
  domainFailures: [
    {
      code: "unknown_definition",
      summary: "The requested host definition does not exist.",
      detailsSchema: failureDetailsSchema,
      resultSchema: failureResultSchema,
    },
  ],
  resultSchema: z.object({ manual: z.string() }).strict(),
  stateSchema: operationStateSchema,
  initialState: () => ({ delivered: false }),
  resolveDuration: () => ({ kind: "indeterminate" }),
  start: (_host, _context, _arguments, state) => ({
    kind: "started",
    proposal: { effects: [] },
    nextState: { ...state },
  }),
  tick: (_host, _context, _arguments, state) => ({
    kind: "complete",
    nextState: { ...state },
  }),
  complete: () => ({ effects: [], result: { manual: "contents" } }),
  fail: () => ({ effects: [], result: { reason: "Unknown definition" } }),
  cancel: () => ({ effects: [], result: {} }),
  fuse: (_host, _context, _arguments, state) =>
    state.delivered ? null : { manual: "contents" },
  acknowledgeFuseResult: (_host, _context, _arguments, state) => ({
    ...state,
    delivered: true,
  }),
};

function hostedDefinitionWithTarget(
  target: OperationTargetRequirement,
  targetParametersSchema: z.ZodType,
) {
  return {
    ...hostedDefinition,
    target,
    parametersSchema: targetParametersSchema,
    manual: OperationManualSchema.parse({
      ...manual,
      target,
      parametersSchema: operationParametersJsonSchema(targetParametersSchema),
    }),
  };
}

describe("hosted operation SDK contract", () => {
  it("keeps an agent mount separate from its core runtime", () => {
    const mount = AgentOperationDefinitionSchema.parse({
      operationId: "core.read",
      manual,
    });
    expect(mount).toEqual({ operationId: "core.read", manual });
    expect(
      AgentOperationDefinitionSchema.safeParse({
        operationId: "core.observe",
        manual,
      }).success,
    ).toBe(false);

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
      operations: [mount],
    };
    expect(agent.operations?.[0]).toEqual(mount);
    expect("start" in mount).toBe(false);
  });

  it("requires next state from start and tick transitions", () => {
    expect(
      OperationStartResultSchema.parse({
        kind: "started",
        proposal: { effects: [] },
        nextState: { delivered: false },
      }),
    ).toEqual({
      kind: "started",
      proposal: { effects: [] },
      nextState: { delivered: false },
    });
    expect(
      OperationStartResultSchema.safeParse({
        kind: "started",
        proposal: { effects: [] },
      }).success,
    ).toBe(false);
    expect(
      OperationTickResultSchema.parse({
        kind: "complete",
        nextState: { delivered: true },
      }),
    ).toEqual({ kind: "complete", nextState: { delivered: true } });
  });

  it("validates every persisted state transition through stateSchema", () => {
    expect(
      validateOperationStateTransition(operationStateSchema, {
        delivered: true,
      }),
    ).toEqual({ kind: "valid_state", state: { delivered: true } });
    expect(
      validateOperationStateTransition(operationStateSchema, {
        delivered: "yes",
      }),
    ).toMatchObject({
      kind: "technical_failure",
      code: "invalid_operation_state",
    });
    expect(validateOperationStateTransition(z.any(), "not-an-object")).toMatchObject(
      {
        kind: "technical_failure",
        code: "invalid_operation_state",
      },
    );
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

  it("accepts a complete hosted definition with one loading validator", () => {
    expect(() =>
      assertHostedOperationContract("Core read", hostedDefinition),
    ).not.toThrow();
  });

  it("rejects every required hosted definition field when missing", () => {
    const requiredFields = [
      "id",
      "displayName",
      "trigger",
      "manual",
      "target",
      "duration",
      "taskSlots",
      "parametersSchema",
      "eventIgnore",
      "publicBehavior",
      "domainFailures",
      "resultSchema",
      "stateSchema",
      "initialState",
      "resolveDuration",
      "start",
      "complete",
      "fail",
      "cancel",
      "fuse",
      "acknowledgeFuseResult",
    ] as const;

    for (const field of requiredFields) {
      const candidate = { ...hostedDefinition } as Record<string, unknown>;
      delete candidate[field];
      expect(
        () => assertHostedOperationContract(`Missing ${field}`, candidate),
        field,
      ).toThrow();
    }
  });

  it("checks manual and runtime tracks, parameters, target, and duration", () => {
    const mismatches: readonly [string, Record<string, unknown>][] = [
      ["task slots", { taskSlots: ["BODY"] }],
      ["parameter schema", { parametersSchema: z.object({}).strict() }],
      ["target requirement", { target: { kind: "character" } }],
      ["duration declaration", { duration: { kind: "fixed" } }],
    ];
    for (const [message, mismatch] of mismatches) {
      expect(() =>
        assertHostedOperationContract("Mismatched read", {
          ...hostedDefinition,
          ...mismatch,
        }),
      ).toThrow(message);
    }
  });

  it("requires the canonical target ID parameter for external targets", () => {
    const characterParameters = z
      .object({ targetCharacterId: AgentIdSchema })
      .strict();
    const objectParameters = z
      .object({ targetEntityId: EntityIdSchema })
      .strict();

    expect(() =>
      assertHostedOperationContract(
        "Character target",
        hostedDefinitionWithTarget({ kind: "character" }, characterParameters),
      ),
    ).not.toThrow();
    expect(() =>
      assertHostedOperationContract(
        "Object target",
        hostedDefinitionWithTarget(
          { kind: "object", requiredCapabilities: ["container"] },
          objectParameters,
        ),
      ),
    ).not.toThrow();

    expect(() =>
      assertHostedOperationContract(
        "Unexpected character target",
        hostedDefinitionWithTarget(
          { kind: "none" },
          z.object({ targetCharacterId: AgentIdSchema }).strict(),
        ),
      ),
    ).toThrow("none target cannot declare parameter targetCharacterId");
    expect(() =>
      assertHostedOperationContract(
        "Unexpected object target",
        hostedDefinitionWithTarget(
          { kind: "none" },
          z.object({ targetEntityId: EntityIdSchema }).strict(),
        ),
      ),
    ).toThrow("none target cannot declare parameter targetEntityId");

    const emptyParameters = z.object({}).strict();
    expect(() =>
      assertHostedOperationContract(
        "Missing character target",
        hostedDefinitionWithTarget({ kind: "character" }, emptyParameters),
      ),
    ).toThrow("requires parameter targetCharacterId");
    expect(() =>
      assertHostedOperationContract(
        "Missing object target",
        hostedDefinitionWithTarget(
          { kind: "object", requiredCapabilities: ["container"] },
          emptyParameters,
        ),
      ),
    ).toThrow("requires parameter targetEntityId");

    expect(() =>
      assertHostedOperationContract(
        "Optional character target",
        hostedDefinitionWithTarget(
          { kind: "character" },
          z.object({ targetCharacterId: AgentIdSchema.optional() }).strict(),
        ),
      ),
    ).toThrow("requires parameter targetCharacterId");
    expect(() =>
      assertHostedOperationContract(
        "Noncanonical object target",
        hostedDefinitionWithTarget(
          { kind: "object", requiredCapabilities: ["container"] },
          z.object({ targetEntityId: z.string() }).strict(),
        ),
      ),
    ).toThrow("must use the canonical ID schema");
    expect(() =>
      assertHostedOperationContract(
        "Mismatched character target",
        hostedDefinitionWithTarget(
          { kind: "character" },
          z
            .object({
              targetCharacterId: AgentIdSchema,
              targetEntityId: EntityIdSchema.optional(),
            })
            .strict(),
        ),
      ),
    ).toThrow("character target cannot declare parameter targetEntityId");
    expect(() =>
      assertHostedOperationContract(
        "Mismatched object target",
        hostedDefinitionWithTarget(
          { kind: "object", requiredCapabilities: ["container"] },
          z
            .object({
              targetEntityId: EntityIdSchema,
              targetCharacterId: AgentIdSchema.optional(),
            })
            .strict(),
        ),
      ),
    ).toThrow("object target cannot declare parameter targetCharacterId");
    expect(() =>
      assertHostedOperationContract(
        "Object target without capabilities",
        hostedDefinitionWithTarget(
          { kind: "object", requiredCapabilities: [] },
          objectParameters,
        ),
      ),
    ).toThrow();
  });

  it("rejects parameter schemas that retain undeclared target IDs", () => {
    const passthroughNoneParameters = z.object({}).passthrough();
    const catchallNoneParameters = z.object({}).catchall(z.string());
    const passthroughCharacterParameters = z
      .object({ targetCharacterId: AgentIdSchema })
      .passthrough();
    const catchallObjectParameters = z
      .object({ targetEntityId: EntityIdSchema })
      .catchall(z.string());

    const permissiveDefinitions = [
      hostedDefinitionWithTarget({ kind: "none" }, passthroughNoneParameters),
      hostedDefinitionWithTarget({ kind: "none" }, catchallNoneParameters),
      hostedDefinitionWithTarget(
        { kind: "character" },
        passthroughCharacterParameters,
      ),
      hostedDefinitionWithTarget(
        { kind: "object", requiredCapabilities: ["container"] },
        catchallObjectParameters,
      ),
    ];

    for (const definition of permissiveDefinitions) {
      expect(() =>
        assertHostedOperationContract("Permissive parameters", definition),
      ).toThrow("parameter schema must reject unknown properties");
    }
  });

  it("ties each domain failure code to details and visible result schemas", () => {
    expect(
      validateOperationDomainFailureOutcome(
        hostedDefinition.domainFailures,
        {
          kind: "domain_failure",
          code: "unknown_definition",
          details: { hostDefinitionId: "home.unknown" },
        },
        { reason: "Unknown definition" },
      ),
    ).toMatchObject({ kind: "valid_domain_failure" });
    expect(
      validateOperationDomainFailureOutcome(
        hostedDefinition.domainFailures,
        { kind: "domain_failure", code: "invented", details: {} },
        {},
      ),
    ).toMatchObject({
      kind: "technical_failure",
      code: "undeclared_domain_failure",
    });
    expect(
      validateOperationDomainFailureOutcome(
        hostedDefinition.domainFailures,
        {
          kind: "domain_failure",
          code: "unknown_definition",
          details: {},
        },
        { reason: "Unknown definition" },
      ),
    ).toMatchObject({
      kind: "technical_failure",
      code: "invalid_domain_failure_details",
    });
    expect(
      validateOperationDomainFailureOutcome(
        hostedDefinition.domainFailures,
        {
          kind: "domain_failure",
          code: "unknown_definition",
          details: { hostDefinitionId: "home.unknown" },
        },
        {},
      ),
    ).toMatchObject({
      kind: "technical_failure",
      code: "invalid_domain_failure_result",
    });
    expect(
      validateOperationDomainFailureOutcome(
        [
          {
            ...hostedDefinition.domainFailures[0]!,
            resultSchema: z.any(),
          },
        ],
        {
          kind: "domain_failure",
          code: "unknown_definition",
          details: { hostDefinitionId: "home.unknown" },
        },
        "not-an-object",
      ),
    ).toMatchObject({
      kind: "technical_failure",
      code: "invalid_domain_failure_result",
    });
  });

  it("advances fuse delivery state only through acknowledgement", () => {
    const initial = hostedDefinition.initialState(
      {},
      { worldTick: 0 },
      { hostDefinitionId: "home.refrigerator" },
    );
    const receipt = hostedDefinition.fuse(
      {},
      { worldTick: 0 },
      { hostDefinitionId: "home.refrigerator" },
      initial,
    );
    expect(receipt).toEqual({ manual: "contents" });
    expect(initial).toEqual({ delivered: false });
    const acknowledged = hostedDefinition.acknowledgeFuseResult(
      {},
      { worldTick: 0 },
      { hostDefinitionId: "home.refrigerator" },
      initial,
      receipt ?? {},
    );
    expect(acknowledged).toEqual({ delivered: true });
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
});
