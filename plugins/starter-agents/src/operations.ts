import { z } from "zod";

import {
  operationParametersJsonSchema,
  type AgentOperationDefinition,
} from "@god-sim/plugin-sdk";
import {
  EntityIdSchema,
  OperationHostDefinitionIdSchema,
  OperationIdSchema,
} from "@god-sim/protocol";

const entityTargetSchema = z.object({ targetEntityId: EntityIdSchema }).strict();
const readSchema = z
  .object({ hostDefinitionId: OperationHostDefinitionIdSchema })
  .strict();
const recallSchema = z.object({ query: z.string().min(1) }).strict();
const speakSchema = z
  .object({
    content: z.string().min(1),
    volume: z.enum(["quiet", "normal", "loud"]),
  })
  .strict();
const waitSchema = z
  .object({ durationTicks: z.number().int().positive() })
  .strict();
const operationId = (value: string) => OperationIdSchema.parse(value);

export const starterAgentOperations = [
  {
    operationId: operationId("core.move"),
    manual: {
      operationId: operationId("core.move"),
      displayName: "Move",
      summary: "Move to an approachable object.",
      taskSlots: ["BODY"],
      parametersSchema: operationParametersJsonSchema(entityTargetSchema),
      target: { kind: "object", requiredCapabilities: ["approachable"] },
      duration: { kind: "indeterminate" },
      worldPreconditions: [
        { failureCode: "unknown_target", description: "The target may no longer exist." },
        { failureCode: "no_known_route", description: "No known route may reach the target." },
        { failureCode: "movement_blocked", description: "Movement may become blocked." },
      ],
    },
  },
  {
    operationId: operationId("core.observe"),
    manual: {
      operationId: operationId("core.observe"),
      displayName: "Observe",
      summary: "Observe a currently visible object.",
      taskSlots: ["HEAD"],
      parametersSchema: operationParametersJsonSchema(entityTargetSchema),
      target: { kind: "object", requiredCapabilities: ["observable"] },
      duration: { kind: "fixed" },
      worldPreconditions: [
        { failureCode: "target_not_visible", description: "The target must be visible." },
      ],
    },
  },
  {
    operationId: operationId("core.read"),
    manual: {
      operationId: operationId("core.read"),
      displayName: "Read",
      summary: "Read the static operation manual for a host definition.",
      taskSlots: ["HEAD"],
      parametersSchema: operationParametersJsonSchema(readSchema),
      target: { kind: "none" },
      duration: { kind: "indeterminate" },
      worldPreconditions: [
        {
          failureCode: "unknown_host_definition",
          description: "The requested host definition must exist.",
        },
      ],
    },
  },
  {
    operationId: operationId("core.recall"),
    manual: {
      operationId: operationId("core.recall"),
      displayName: "Recall",
      summary: "Search this character's archived memories.",
      taskSlots: ["HEAD"],
      parametersSchema: operationParametersJsonSchema(recallSchema),
      target: { kind: "none" },
      duration: { kind: "indeterminate" },
      worldPreconditions: [],
    },
  },
  {
    operationId: operationId("core.speak"),
    manual: {
      operationId: operationId("core.speak"),
      displayName: "Speak",
      summary: "Speak using quiet, normal, or loud volume.",
      taskSlots: ["HEAD"],
      parametersSchema: operationParametersJsonSchema(speakSchema),
      target: { kind: "none" },
      duration: { kind: "indeterminate" },
      worldPreconditions: [],
    },
  },
  {
    operationId: operationId("core.wait"),
    manual: {
      operationId: operationId("core.wait"),
      displayName: "Wait",
      summary: "Wait for a positive number of ticks.",
      taskSlots: ["BODY"],
      parametersSchema: operationParametersJsonSchema(waitSchema),
      target: { kind: "none" },
      duration: { kind: "fixed" },
      worldPreconditions: [
        {
          failureCode: "invalid_duration",
          description: "The duration must fit the world's configured limit.",
        },
      ],
    },
  },
] as const satisfies readonly AgentOperationDefinition[];
