import { z } from "zod";
import { describe, expect, it } from "vitest";

import type { ObjectDefinition } from "../object/object-definition";
import type { InteractionDefinition } from "../object/object-interaction";
import { operationParametersJsonSchema } from "../operation/operation-contract";
import type { AgentDefinition } from "../agent/agent-definition";
import { definePlugin } from "./define-plugin";
import { PluginManifestSchema } from "./plugin-manifest";

function objectDefinition(id: string): ObjectDefinition<{ enabled: boolean }> {
  return {
    id,
    version: "1.0.0",
    stateVersion: 1,
    displayName: id,
    tags: [],
    capabilities: [],
    stateSchema: z.object({ enabled: z.boolean() }).strict(),
    initialState: () => ({ enabled: true }),
    resourceId: "test.resource",
    placement: {
      kind: "cell",
      footprint: [{ x: 0, y: 0 }],
      interactionOffsets: [{ x: 0, y: 1 }],
    },
    interactions: [],
    observe: () => ({ status: "ready", summary: "Ready", details: {} }),
  };
}

function interactionDefinition(): InteractionDefinition<{ enabled: boolean }> {
  const parametersSchema = z.object({}).strict();
  return {
    id: "use",
    displayName: "Use",
    trigger: "active_command",
    manual: {
      operationId: "object.test.object.use" as never,
      displayName: "Use",
      summary: "Use the test object.",
      taskSlots: ["BODY"],
      parametersSchema: operationParametersJsonSchema(parametersSchema),
      target: { kind: "none" },
      duration: { kind: "fixed" },
      worldPreconditions: [],
    },
    target: { kind: "none" },
    duration: { kind: "fixed" },
    taskSlots: ["BODY"],
    parametersSchema,
    resolveDuration: () => ({ kind: "fixed", totalTicks: 1 }),
    eventIgnore: [],
    publicBehavior: { kind: "visible", label: "using the object" },
    arbitrationFailureMappings: {},
    domainFailures: [],
    resultSchema: z.object({}).strict(),
    canStart: () => ({ available: true }),
    complete: () => ({ effects: [] }),
    fail: () => ({ effects: [] }),
    cancel: () => ({ effects: [] }),
    fuse: () => null,
  };
}

function objectWithInteraction(
  interaction: InteractionDefinition<{ enabled: boolean }>,
): ObjectDefinition<{ enabled: boolean }> {
  return {
    ...objectDefinition("test.object"),
    interactions: [interaction],
  };
}

const manifest = PluginManifestSchema.parse({
  schemaVersion: 1,
  id: "test.plugin",
  version: "1.0.0",
  stateVersion: 1,
  engineApiVersion: 1,
  entry: "./dist/index.js",
  objectDefinitionIds: ["test.object"],
  agentDefinitionIds: [],
});

const agentManifest = PluginManifestSchema.parse({
  ...manifest,
  objectDefinitionIds: [],
  agentDefinitionIds: ["test.agent"],
});

function agentDefinition(): AgentDefinition {
  return {
    id: "test.agent",
    version: "1.0.0",
    displayName: "Test Agent",
    persona: {
      background: "Test",
      personality: "Test",
      values: [],
      language: "English",
      thinkingStyle: "Test",
    },
    initialMemories: [],
    resourceId: "test.agent",
    animationSetId: "test.agent",
    operations: [],
  };
}

