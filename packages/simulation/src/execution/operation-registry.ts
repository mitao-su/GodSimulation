import type { OperationId } from "@god-sim/protocol";

import {
  legacyCoreAgentOperations,
  mountedAgentOperationRuntimes,
} from "./agent-operation-adapter";
import {
  createHostedObjectInteractionOperation,
  createObjectInteractionOperation,
} from "./object-interaction-adapter";
import type {
  HostedOperationRegistry,
  HostedOperationRuntime,
  OperationRegistry,
  RegisteredOperation,
} from "./operation-runtime";
import type { PluginRegistry } from "../world/plugin-registry";

export function createOperationRegistry(
  pluginRegistry: PluginRegistry,
): OperationRegistry & HostedOperationRegistry {
  const operations = new Map<OperationId, RegisteredOperation>();
  const hostedOperations = new Map<string, HostedOperationRuntime>();
  const register = (operation: RegisteredOperation): void => {
    if (operations.has(operation.id)) {
      throw new Error(`Duplicate operation ID: ${operation.id}`);
    }
    operations.set(operation.id, operation);
  };

  const mountedCoreIds = new Set(
    [...pluginRegistry.agents.values()].flatMap((registered) =>
      registered.definition.operations.map((operation) => operation.operationId),
    ),
  );
  for (const operation of legacyCoreAgentOperations()) {
    if (mountedCoreIds.has(operation.id)) register(operation);
  }

  for (const definitionId of pluginRegistry.agents.keys()) {
    if (pluginRegistry.objects.has(definitionId)) {
      throw new Error(`Ambiguous operation host definition ID: ${definitionId}`);
    }
  }

  const hostedKey = (
    operationId: OperationId | string,
    kind: "agent" | "item" | "furniture",
    hostDefinitionId: string,
  ) => `${kind}\u0000${hostDefinitionId}\u0000${operationId}`;
  for (const runtime of mountedAgentOperationRuntimes(
    [...pluginRegistry.agents.values()].map((registered) =>
      registered.definition,
    ),
  )) {
    const key = hostedKey(
      runtime.id,
      runtime.host.kind,
      runtime.host.hostDefinitionId,
    );
    if (hostedOperations.has(key)) {
      throw new Error(
        `Duplicate hosted operation ${runtime.id} on ${runtime.host.hostDefinitionId}`,
      );
    }
    hostedOperations.set(key, runtime);
  }

  for (const registered of [...pluginRegistry.objects.values()].sort(
    (left, right) => left.definition.id.localeCompare(right.definition.id),
  )) {
    for (const interaction of registered.definition.interactions) {
      register(
        createObjectInteractionOperation(
          registered.ownerPluginId,
          registered.definition,
          interaction,
        ),
      );
      const runtime = createHostedObjectInteractionOperation(
        registered.ownerPluginId,
        registered.definition,
        interaction,
      );
      const key = hostedKey(
        runtime.id,
        runtime.host.kind,
        runtime.host.hostDefinitionId,
      );
      if (hostedOperations.has(key)) {
        throw new Error(
          `Duplicate hosted operation ${runtime.id} on ${runtime.host.hostDefinitionId}`,
        );
      }
      hostedOperations.set(key, runtime);
    }
  }

  return {
    operations,
    getOperation: (operationId) => operations.get(operationId as OperationId),
    getHostedOperation: (operationId, host) =>
      hostedOperations.get(
        hostedKey(operationId, host.kind, host.hostDefinitionId),
      ),
  };
}
