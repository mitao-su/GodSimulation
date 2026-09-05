import { z } from "zod";

import {
  assertHostedOperationContract,
  mapOperationArbitrationFailure,
  type AgentDefinition,
  type AgentOperationDefinition,
  type HostedOperationDomainFailureDefinition,
} from "@god-sim/plugin-sdk";
import {
  OperationHostDefinitionIdSchema,
  OperationIdSchema,
  OperationManualSchema,
  type JsonObject,
  type OperationId,
  type OperationHostReference,
} from "@god-sim/protocol";

import {
  EMPTY_OPERATION_STATE_SCHEMA,
  EMPTY_RESULT_SCHEMA,
  ENTITY_TARGET_ARGUMENTS_SCHEMA,
} from "./core/core-operation-helpers";
import {
  MoveOperationResultSchema,
  MoveOperationStateSchema,
  createMoveOperation,
} from "./core/move-operation";
import { createObserveOperation } from "./core/observe-operation";
import {
  WaitOperationArgumentsSchema,
  createWaitOperation,
} from "./core/wait-operation";
import type {
  HostedOperationRuntime,
  OperationRuntimeContext,
  RegisteredOperation,
} from "./operation-runtime";

type UnboundAgentOperationRuntime = Omit<
  HostedOperationRuntime,
  "host" | "manual" | "ownerPluginId"
>;

const FailureDetailsSchema = z.object({}).strict();

function agentOperationMounts(
  definition: AgentDefinition,
): readonly AgentOperationDefinition[] {
  if (!Array.isArray(definition.operations)) {
    throw new Error(`Agent ${definition.id} requires an operation mount table`);
  }
  return definition.operations;
}

function hostedFailures(
  operation: RegisteredOperation,
): readonly HostedOperationDomainFailureDefinition[] {
  return operation.domainFailures.map((failure) => ({
    ...failure,
    detailsSchema: FailureDetailsSchema,
    resultSchema: operation.resultSchema,
  }));
}

function moveResult(stateValue: Readonly<JsonObject>): JsonObject {
  const state = MoveOperationStateSchema.parse(stateValue);
  return MoveOperationResultSchema.parse({
    nearby: state.accumulatedObservations.slice(
      state.observationDeliveryCursor,
    ),
  });
}

function acknowledgeMoveResult(
  stateValue: Readonly<JsonObject>,
  resultValue: Readonly<JsonObject>,
): JsonObject {
  const state = MoveOperationStateSchema.parse(stateValue);
  const expected = moveResult(state);
  const actual = MoveOperationResultSchema.parse(resultValue);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Move fuse result does not match its pending observations");
  }
  return {
    ...state,
    observationDeliveryCursor: state.accumulatedObservations.length,
  };
}

function legacyCoreRuntime(
  operation: RegisteredOperation,
  options: {
    readonly displayName: string;
    readonly parametersSchema: z.ZodType<JsonObject>;
    readonly target: HostedOperationRuntime["target"];
    readonly duration: HostedOperationRuntime["duration"];
    readonly resultFromState?: (
      state: Readonly<JsonObject>,
    ) => JsonObject;
    readonly fuseFromState?: (
      state: Readonly<JsonObject>,
    ) => JsonObject | null;
    readonly acknowledgeFuseResult?: (
      state: Readonly<JsonObject>,
      result: Readonly<JsonObject>,
    ) => JsonObject;
  },
): UnboundAgentOperationRuntime {
  const resultFromState =
    options.resultFromState ?? (() => EMPTY_RESULT_SCHEMA.parse({}));
  return {
    id: operation.id,
    displayName: options.displayName,
    trigger: "active_command",
    target: options.target,
    duration: options.duration,
    taskSlots: operation.taskSlots,
    eventIgnore: operation.eventIgnore,
    publicBehavior: operation.publicBehavior,
    domainFailures: hostedFailures(operation),
    arbitrationFailureMappings: operation.arbitrationFailureMappings,
    resultSchema: operation.resultSchema,
    stateSchema: operation.stateSchema,
    parametersSchema: options.parametersSchema,
    initialState: (context, _host, argumentsValue) =>
      operation.initialState(context, argumentsValue),
    resolveDuration: (context, _host, argumentsValue) =>
      operation.resolveDuration(context, argumentsValue),
    start: (_context, operationCall) => ({
      kind: "started",
      proposal: { effects: [] },
      nextState: operationCall.state,
    }),
    complete: (_context, operationCall) => ({
      effects: [],
      result: resultFromState(operationCall.state),
    }),
    fail: (_context, operationCall) => ({
      effects: [],
      result: resultFromState(operationCall.state),
    }),
    cancel: (_context, operationCall) => ({
      effects: [],
      result: resultFromState(operationCall.state),
    }),
    fuse: (_context, operationCall) =>
      options.fuseFromState?.(operationCall.state) ?? null,
    acknowledgeFuseResult: (_context, operationCall, result) =>
      options.acknowledgeFuseResult?.(operationCall.state, result) ??
      operationCall.state,
    mapArbitrationFailure: (_operationCall, failure) =>
      mapOperationArbitrationFailure(
        operation.arbitrationFailureMappings,
        hostedFailures(operation),
        failure,
      ),
  };
}

