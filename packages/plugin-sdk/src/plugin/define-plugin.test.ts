import { z } from "zod";
import { describe, expect, it } from "vitest";

import type { ObjectDefinition } from "../object/object-definition";
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
});
