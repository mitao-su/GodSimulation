import pino, { type DestinationStream, type Logger } from "pino";

export interface DevelopmentLoggerOptions {
  readonly filename: string;
  readonly knownSecrets?: readonly string[];
  readonly level?: string;
}

function redactText(value: string, knownSecrets: readonly string[]): string {
  let redacted = value;
  for (const secret of knownSecrets) {
    if (secret.length > 0) redacted = redacted.replaceAll(secret, "[REDACTED]");
  }
  return redacted.replace(/Bearer\s+[^\s"',;}]+/giu, "Bearer [REDACTED]");
}

export async function createDevelopmentLogger(
  options: DevelopmentLoggerOptions,
): Promise<Logger> {
  const destination = pino.destination({ dest: options.filename, mkdir: true, sync: true });
  const redactingDestination: DestinationStream = {
    write(chunk): void {
      destination.write(redactText(String(chunk), options.knownSecrets ?? []));
    },
  };
  return pino(
    {
      level: options.level ?? "info",
      redact: {
        paths: [
          "authorization",
          "apiKey",
          "*.authorization",
          "*.apiKey",
          "*.*.authorization",
          "*.*.apiKey",
        ],
        censor: "[REDACTED]",
      },
    },
    redactingDestination,
  );
}