export const ReadOperationArgumentsSchema = z
  .object({ hostDefinitionId: OperationHostDefinitionIdSchema })
  .strict();

const ReadManualResultSchema = z
  .object({
    kind: z.literal("manual"),
    hostDefinitionId: OperationHostDefinitionIdSchema,
    hostKind: z.enum(["agent", "furniture"]),
    hostDisplayName: z.string().min(1).max(160),
    operations: z.array(OperationManualSchema),
  })
  .strict();
const ReadUnavailableResultSchema = z
  .object({
    kind: z.literal("unavailable"),
    hostDefinitionId: OperationHostDefinitionIdSchema,
    summary: z.string().min(1).max(500),
  })
  .strict();
const ReadCancelledResultSchema = z
  .object({
    kind: z.literal("cancelled"),
    hostDefinitionId: OperationHostDefinitionIdSchema,
  })
  .strict();
export const ReadOperationResultSchema = z.discriminatedUnion("kind", [
  ReadManualResultSchema,
  ReadUnavailableResultSchema,
  ReadCancelledResultSchema,
]);
const ReadOperationStateSchema = z
  .object({ result: ReadManualResultSchema.nullable() })
  .strict();
const ReadFailureDetailsSchema = z
  .object({ hostDefinitionId: OperationHostDefinitionIdSchema })
  .strict();

function staticHostManual(
  context: OperationRuntimeContext,
  hostDefinitionId: string,
): z.infer<typeof ReadManualResultSchema> | null {
  const agent = context.registry.getAgent(hostDefinitionId)?.definition;
  const object = context.registry.getObject(hostDefinitionId)?.definition;
  if (agent && object) {
    throw new Error(`Ambiguous operation host definition: ${hostDefinitionId}`);
  }
  if (agent) {
    return ReadManualResultSchema.parse({
      kind: "manual",
      hostDefinitionId,
      hostKind: "agent",
      hostDisplayName: agent.displayName,
      operations: [...agentOperationMounts(agent)]
        .sort((left, right) =>
          left.operationId.localeCompare(right.operationId),
        )
        .map((operation) => operation.manual),
    });
  }
  if (object) {
    return ReadManualResultSchema.parse({
      kind: "manual",
      hostDefinitionId,
      hostKind: "furniture",
      hostDisplayName: object.displayName,
      operations: [...object.interactions]
        .sort((left, right) =>
          left.manual.operationId.localeCompare(right.manual.operationId),
        )
        .map((interaction) => interaction.manual),
    });
  }
  return null;
}

function createReadRuntime(): UnboundAgentOperationRuntime {
  return {
    id: OperationIdSchema.parse("core.read"),
    displayName: "Read",
    trigger: "active_command",
    target: { kind: "none" },
    duration: { kind: "indeterminate" },
    taskSlots: ["HEAD"],
    eventIgnore: [],
    publicBehavior: { kind: "hidden" },
    domainFailures: [
      {
        code: "unknown_host_definition",
        summary: "The requested host definition does not exist",
        detailsSchema: ReadFailureDetailsSchema,
        resultSchema: ReadUnavailableResultSchema,
      },
    ],
    arbitrationFailureMappings: {},
    resultSchema: ReadOperationResultSchema,
    stateSchema: ReadOperationStateSchema,
    parametersSchema: ReadOperationArgumentsSchema,
    initialState: () => ({ result: null }),
    resolveDuration: () => ({ kind: "indeterminate" }),
    start: (context, operation) => {
      const { hostDefinitionId } = ReadOperationArgumentsSchema.parse(
        operation.arguments,
      );
      const result = staticHostManual(context, hostDefinitionId);
      if (!result) {
        return {
          kind: "domain_failure",
          code: "unknown_host_definition",
          details: { hostDefinitionId },
        };
      }
      return {
        kind: "started",
        proposal: { effects: [] },
        nextState: { result },
      };
    },
    tick: (_context, operation) => {
      const state = ReadOperationStateSchema.parse(operation.state);
      if (!state.result) {
        return {
          kind: "technical_failure",
          category: "protocol",
          code: "read_result_not_ready",
          message: "The local read result was not prepared during start.",
          retryable: false,
        };
      }
      return { kind: "complete", nextState: state };
    },
    complete: (_context, operation) => {
      const result = ReadOperationStateSchema.parse(operation.state).result;
      if (!result) throw new Error("Cannot complete read without a prepared result");
      return { effects: [], result };
    },
    fail: (_context, operation, failure) => {
      const { hostDefinitionId } = ReadFailureDetailsSchema.parse(
        failure.details,
      );
      ReadOperationArgumentsSchema.parse(operation.arguments);
      return {
        effects: [],
        result: {
          kind: "unavailable",
          hostDefinitionId,
          summary: "The requested host definition does not exist.",
        },
      };
    },
    cancel: (_context, operation) => ({
      effects: [],
      result: {
        kind: "cancelled",
        hostDefinitionId: ReadOperationArgumentsSchema.parse(
          operation.arguments,
        ).hostDefinitionId,
      },
    }),
    fuse: () => null,
    acknowledgeFuseResult: (_context, operation) => operation.state,
    mapArbitrationFailure: (_operationCall, failure) =>
      mapOperationArbitrationFailure({}, [], failure),
  };
}

