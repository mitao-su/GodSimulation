import type { HostedOperationRuntimeRegistry, OperationRuntimeCall } from "./operation-runtime";
import type { WorldState } from "../world/world-state";

/** 从 runtime 与稳定目标引用派生 hosted operation 的可读名称。 */
export function hostedOperationLabel(
  world: WorldState,
  registry: HostedOperationRuntimeRegistry,
  operation: OperationRuntimeCall,
): string {
  const runtime = registry.getHostedOperation(
    operation.operationId,
    operation.hostDefinition,
  );
  if (!runtime) return operation.operationId;

  if (
    (operation.operationId === "core.move" ||
      operation.operationId === "core.observe") &&
    operation.target.kind === "object"
  ) {
    const target = world.objects.get(operation.target.targetEntityId);
    const definition = target
      ? registry.getObject(target.definitionId)?.definition
      : undefined;
    if (definition) {
      return operation.operationId === "core.move"
        ? `Move to ${definition.displayName}`
        : `Observe ${definition.displayName}`;
    }
  }

  return runtime.displayName;
}
