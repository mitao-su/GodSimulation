import { z } from "zod";
import { describe, expect, it } from "vitest";

import type { ObjectDefinition } from "../object/object-definition";
import type { InteractionDefinition } from "../object/object-interaction";
import { definePlugin } from "./define-plugin";
import { PluginManifestSchema } from "./plugin-manifest";

function objectDefinition(id: string): ObjectDefinition<{ enabled: boolean }> {
  return {
    id,
    version: "1.0.0",
    stateVersion: 1,
    displayName: id,
    tags: [],
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
  return {
    id: "use",
    displayName: "Use",
    trigger: "active_command",
    taskSlots: ["BODY"],
    parametersSchema: z.object({}).strict(),
    resolveDuration: () => ({ kind: "fixed", totalTicks: 1 }),
    eventIgnore: [],
    publicBehavior: { kind: "visible", label: "using the object" },
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

describe("definePlugin", () => {
  it("registers declared object definitions", () => {
    const plugin = definePlugin(manifest, {
      objects: [objectDefinition("test.object")],
      agents: [],
    });

    expect(plugin.objects.map((definition) => definition.id)).toEqual(["test.object"]);
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
    ["publicBehavior", /public behavior/i],
    ["resolveDuration", /duration resolver/i],
    ["parametersSchema", /parameter schema/i],
    ["resultSchema", /result schema/i],
    ["eventIgnore", /event ignore/i],
    ["domainFailures", /domain failure/i],
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
        { code: "occupied", summary: "Occupied" },
        { code: "occupied", summary: "Still occupied" },
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
