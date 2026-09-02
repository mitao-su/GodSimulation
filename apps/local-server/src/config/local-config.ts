import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import type { ModelConfig } from "@god-sim/model-gateway";

export interface LocalPluginDescriptor {
  readonly manifestPath: string;
  readonly entryPath: string;
}

export type LocalDecisionProviderConfig =
  | { readonly kind: "fixed" }
  | { readonly kind: "openrouter"; readonly model: ModelConfig };

export interface LocalConfigDiagnostics {
  readonly provider: LocalDecisionProviderConfig["kind"];
  readonly modelId: string;
  readonly modelConfigSource: string | null;
  readonly host: string;
  readonly port: number;
}

export interface LocalConfig {
  readonly projectRoot: string;
  readonly host: string;
  readonly port: number;
  readonly worldDefinitionPath: string;
  readonly rulesDirectory: string;
  readonly databaseFilename: string;
  readonly logFilename: string;
  readonly webRoot: string;
  readonly workerEntryPath: string;
  readonly workerExecArgv: readonly string[];
  readonly pluginDescriptors: readonly LocalPluginDescriptor[];
  readonly reviewRequired: boolean;
  readonly deterministicSeed: number;
  readonly decisionProvider: LocalDecisionProviderConfig;
  readonly diagnostics: LocalConfigDiagnostics;
  readonly knownSecrets: readonly string[];
}

export interface LoadLocalConfigOptions {
  readonly projectRoot?: string;
  readonly workingDirectory?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

async function findProjectRoot(workingDirectory: string): Promise<string> {
  let current = resolve(workingDirectory);
  while (true) {
    try {
      await access(resolve(current, "pnpm-workspace.yaml"));
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        throw new Error(`Unable to locate pnpm-workspace.yaml from ${workingDirectory}`);
      }
      current = parent;
    }
  }
}

function resolveFrom(projectRoot: string, value: string): string {
  return isAbsolute(value) ? value : resolve(projectRoot, value);
}

function parseInteger(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function parsePort(value: string | undefined): number {
  const port = parseInteger("GOD_SIM_PORT", value, 4317);
  if (port < 1 || port > 65_535) throw new Error("GOD_SIM_PORT must be between 1 and 65535");
  return port;
}

function parseBoolean(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`${name} must be true or false`);
}

function parseEnvFile(contents: string): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const sourceLine of contents.replace(/^\uFEFF/u, "").split(/\r?\n/u)) {
    const line = sourceLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error("Invalid entry in local model configuration");
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function required(values: Readonly<Record<string, string>>, key: string): string {
  const value = values[key]?.trim();
  if (!value) throw new Error(`Local model configuration is missing ${key}`);
  return value;
}

function completionEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  let path = url.pathname.replace(/\/+$/u, "");
  if (url.hostname === "openrouter.ai" && path === "/api") {
    path = "/api/v1";
  }
  if (!path.endsWith("/chat/completions")) url.pathname = `${path}/chat/completions`;
  return url.toString().replace(/\/$/u, "");
}

async function loadDecisionProvider(
  projectRoot: string,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<{
  readonly provider: LocalDecisionProviderConfig;
  readonly source: string | null;
  readonly secrets: readonly string[];
}> {
  const kind = environment.GOD_SIM_DECISION_PROVIDER ?? "openrouter";
  if (kind === "fixed") return { provider: { kind: "fixed" }, source: null, secrets: [] };
  if (kind !== "openrouter") {
    throw new Error("GOD_SIM_DECISION_PROVIDER must be openrouter or fixed");
  }

  const source = resolveFrom(
    projectRoot,
    environment.GOD_SIM_MODEL_CONFIG ?? "free_model.local",
  );
  let contents: string;
  try {
    contents = await readFile(source, "utf8");
  } catch (error) {
    throw new Error(`Unable to read local model configuration at ${source}`, { cause: error });
  }
  const values = parseEnvFile(contents);
  const apiKey = required(values, "API_KEY");
  const model: ModelConfig = {
    endpoint: completionEndpoint(required(values, "BASE_URL")),
    apiKey,
    model: required(values, "MODEL"),
    timeoutMs: parseInteger("MODEL_TIMEOUT_MS", values.MODEL_TIMEOUT_MS, 120_000),
    appTitle: "God Simulation",
  };
  return { provider: { kind: "openrouter", model }, source, secrets: [apiKey] };
}

export async function loadLocalConfig(options: LoadLocalConfigOptions = {}): Promise<LocalConfig> {
  const projectRoot = options.projectRoot
    ? resolve(options.projectRoot)
    : await findProjectRoot(options.workingDirectory ?? process.cwd());
  const environment = options.environment ?? process.env;
  const decision = await loadDecisionProvider(projectRoot, environment);
  const host = environment.GOD_SIM_HOST ?? "127.0.0.1";
  const port = parsePort(environment.GOD_SIM_PORT);
  const pluginDescriptors = ["spatial-objects", "home-objects", "starter-agents"].map(
    (name): LocalPluginDescriptor => ({
      manifestPath: resolve(projectRoot, "plugins", name, "plugin.json"),
      entryPath: resolve(projectRoot, "plugins", name, "dist", "index.js"),
    }),
  );
  const workerEntryPath = resolveFrom(
    projectRoot,
    environment.GOD_SIM_WORKER_ENTRY ?? "apps/simulation-worker/src/index.ts",
  );
  return {
    projectRoot,
    host,
    port,
    worldDefinitionPath: resolveFrom(
      projectRoot,
      environment.GOD_SIM_WORLD ?? "content/worlds/starter-home/world.json",
    ),
    rulesDirectory: resolve(projectRoot, "content", "rules"),
    databaseFilename: resolveFrom(
      projectRoot,
      environment.GOD_SIM_DATABASE ?? "data/god-simulation.sqlite",
    ),
    logFilename: resolveFrom(
      projectRoot,
      environment.GOD_SIM_LOG ?? "data/logs/local-server.ndjson",
    ),
    webRoot: resolveFrom(projectRoot, environment.GOD_SIM_WEB_ROOT ?? "apps/web/dist"),
    workerEntryPath,
    workerExecArgv: workerEntryPath.endsWith(".ts") ? ["--import", "tsx"] : [],
    pluginDescriptors,
    reviewRequired: parseBoolean(
      "GOD_SIM_REVIEW_REQUIRED",
      environment.GOD_SIM_REVIEW_REQUIRED,
      true,
    ),
    deterministicSeed: parseInteger(
      "GOD_SIM_DETERMINISTIC_SEED",
      environment.GOD_SIM_DETERMINISTIC_SEED,
      1,
    ),
    decisionProvider: decision.provider,
    diagnostics: {
      provider: decision.provider.kind,
      modelId:
        decision.provider.kind === "openrouter" ? decision.provider.model.model : "fixed",
      modelConfigSource: decision.source,
      host,
      port,
    },
    knownSecrets: decision.secrets,
  };
}
