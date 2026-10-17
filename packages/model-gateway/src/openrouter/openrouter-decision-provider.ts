import { z } from "zod";

import {
  DirectTaskDecisionSchema,
  ModelDecisionRequestSchema,
  TaskDecisionSchema,
  type ModelDecisionRequest,
  type ModelDecisionProposal,
} from "@god-sim/protocol";

import { ModelConfigSchema, type ModelConfig } from "../config/model-config";
import type { DecisionProvider } from "../decision-provider";

const OpenRouterResponseSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z
              .object({
                content: z.string().min(1),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

function redact(message: string, apiKey: string): string {
  return message
    .replaceAll(apiKey, "[REDACTED]")
    .replace(/Bearer\s+[^\s,;]+/giu, "Bearer [REDACTED]");
}

function responseFormat(direct: boolean) {
  const legacySelection = {
    anyOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["kind"],
        properties: { kind: { const: "continue" } },
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "taskOptionId", "arguments"],
        properties: {
          kind: { const: "replace" },
          taskOptionId: { type: "string" },
          arguments: { type: "object", additionalProperties: true },
        },
      },
    ],
  };
  const directSelection = {
    anyOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["kind"],
        properties: { kind: { const: "continue" } },
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "task"],
        properties: {
          kind: { const: "replace" },
          task: {
            anyOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["kind"],
                properties: { kind: { const: "empty_task" } },
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["kind", "operationId", "arguments"],
                properties: {
                  kind: { const: "operation" },
                  operationId: { type: "string" },
                  hostEntityId: { type: "string" },
                  arguments: { type: "object", additionalProperties: true },
                },
              },
            ],
          },
        },
      },
    ],
  };
  const selection = direct ? directSelection : legacySelection;
  return {
    type: "json_schema",
    json_schema: {
      name: direct ? "direct_task_decision" : "task_decision",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["schemaVersion", "head", "body", "reason"],
        properties: {
          schemaVersion: { const: direct ? 3 : 2 },
          head: selection,
          body: selection,
          reason: { type: "string" },
          ...(direct
            ? { goalUpdates: { type: "object", additionalProperties: true } }
            : {}),
        },
      },
    },
  };
}

export class OpenRouterDecisionProvider implements DecisionProvider {
  readonly #config: ModelConfig;
  readonly #fetch: typeof fetch;

  constructor(configValue: ModelConfig, fetchImplementation: typeof fetch = fetch) {
    this.#config = ModelConfigSchema.parse(configValue);
    this.#fetch = fetchImplementation;
  }

  async decide(
    requestValue: ModelDecisionRequest,
    signal: AbortSignal,
  ): Promise<ModelDecisionProposal> {
    const request = ModelDecisionRequestSchema.parse(requestValue);
    const direct = request.taskOptions === undefined;
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.#config.apiKey}`,
      "content-type": "application/json",
      ...(this.#config.appUrl === undefined ? {} : { "http-referer": this.#config.appUrl }),
      ...(this.#config.appTitle === undefined ? {} : { "x-title": this.#config.appTitle }),
    };
    try {
      const response = await this.#fetch(this.#config.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.#config.model,
          messages: request.messages,
          response_format: responseFormat(direct),
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.#config.timeoutMs)]),
      });
      if (!response.ok) {
        throw new Error(`OpenRouter request failed with HTTP ${response.status}`);
      }
      const envelope = OpenRouterResponseSchema.parse(await response.json());
      const content = envelope.choices[0]!.message.content;
      let parsedContent: unknown;
      try {
        parsedContent = JSON.parse(content);
      } catch (error) {
        throw new Error("OpenRouter assistant content was not valid JSON", { cause: error });
      }
      return direct
        ? DirectTaskDecisionSchema.parse(parsedContent)
        : TaskDecisionSchema.parse(parsedContent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(redact(message, this.#config.apiKey));
    }
  }
}