describe("definePlugin", () => {
  it("registers declared object definitions", () => {
    const plugin = definePlugin(manifest, {
      objects: [objectDefinition("test.object")],
      agents: [],
    });

    expect(plugin.objects.map((definition) => definition.id)).toEqual(["test.object"]);
  });

  it("rejects an object definition without an explicit capability list", () => {
    const definition = {
      ...objectDefinition("test.object"),
      capabilities: undefined,
    } as unknown as ObjectDefinition<{ enabled: boolean }>;

    expect(() =>
      definePlugin(manifest, { objects: [definition], agents: [] }),
    ).toThrow();
  });

  it("rejects an agent definition without an explicit operation mount table", () => {
    const definition = {
      ...agentDefinition(),
      operations: undefined,
    } as unknown as AgentDefinition;

    expect(() =>
      definePlugin(agentManifest, { objects: [], agents: [definition] }),
    ).toThrow(/operation mount table/i);
  });

  it("rejects an agent operation mount without a static manual", () => {
    const definition = {
      ...agentDefinition(),
      operations: [{ operationId: "core.read", manual: undefined }],
    } as unknown as AgentDefinition;

    expect(() =>
      definePlugin(agentManifest, { objects: [], agents: [definition] }),
    ).toThrow();
  });

  it("rejects duplicate operation mounts on one agent definition", () => {
    const mounted = {
      operationId: "core.read" as never,
      manual: {
        ...interactionDefinition().manual,
        operationId: "core.read" as never,
      },
    };
    const definition = {
      ...agentDefinition(),
      operations: [mounted, mounted],
    };

    expect(() =>
      definePlugin(agentManifest, { objects: [], agents: [definition] }),
    ).toThrow(/duplicate operation on agent/i);
  });

  it("rejects duplicate object IDs", () => {
    expect(() =>
      definePlugin(manifest, {
        objects: [objectDefinition("test.object"), objectDefinition("test.object")],
        agents: [],
      }),
    ).toThrow(/duplicate object definition/i);
  });

  it("rejects registrations not declared by the manifest", () => {
    expect(() =>
      definePlugin(manifest, {
        objects: [objectDefinition("test.other")],
        agents: [],
      }),
    ).toThrow(/manifest/i);
  });

  it("rejects an automatic traversal interaction that is not registered", () => {
    const definition = {
      ...objectDefinition("test.object"),
      traversal: { interactionId: "open" },
    };

    expect(() =>
      definePlugin(manifest, {
        objects: [definition],
        agents: [],
      }),
    ).toThrow(/automatic traversal interaction open/i);
  });

  it("accepts a complete operation contract", () => {
    const interaction = interactionDefinition();

    const plugin = definePlugin(manifest, {
      objects: [objectWithInteraction(interaction)],
      agents: [],
    });

    expect(plugin.objects[0]?.interactions[0]?.taskSlots).toEqual(["BODY"]);
  });

  it("rejects a manual whose operation ID does not match its object host", () => {
    const interaction = interactionDefinition();
    const mismatched = {
      ...interaction,
      manual: {
        ...interaction.manual,
        operationId: "object.test.other.use" as never,
      },
    };

    expect(() =>
      definePlugin(manifest, {
        objects: [objectWithInteraction(mismatched)],
        agents: [],
      }),
    ).toThrow(/must use operation ID object\.test\.object\.use/i);
  });

  it.each([
    { taskSlots: [], message: /at least one task track/i },
    { taskSlots: ["BODY", "HEAD"], message: /canonical order/i },
    { taskSlots: ["BODY", "BODY"], message: /duplicate/i },
  ])("rejects invalid task slots $taskSlots", ({ taskSlots, message }) => {
    const interaction = {
      ...interactionDefinition(),
      taskSlots,
    } as unknown as InteractionDefinition<{ enabled: boolean }>;

    expect(() =>
      definePlugin(manifest, {
        objects: [objectWithInteraction(interaction)],
        agents: [],
      }),
    ).toThrow(message);
  });

  it.each([
    ["manual", /static manual/i],
    ["target", /target declaration/i],
    ["duration", /duration declaration/i],
    ["publicBehavior", /public behavior/i],
    ["resolveDuration", /duration resolver/i],
    ["parametersSchema", /parameter schema/i],
    ["resultSchema", /result schema/i],
    ["eventIgnore", /event ignore/i],
    ["domainFailures", /domain failure/i],
    ["complete", /completion lifecycle/i],
    ["fail", /failure lifecycle/i],
    ["cancel", /cancel lifecycle/i],
    ["fuse", /fuse lifecycle/i],
  ] as const)("rejects a missing %s declaration", (field, message) => {
    const interaction = { ...interactionDefinition(), [field]: undefined } as unknown as
      InteractionDefinition<{ enabled: boolean }>;

    expect(() =>
      definePlugin(manifest, {
        objects: [objectWithInteraction(interaction)],
        agents: [],
      }),
    ).toThrow(message);
  });

  it("rejects duplicate domain failure codes", () => {
    const interaction = {
      ...interactionDefinition(),
      domainFailures: [
        {
          code: "occupied",
          summary: "Occupied",
          detailsSchema: z.object({ summary: z.string() }).strict(),
          resultSchema: z.object({}).strict(),
        },
        {
          code: "occupied",
          summary: "Still occupied",
          detailsSchema: z.object({ summary: z.string() }).strict(),
          resultSchema: z.object({}).strict(),
        },
      ],
    } satisfies InteractionDefinition<{ enabled: boolean }>;

    expect(() =>
      definePlugin(manifest, {
        objects: [objectWithInteraction(interaction)],
        agents: [],
      }),
    ).toThrow(/duplicate domain failure/i);
  });
});
