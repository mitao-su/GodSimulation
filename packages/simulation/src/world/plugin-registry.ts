import type { AgentDefinition, GamePlugin, ObjectDefinition } from "@god-sim/plugin-sdk";
import type { JsonValue } from "@god-sim/protocol";

export interface RegisteredObjectDefinition {
  readonly ownerPluginId: string;
  readonly definition: ObjectDefinition<JsonValue>;
}

export interface RegisteredAgentDefinition {
  readonly ownerPluginId: string;
  readonly definition: AgentDefinition;
}

export interface PluginRegistry {
  readonly plugins: ReadonlyMap<string, GamePlugin>;
  readonly objects: ReadonlyMap<string, RegisteredObjectDefinition>;
  readonly agents: ReadonlyMap<string, RegisteredAgentDefinition>;
  getObject(definitionId: string): RegisteredObjectDefinition | undefined;
  getAgent(definitionId: string): RegisteredAgentDefinition | undefined;
}

export function createPluginRegistry(plugins: readonly GamePlugin[]): PluginRegistry {
  const pluginMap = new Map<string, GamePlugin>();
  const objects = new Map<string, RegisteredObjectDefinition>();
  const agents = new Map<string, RegisteredAgentDefinition>();

  for (const plugin of plugins) {
    if (pluginMap.has(plugin.manifest.id)) {
      throw new Error(`Duplicate plugin ID: ${plugin.manifest.id}`);
    }
    pluginMap.set(plugin.manifest.id, plugin);

    for (const definition of plugin.objects) {
      if (objects.has(definition.id)) {
        throw new Error(`Duplicate object definition ID: ${definition.id}`);
      }
      objects.set(definition.id, {
        ownerPluginId: plugin.manifest.id,
        definition: definition as unknown as ObjectDefinition<JsonValue>,
      });
    }

    for (const definition of plugin.agents) {
      if (agents.has(definition.id)) {
        throw new Error(`Duplicate agent definition ID: ${definition.id}`);
      }
      agents.set(definition.id, { ownerPluginId: plugin.manifest.id, definition });
    }
  }

  return {
    plugins: pluginMap,
    objects,
    agents,
    getObject: (definitionId) => objects.get(definitionId),
    getAgent: (definitionId) => agents.get(definitionId),
  };
}