const RecallOperationArgumentsSchema = z
  .object({ query: z.string().min(1) })
  .strict();
const SpeakOperationArgumentsSchema = z
  .object({
    content: z.string().min(1),
    volume: z.enum(["quiet", "normal", "loud"]),
  })
  .strict();

function unavailableRuntime(options: {
  readonly id: "core.recall" | "core.speak";
  readonly displayName: string;
  readonly parametersSchema: z.ZodType<JsonObject>;
  readonly publicBehavior: { readonly kind: "visible"; readonly label: string };
  readonly failureCode: string;
  readonly failureMessage: string;
}): UnboundAgentOperationRuntime {
  return {
    id: OperationIdSchema.parse(options.id),
    displayName: options.displayName,
    trigger: "active_command",
    target: { kind: "none" },
    duration: { kind: "indeterminate" },
    taskSlots: ["HEAD"],
    eventIgnore: [],
    publicBehavior: options.publicBehavior,
    domainFailures: [],
    arbitrationFailureMappings: {},
    resultSchema: EMPTY_RESULT_SCHEMA,
    stateSchema: EMPTY_OPERATION_STATE_SCHEMA,
    parametersSchema: options.parametersSchema,
    initialState: () => ({}),
    resolveDuration: () => ({ kind: "indeterminate" }),
    start: () => ({
      kind: "technical_failure",
      category: "configuration",
      code: options.failureCode,
      message: options.failureMessage,
      retryable: false,
    }),
    complete: () => {
      throw new Error(options.failureMessage);
    },
    fail: () => {
      throw new Error(options.failureMessage);
    },
    cancel: () => ({ effects: [], result: {} }),
    fuse: () => null,
    acknowledgeFuseResult: (_context, operation) => operation.state,
    mapArbitrationFailure: (_operationCall, failure) =>
      mapOperationArbitrationFailure({}, [], failure),
  };
}

function coreAgentOperationImplementations(): ReadonlyMap<
  OperationId,
  UnboundAgentOperationRuntime
> {
  const move = createMoveOperation();
  const observe = createObserveOperation();
  const wait = createWaitOperation();
  const implementations: readonly UnboundAgentOperationRuntime[] = [
    legacyCoreRuntime(move, {
      displayName: "Move",
      parametersSchema: ENTITY_TARGET_ARGUMENTS_SCHEMA,
      target: { kind: "object", requiredCapabilities: ["approachable"] },
      duration: { kind: "indeterminate" },
      resultFromState: moveResult,
      fuseFromState: moveResult,
      acknowledgeFuseResult: acknowledgeMoveResult,
    }),
    legacyCoreRuntime(observe, {
      displayName: "Observe",
      parametersSchema: ENTITY_TARGET_ARGUMENTS_SCHEMA,
      target: { kind: "object", requiredCapabilities: ["observable"] },
      duration: { kind: "fixed" },
    }),
    createReadRuntime(),
    unavailableRuntime({
      id: "core.recall",
      displayName: "Recall",
      parametersSchema: RecallOperationArgumentsSchema,
      publicBehavior: { kind: "visible", label: "thinking" },
      failureCode: "recall_runtime_unavailable",
      failureMessage:
        "Recall is unavailable until the L5 archive-memory runtime is connected.",
    }),
    unavailableRuntime({
      id: "core.speak",
      displayName: "Speak",
      parametersSchema: SpeakOperationArgumentsSchema,
      publicBehavior: { kind: "visible", label: "speaking" },
      failureCode: "speak_runtime_unavailable",
      failureMessage:
        "Speak is unavailable until the sound execution runtime is connected.",
    }),
    legacyCoreRuntime(wait, {
      displayName: "Wait",
      parametersSchema: WaitOperationArgumentsSchema,
      target: { kind: "none" },
      duration: { kind: "fixed" },
    }),
  ];
  return new Map(
    implementations.map((implementation) => [
      implementation.id,
      implementation,
    ]),
  );
}

