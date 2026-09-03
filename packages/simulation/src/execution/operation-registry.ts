import type { OperationId } from "@god-sim/protocol";

import { createMoveOperation } from "./core/move-operation";
import { createObserveOperation } from "./core/observe-operation";
import { createWaitOperation } from "./core/wait-operation";
import { createObjectInteractionOperation } from "./object-interaction-adapter";
import type {
  OperationRegistry,
  RegisteredOperation,
} from "./operation-runtime";
import type { PluginRegistry } from "../world/plugin-registry";

export function createOperationRegistry(
  pluginRegistry: PluginRegistry,
): OperationRegistry {
  const operations = new Map<OperationId, RegisteredOperation>();
  const register = (operation: RegisteredOperation): void => {
    if (operations.has(operation.id)) {
      throw new Error(`Duplicate operation ID: ${operation.id}`);
    }
    operations.set(operation.id, operation);
  };

  register(createWaitOperation());
  register(createObserveOperation());
  register(createMoveOperation());

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
    }
  }

  return {
    operations,
    getOperation: (operationId) => operations.get(operationId as OperationId),
  };
}
