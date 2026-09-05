import {
  DirectOperationReferenceSchema,
  OperationHostDefinitionReferenceSchema,
  OperationHostReferenceSchema,
  OperationTargetReferenceSchema,
  type DirectOperationReference,
  type OperationId,
  type OperationTargetReference,
  type TaskTrack,
} from "@god-sim/protocol";

import {
  legacyCoreAgentOperations,
  knownCoreAgentOperationIds,
  mountedAgentOperationRuntimes,
} from "./agent-operation-adapter";
import {
  createHostedObjectInteractionOperation,
  createObjectInteractionOperation,
} from "./object-interaction-adapter";
import type {
  DirectOperationReferenceResolver,
  HostedOperationRegistry,
  HostedOperationRuntime,
  OperationRegistry,
  RegisteredOperation,
  ResolveOperationReferenceResult,
  OperationRuntimeContext,
  OperationReferenceRejectionCode,
} from "./operation-runtime";
import type { PluginRegistry } from "../world/plugin-registry";

export function createOperationRegistry(
  pluginRegistry: PluginRegistry,
): OperationRegistry &
  HostedOperationRegistry &
  DirectOperationReferenceResolver {
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

  const knownOperationIds = new Set<OperationId>([
    ...operations.keys(),
    ...knownCoreAgentOperationIds(),
  ]);
  const hostKindsByOperation = new Map<OperationId, Set<"agent" | "item" | "furniture">>();
  for (const runtime of hostedOperations.values()) {
    const kinds = hostKindsByOperation.get(runtime.id) ?? new Set();
    kinds.add(runtime.host.kind);
    hostKindsByOperation.set(runtime.id, kinds);
  }
  for (const operationId of knownCoreAgentOperationIds()) {
    const kinds = hostKindsByOperation.get(operationId) ?? new Set();
    kinds.add("agent");
    hostKindsByOperation.set(operationId, kinds);
  }

  const invalid = (
    code: OperationReferenceRejectionCode,
    message: string,
  ): ResolveOperationReferenceResult => ({
    kind: "invalid_reference",
    code,
    message,
  });

  const resolveOperationReference = (
    context: OperationRuntimeContext,
    track: TaskTrack,
    reference: DirectOperationReference,
  ): ResolveOperationReferenceResult => {
    const parsedReference = DirectOperationReferenceSchema.safeParse(reference);
    if (!parsedReference.success) {
      return invalid("invalid_arguments", parsedReference.error.message);
    }
    const parsed = parsedReference.data;
    const operationId = parsed.operationId;
    if (!knownOperationIds.has(operationId)) {
      return invalid(
        "unknown_operation",
        `Operation ${operationId} is not registered`,
      );
    }

    const expectedKinds = hostKindsByOperation.get(operationId) ?? new Set();
    let host: ReturnType<typeof OperationHostReferenceSchema.parse>;
    let hostDefinition: ReturnType<
      typeof OperationHostDefinitionReferenceSchema.parse
    >;

    if (parsed.hostEntityId === undefined) {
      const agent = context.world.agents.get(context.agentId);
      if (!agent) {
        return invalid(
          "unknown_host",
          `Acting agent ${context.agentId} does not exist`,
        );
      }
      host = OperationHostReferenceSchema.parse({
        kind: "agent",
        hostEntityId: context.agentId,
      });
      hostDefinition = OperationHostDefinitionReferenceSchema.parse({
        kind: "agent",
        hostDefinitionId: agent.definitionId,
      });
      if (!expectedKinds.has("agent")) {
        return invalid(
          "invalid_host_reference",
          `Operation ${operationId} requires an explicit non-agent host instance`,
        );
      }
    } else {
      const hostEntityId = parsed.hostEntityId;
      const agent = context.world.agents.get(hostEntityId as never);
      const object = context.world.objects.get(hostEntityId);
      if (agent && object) {
        return invalid(
          "invalid_host_reference",
          `Host instance ${hostEntityId} is ambiguous between an agent and an object`,
        );
      }
      if (agent) {
        return invalid(
          "invalid_host_reference",
          `Operation ${operationId} must omit hostEntityId for an agent host`,
        );
      } else if (object) {
        if (!expectedKinds.has("furniture")) {
          return invalid(
            "invalid_host_reference",
            `Operation ${operationId} cannot use furniture host ${hostEntityId}`,
          );
        }
        if (!context.registry.getObject(object.definitionId)) {
          return invalid(
            "unknown_host",
            `Host definition ${object.definitionId} is not registered`,
          );
        }
        host = OperationHostReferenceSchema.parse({
          kind: "furniture",
          hostEntityId: object.id,
        });
        hostDefinition = OperationHostDefinitionReferenceSchema.parse({
          kind: "furniture",
          hostDefinitionId: object.definitionId,
        });
      } else {
        return invalid("unknown_host", `Host instance ${hostEntityId} does not exist`);
      }
    }

    if (!expectedKinds.has(host.kind)) {
      return invalid(
        "invalid_host_reference",
        `Operation ${operationId} cannot be hosted by ${host.kind}`,
      );
    }

    const runtime = hostedOperations.get(
      hostedKey(operationId, hostDefinition.kind, hostDefinition.hostDefinitionId),
    );
    if (!runtime) {
      return invalid(
        "operation_not_mounted",
        `Operation ${operationId} is not mounted on ${hostDefinition.kind}:${hostDefinition.hostDefinitionId}`,
      );
    }
    if (!runtime.taskSlots.includes(track)) {
      return invalid(
        "invalid_task_track",
        `Operation ${operationId} does not occupy ${track}`,
      );
    }

    const argumentsResult = runtime.parametersSchema.safeParse(parsed.arguments);
    if (!argumentsResult.success) {
      return invalid("invalid_arguments", argumentsResult.error.message);
    }
    const argumentsValue = argumentsResult.data as Record<string, unknown>;
    let target: OperationTargetReference;
    if (runtime.target.kind === "none") {
      target = { kind: "none" };
    } else if (runtime.target.kind === "character") {
      const targetCharacterId = argumentsValue["targetCharacterId"];
      const parsedTarget = OperationTargetReferenceSchema.safeParse({
        kind: "character",
        targetCharacterId,
      });
      if (!parsedTarget.success) {
        return invalid("invalid_arguments", parsedTarget.error.message);
      }
      target = parsedTarget.data;
    } else {
      const parsedTarget = OperationTargetReferenceSchema.safeParse({
        kind: "object",
        targetEntityId: argumentsValue["targetEntityId"],
      });
      if (!parsedTarget.success) {
        return invalid("invalid_arguments", parsedTarget.error.message);
      }
      target = parsedTarget.data;
    }

    return {
      kind: "resolved",
      binding: {
        runtime,
        host,
        target,
        arguments: argumentsResult.data,
      },
    };
  };

  return {
    operations,
    getOperation: (operationId) => operations.get(operationId as OperationId),
    getHostedOperation: (operationId, host) =>
      hostedOperations.get(
        hostedKey(operationId, host.kind, host.hostDefinitionId),
      ),
    resolveOperationReference,
  };
}
