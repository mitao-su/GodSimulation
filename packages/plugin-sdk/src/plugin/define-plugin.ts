import { JsonValueSchema, OperationIdSchema } from "@god-sim/protocol";

import type { AgentDefinition } from "../agent/agent-definition";
import { AgentOperationDefinitionSchema } from "../agent/agent-operation";
import {
  ObjectCapabilitiesSchema,
  type ObjectDefinition,
} from "../object/object-definition";
import { bindHostedInteractionDefinition } from "../object/object-interaction";
import { assertHostedOperationContract } from "../operation/operation-contract";
import { PluginManifestSchema, type PluginManifest } from "./plugin-manifest";

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
    ObjectCapabilitiesSchema.parse(definition.capabilities);
    JsonValueSchema.parse(definition.stateSchema.parse(definition.initialState()));
    assertUnique(
      `interaction on object ${definition.id}`,
      definition.interactions.map((interaction) => interaction.id),
    );
    const hostedInteractions = definition.interactions.map((interaction) =>
      bindHostedInteractionDefinition(interaction),
    );
    assertUnique(
      `operation on object ${definition.id}`,
      hostedInteractions.map((interaction) => interaction.id),
    );
    for (const [index, interaction] of definition.interactions.entries()) {
      const expectedOperationId = OperationIdSchema.parse(
        `object.${definition.id}.${interaction.id}`,
      );
      if (hostedInteractions[index]!.id !== expectedOperationId) {
        throw new Error(
          `Object ${definition.id} interaction ${interaction.id} must use operation ID ${expectedOperationId}`,
        );
      }
      assertHostedOperationContract(
        "Object " + definition.id + " interaction " + interaction.id,
        hostedInteractions[index]!,
      );
    }
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

  for (const definition of registrations.agents) {
    if (!Array.isArray(definition.operations)) {
      throw new Error(`Agent ${definition.id} requires an operation mount table`);
    }
    const operations = definition.operations.map((operation) =>
      AgentOperationDefinitionSchema.parse(operation),
    );
    assertUnique(
      `operation on agent ${definition.id}`,
      operations.map((operation) => operation.operationId),
    );
  }

  return Object.freeze({
    manifest,
    objects: Object.freeze([...registrations.objects]),
    agents: Object.freeze([...registrations.agents]),
  });
}