export function bindAgentOperationRuntime(
  definition: AgentDefinition,
  mount: AgentOperationDefinition,
): HostedOperationRuntime {
  const implementation = coreAgentOperationImplementations().get(
    mount.operationId,
  );
  if (!implementation) {
    throw new Error(
      `Agent ${definition.id} mounts unknown core operation ${mount.operationId}`,
    );
  }
  const assertHostBinding = (
    context: OperationRuntimeContext,
    host: OperationHostReference,
  ): void => {
    if (host.kind !== "agent" || host.hostEntityId !== context.agentId) {
      throw new Error(
        `Agent operation ${mount.operationId} must be hosted by its acting character`,
      );
    }
    const agent = context.world.agents.get(context.agentId);
    if (agent?.definitionId !== definition.id) {
      throw new Error(
        `Agent operation ${mount.operationId} is mounted on ${definition.id}, not ${agent?.definitionId ?? "an unknown definition"}`,
      );
    }
  };
  const assertCallBinding = (
    context: OperationRuntimeContext,
    operation: Parameters<HostedOperationRuntime["start"]>[1],
  ): void => {
    assertHostBinding(context, operation.host);
    if (
      operation.operationId !== implementation.id ||
      operation.hostDefinition.kind !== "agent" ||
      operation.hostDefinition.hostDefinitionId !== definition.id
    ) {
      throw new Error(
        `Agent operation call is not bound to ${definition.id}:${implementation.id}`,
      );
    }
  };

  const runtime: HostedOperationRuntime = {
    ...implementation,
    ownerPluginId: null,
    host: { kind: "agent", hostDefinitionId: definition.id },
    manual: mount.manual,
    initialState: (context, host, argumentsValue) => {
      assertHostBinding(context, host);
      return implementation.initialState(context, host, argumentsValue);
    },
    resolveDuration: (context, host, argumentsValue) => {
      assertHostBinding(context, host);
      return implementation.resolveDuration(context, host, argumentsValue);
    },
    start: (context, operation) => {
      assertCallBinding(context, operation);
      return implementation.start(context, operation);
    },
    ...(implementation.tick
      ? {
          tick: (context, operation) => {
            assertCallBinding(context, operation);
            return implementation.tick!(context, operation);
          },
        }
      : {}),
    complete: (context, operation) => {
      assertCallBinding(context, operation);
      return implementation.complete(context, operation);
    },
    fail: (context, operation, failure) => {
      assertCallBinding(context, operation);
      return implementation.fail(context, operation, failure);
    },
    cancel: (context, operation) => {
      assertCallBinding(context, operation);
      return implementation.cancel(context, operation);
    },
    fuse: (context, operation) => {
      assertCallBinding(context, operation);
      return implementation.fuse(context, operation);
    },
    acknowledgeFuseResult: (context, operation, result) => {
      assertCallBinding(context, operation);
      return implementation.acknowledgeFuseResult(context, operation, result);
    },
  };
  assertHostedOperationContract(
    `Agent ${definition.id} operation ${mount.operationId}`,
    runtime,
  );
  return Object.freeze(runtime);
}

function operationIsMounted(
  context: OperationRuntimeContext,
  operationId: OperationId,
): boolean {
  const agent = context.world.agents.get(context.agentId);
  if (!agent) return false;
  const definition = context.registry.getAgent(agent.definitionId)?.definition;
  return (
    definition !== undefined &&
    agentOperationMounts(definition).some(
      (operation) => operation.operationId === operationId,
    )
  );
}

export function restrictLegacyAgentOperationToMounts(
  operation: RegisteredOperation,
): RegisteredOperation {
  return {
    ...operation,
    offers: (context) =>
      operationIsMounted(context, operation.id) ? operation.offers(context) : [],
    canStart: (context, argumentsValue) =>
      operationIsMounted(context, operation.id)
        ? operation.canStart(context, argumentsValue)
        : {
            available: false,
            reasonCode: "operation_not_mounted",
            summary: `Operation ${operation.id} is not mounted on this character definition`,
          },
  };
}

export function legacyCoreAgentOperations(): readonly RegisteredOperation[] {
  return [
    restrictLegacyAgentOperationToMounts(createWaitOperation()),
    restrictLegacyAgentOperationToMounts(createObserveOperation()),
    restrictLegacyAgentOperationToMounts(createMoveOperation()),
  ];
}

export function mountedAgentOperationRuntimes(
  definitions: Iterable<AgentDefinition>,
): readonly HostedOperationRuntime[] {
  return [...definitions]
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((definition) =>
      [...agentOperationMounts(definition)]
        .sort((left, right) =>
          left.operationId.localeCompare(right.operationId),
        )
        .map((mount) => bindAgentOperationRuntime(definition, mount)),
    );
}
