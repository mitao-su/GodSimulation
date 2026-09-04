import type { z } from "zod";

import {
  JsonObjectSchema,
  OperationDomainFailureSchema,
  OperationTechnicalFailureSchema,
  type JsonObject,
  type OperationDomainFailure,
  type OperationTechnicalFailure,
} from "@god-sim/protocol";
import {
  validateOperationDomainFailureOutcome,
  type HostedOperationDomainFailureDefinition,
} from "@god-sim/plugin-sdk";

const TECHNICAL_FAILURE_MESSAGE_LIMIT = 2_000;

export type OperationLifecyclePhase =
  | "start"
  | "tick"
  | "complete"
  | "fail"
  | "cancel"
  | "fuse";

export type OperationLifecycleInvocationResult<Result> =
  | { readonly kind: "returned"; readonly value: Result }
  | {
      readonly kind: "technical_failure";
      readonly failure: OperationTechnicalFailure;
    };

function boundedMessage(message: string): string {
  return message.slice(0, TECHNICAL_FAILURE_MESSAGE_LIMIT);
}

function errorDescription(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export function operationTechnicalFailure(
  category: OperationTechnicalFailure["category"],
  code: string,
  message: string,
  retryable: boolean,
): OperationTechnicalFailure {
  return OperationTechnicalFailureSchema.parse({
    kind: "technical_failure",
    category,
    code,
    message: boundedMessage(message),
    retryable,
  });
}

export function operationInvariantFailure(
  code: string,
  message: string,
): OperationTechnicalFailure {
  return operationTechnicalFailure("protocol", code, message, false);
}

export function invokeOperationLifecycle<Result>(
  phase: OperationLifecyclePhase,
  resultSchema: z.ZodType<Result>,
  invoke: () => unknown,
): OperationLifecycleInvocationResult<Result> {
  let candidate: unknown;
  try {
    candidate = invoke();
  } catch (error) {
    return {
      kind: "technical_failure",
      failure: operationTechnicalFailure(
        "plugin",
        `${phase}_lifecycle_exception`,
        `Operation ${phase} lifecycle threw: ${errorDescription(error)}`,
        true,
      ),
    };
  }

  let parsed: ReturnType<z.ZodType<Result>["safeParse"]>;
  try {
    parsed = resultSchema.safeParse(candidate);
  } catch (error) {
    return {
      kind: "technical_failure",
      failure: operationTechnicalFailure(
        "plugin",
        `${phase}_lifecycle_schema_exception`,
        `Operation ${phase} lifecycle result schema threw: ${errorDescription(error)}`,
        false,
      ),
    };
  }
  if (!parsed.success) {
    return {
      kind: "technical_failure",
      failure: operationTechnicalFailure(
        "plugin",
        `${phase}_lifecycle_invalid_result`,
        `Operation ${phase} lifecycle returned an invalid result: ${parsed.error.message}`,
        false,
      ),
    };
  }
  return { kind: "returned", value: parsed.data };
}

export function validateOperationResult(
  phase: Extract<OperationLifecyclePhase, "complete" | "fail" | "cancel" | "fuse">,
  resultSchema: z.ZodType<JsonObject>,
  resultValue: unknown,
): OperationLifecycleInvocationResult<JsonObject> {
  let parsed: ReturnType<z.ZodType<JsonObject>["safeParse"]>;
  try {
    parsed = resultSchema.safeParse(resultValue);
  } catch {
    return {
      kind: "technical_failure",
      failure: operationTechnicalFailure(
        "plugin",
        `${phase}_result_schema_exception`,
        `Operation ${phase} result schema threw while validating its result.`,
        false,
      ),
    };
  }
  let normalized: ReturnType<typeof JsonObjectSchema.safeParse> | undefined;
  try {
    normalized = parsed.success
      ? JsonObjectSchema.safeParse(parsed.data)
      : undefined;
  } catch {
    return {
      kind: "technical_failure",
      failure: operationTechnicalFailure(
        "protocol",
        `${phase}_result_not_json_object`,
        `Operation ${phase} result is not a JSON object.`,
        false,
      ),
    };
  }
  if (!parsed.success || !normalized?.success) {
    return {
      kind: "technical_failure",
      failure: operationTechnicalFailure(
        "plugin",
        `${phase}_result_schema_mismatch`,
        `Operation ${phase} result does not match resultSchema.`,
        false,
      ),
    };
  }
  return { kind: "returned", value: normalized.data };
}

export function validateDeclaredOperationFailure(
  catalog: readonly HostedOperationDomainFailureDefinition[],
  failureValue: unknown,
  resultValue: unknown,
): OperationLifecycleInvocationResult<{
  readonly failure: OperationDomainFailure;
  readonly result: JsonObject;
}> {
  let validated: ReturnType<typeof validateOperationDomainFailureOutcome>;
  try {
    validated = validateOperationDomainFailureOutcome(
      catalog,
      failureValue,
      resultValue,
    );
  } catch {
    return {
      kind: "technical_failure",
      failure: operationTechnicalFailure(
        "plugin",
        "domain_failure_schema_exception",
        "A domain failure schema threw while validating a lifecycle result.",
        false,
      ),
    };
  }
  if (validated.kind === "technical_failure") {
    return { kind: "technical_failure", failure: validated };
  }
  return {
    kind: "returned",
    value: { failure: validated.failure, result: validated.result },
  };
}

export function validateDeclaredOperationFailureInput(
  catalog: readonly HostedOperationDomainFailureDefinition[],
  failureValue: unknown,
): OperationLifecycleInvocationResult<OperationDomainFailure> {
  let failure: ReturnType<typeof OperationDomainFailureSchema.safeParse>;
  try {
    failure = OperationDomainFailureSchema.safeParse(failureValue);
  } catch {
    return {
      kind: "technical_failure",
      failure: operationTechnicalFailure(
        "plugin",
        "domain_failure_schema_exception",
        "The domain failure schema threw while validating a failure.",
        false,
      ),
    };
  }
  if (!failure.success) {
    return {
      kind: "technical_failure",
      failure: operationTechnicalFailure(
        "plugin",
        "invalid_domain_failure",
        "Operation returned a malformed domain failure.",
        false,
      ),
    };
  }
  const declaration = catalog.find((entry) => entry.code === failure.data.code);
  if (!declaration) {
    return {
      kind: "technical_failure",
      failure: operationTechnicalFailure(
        "plugin",
        "undeclared_domain_failure",
        `Operation returned undeclared domain failure ${failure.data.code}.`,
        false,
      ),
    };
  }
  let details: ReturnType<typeof declaration.detailsSchema.safeParse>;
  try {
    details = declaration.detailsSchema.safeParse(failure.data.details);
  } catch {
    return {
      kind: "technical_failure",
      failure: operationTechnicalFailure(
        "plugin",
        "domain_failure_schema_exception",
        `Operation domain failure ${failure.data.code} details schema threw.`,
        false,
      ),
    };
  }
  let normalized: ReturnType<typeof JsonObjectSchema.safeParse> | undefined;
  try {
    normalized = details.success
      ? JsonObjectSchema.safeParse(details.data)
      : undefined;
  } catch {
    return {
      kind: "technical_failure",
      failure: operationTechnicalFailure(
        "protocol",
        "invalid_domain_failure_details",
        `Operation domain failure ${failure.data.code} details are not a JSON object.`,
        false,
      ),
    };
  }
  if (!details.success || !normalized?.success) {
    return {
      kind: "technical_failure",
      failure: operationTechnicalFailure(
        "plugin",
        "invalid_domain_failure_details",
        `Operation domain failure ${failure.data.code} returned invalid details.`,
        false,
      ),
    };
  }
  return {
    kind: "returned",
    value: { ...failure.data, details: normalized.data },
  };
}
