import type { AgentDefinition } from "../agent/agent-definition";
import type { ObjectDefinition } from "../object/object-definition";
import { PluginManifestSchema, type PluginManifest } from "./plugin-manifest";
import { JsonValueSchema } from "@god-sim/protocol";

export interface GamePlugin {
  readonly manifest: PluginManifest;
  readonly objects: readonly ObjectDefinition<unknown>[];
  readonly agents: readonly AgentDefinition[];
}

export interface PluginRegistrations {
  readonly objects: readonly ObjectDefinition<unknown>[];
  readonly agents: readonly AgentDefinition[];
}

function assertUnique(label: string, ids: readonly string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`Duplicate ${label} definition: ${id}`);
    seen.add(id);
  }
}

function assertManifestMatches(
  label: string,
  declaredIds: readonly string[],
  registeredIds: readonly string[],
): void {
  const declared = [...declaredIds].sort();
  const registered = [...registeredIds].sort();
  if (declared.length !== registered.length || declared.some((id, index) => id !== registered[index])) {
    throw new Error(
      `Plugin manifest ${label} definitions do not match registrations: declared [${declared.join(
        ", ",
      )}], registered [${registered.join(", ")}]`,
    );
  }
}

export function definePlugin(
  manifestInput: PluginManifest,
  registrations: PluginRegistrations,
): GamePlugin {
  const manifest = PluginManifestSchema.parse(manifestInput);
  const objectIds = registrations.objects.map((definition) => definition.id);
  const agentIds = registrations.agents.map((definition) => definition.id);

  assertUnique("object", objectIds);
  assertUnique("agent", agentIds);
  assertManifestMatches("object", manifest.objectDefinitionIds, objectIds);
  assertManifestMatches("agent", manifest.agentDefinitionIds, agentIds);

  for (const definition of registrations.objects) {
    JsonValueSchema.parse(definition.stateSchema.parse(definition.initialState()));
    if (
      definition.traversal &&
      !definition.interactions.some(
        (interaction) => interaction.id === definition.traversal?.interactionId,
      )
    ) {
      throw new Error(
        `Object ${definition.id} automatic traversal interaction ${definition.traversal.interactionId} is not registered`,
      );
    }
  }

  return Object.freeze({
    manifest,
    objects: Object.freeze([...registrations.objects]),
    agents: Object.freeze([...registrations.agents]),
  });
}
