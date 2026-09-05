import { z } from "zod";

import {
  AgentIdSchema,
  CoordinateSchema,
  EntityIdSchema,
  JsonObjectSchema,
  type JsonObject,
  type OperationDurationDeclaration,
  type OperationManual,
  type OperationTargetRequirement,
} from "@god-sim/protocol";

import type { EffectProposal } from "../effect/effect-proposal";
import type {
  HostedOperationDefinition,
  HostedOperationDomainFailureDefinition,
  OperationContract,
} from "../operation/operation-contract";
import { TriggerSourceSchema } from "../trigger/trigger-source";

export const InteractionContextSchema = z
  .object({
    worldTick: z.number().int().nonnegative(),
    trigger: TriggerSourceSchema,
    object: z
      .object({
        entityId: EntityIdSchema,
        version: z.number().int().nonnegative(),
      })
      .strict(),
    actor: z
      .object({
        agentId: AgentIdSchema,
        position: CoordinateSchema,
        needs: z.object({ bladder: z.number().int().min(0).max(100) }).strict(),
      })
      .strict(),
    distance: z.number().int().nonnegative(),
  })
  .strict();

export type InteractionContext = z.infer<typeof InteractionContextSchema>;

export const InteractionAvailabilitySchema = z.discriminatedUnion("available", [
  z.object({ available: z.literal(true) }).strict(),
  z
    .object({
      available: z.literal(false),
      reasonCode: z.string().min(1),
      summary: z.string().min(1).max(500),
    })
    .strict(),
]);

export type InteractionAvailability = z.infer<typeof InteractionAvailabilitySchema>;

export interface InteractionLifecycleProposal extends EffectProposal {
  readonly result?: JsonObject;
}

export interface InteractionDefinition<
  State,
  Arguments extends JsonObject = Record<string, never>,
> extends OperationContract<State, InteractionContext, Arguments> {
  readonly id: string;
  readonly displayName: string;
  readonly trigger: "active_command";
  readonly manual: OperationManual;
  readonly target: OperationTargetRequirement;
  readonly duration: OperationDurationDeclaration;
  readonly domainFailures: readonly HostedOperationDomainFailureDefinition[];
  canStart(
    state: Readonly<State>,
    context: InteractionContext,
    argumentsValue: Readonly<Arguments>,
  ): InteractionAvailability;
  start?(
    state: Readonly<State>,
    context: InteractionContext,
    argumentsValue: Readonly<Arguments>,
  ): EffectProposal;
  complete(
    state: Readonly<State>,
    context: InteractionContext,
    argumentsValue: Readonly<Arguments>,
  ): InteractionLifecycleProposal;
  fail(
    state: Readonly<State>,
    context: InteractionContext,
    argumentsValue: Readonly<Arguments>,
    failureCode: string,
  ): InteractionLifecycleProposal;
  cancel(
    state: Readonly<State>,
    context: InteractionContext,
    argumentsValue: Readonly<Arguments>,
  ): InteractionLifecycleProposal;
}

export type HostedInteractionDefinition<
  State,
  Arguments extends JsonObject = Record<string, never>,
  OperationState extends JsonObject = JsonObject,
> = HostedOperationDefinition<
  State,
  InteractionContext,
  Arguments,
  OperationState
>;

const EmptyInteractionOperationStateSchema = z.object({}).strict();

/**
 * 把仍由旧候选生产路径消费的对象交互绑定到统一 hosted 契约。
 * W1-X 删除候选路径后，宿主 operation 仍沿用这里形成的生命周期形状。
 */
export function bindHostedInteractionDefinition<
  State,
  Arguments extends JsonObject = Record<string, never>,
>(
  interaction: InteractionDefinition<State, Arguments>,
): HostedInteractionDefinition<State, Arguments, Record<string, never>> {
  if (interaction.manual === undefined) {
    throw new Error(`Object operation ${interaction.id} requires a static manual`);
  }
  if (interaction.target === undefined) {
    throw new Error(`Object operation ${interaction.id} requires a target declaration`);
  }
  if (interaction.duration === undefined) {
    throw new Error(`Object operation ${interaction.id} requires a duration declaration`);
  }
  if (interaction.publicBehavior === undefined) {
    throw new Error(
      `Object operation ${interaction.id} requires a public behavior declaration`,
    );
  }
  for (const [name, value] of [
    ["completion", interaction.complete],
    ["failure", interaction.fail],
    ["cancel", interaction.cancel],
    ["fuse", interaction.fuse],
  ] as const) {
    if (typeof value !== "function") {
      throw new Error(`Object operation ${interaction.id} requires a ${name} lifecycle`);
    }
  }
  const terminalProposal = (proposal: InteractionLifecycleProposal) => ({
    ...proposal,
    result: JsonObjectSchema.parse(proposal.result ?? {}),
  });

  return {
    id: interaction.manual.operationId,
    displayName: interaction.displayName,
    trigger: interaction.trigger,
    manual: interaction.manual,
    target: interaction.target,
    duration: interaction.duration,
    taskSlots: interaction.taskSlots,
    parametersSchema: interaction.parametersSchema,
    eventIgnore: interaction.eventIgnore,
    publicBehavior: interaction.publicBehavior,
    domainFailures: interaction.domainFailures,
    arbitrationFailureMappings: interaction.arbitrationFailureMappings,
    resultSchema: interaction.resultSchema,
    stateSchema: EmptyInteractionOperationStateSchema,
    initialState: () => ({}),
    resolveDuration: interaction.resolveDuration,
    start: (state, context, argumentsValue) => ({
      kind: "started",
      proposal: interaction.start?.(state, context, argumentsValue) ?? {
        effects: [],
      },
      nextState: {},
    }),
    complete: (state, context, argumentsValue) =>
      terminalProposal(interaction.complete(state, context, argumentsValue)),
    fail: (state, context, argumentsValue, _operationState, failure) =>
      terminalProposal(
        interaction.fail(
          state,
          context,
          argumentsValue,
          failure.code,
        ),
      ),
    cancel: (state, context, argumentsValue) =>
      terminalProposal(interaction.cancel(state, context, argumentsValue)),
    fuse: (state, context, argumentsValue) =>
      interaction.fuse(state, context, argumentsValue),
    acknowledgeFuseResult: (_state, _context, _argumentsValue, operationState) =>
      operationState,
  };
}

export const InteractionMetadataSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    trigger: z.literal("active_command"),
  })
  .strict();
