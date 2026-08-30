import { access, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import {
  FixedDecisionProvider,
  OpenRouterDecisionProvider,
  type DecisionProvider,
} from "@god-sim/model-gateway";
import { JsonValueSchema, WorldIdSchema } from "@god-sim/protocol";
import { createSqliteTimelineStore } from "@god-sim/sqlite-store";

import { loadLocalConfig, type LocalConfig } from "../config/local-config";
import { createDevelopmentLogger } from "../logging/development-logger";
import { PersistenceWriter } from "../persistence/persistence-writer";
import { buildExpectedPluginLock } from "../plugins/expected-plugin-lock";
import type { SessionClientPort } from "../sessions/session-coordinator";
import { SessionCoordinator } from "../sessions/session-coordinator";
import { ProcessWorkerSupervisor } from "../sessions/worker-supervisor";
import { registerHttpRoutes } from "../transport/http-routes";
import { registerStaticWeb } from "../transport/static-web";
import { registerWorldWebSocket } from "../transport/world-websocket";

export interface CreateLocalServerAppOptions {
  readonly session: SessionClientPort;
  readonly logger?: FastifyBaseLogger | false;
  readonly staticRoot?: string;
}

export async function createLocalServerApp(
  options: CreateLocalServerAppOptions,
): Promise<FastifyInstance> {
  const app = options.logger
    ? Fastify({ loggerInstance: options.logger })
    : Fastify({ logger: false });
  registerHttpRoutes(app, options.session);
  await registerWorldWebSocket(app, options.session);
  if (options.staticRoot) await registerStaticWeb(app, options.staticRoot);
  await app.ready();
  return app;
}

export interface StartLocalServerOptions {
  readonly config?: LocalConfig;
  readonly decisionProvider?: DecisionProvider;
  readonly listen?: boolean;
  readonly serveStaticWeb?: boolean;
}

export interface RunningLocalServer {
  readonly app: FastifyInstance;
  readonly config: LocalConfig;
  readonly url: string | null;
  stop(): Promise<void>;
}

function configuredDecisionProvider(config: LocalConfig): DecisionProvider {
  if (config.decisionProvider.kind === "openrouter") {
    return new OpenRouterDecisionProvider(config.decisionProvider.model);
  }
  return new FixedDecisionProvider({ defaultGoalKind: "wait" });
}

async function staticRoot(config: LocalConfig, enabled: boolean): Promise<string | undefined> {
  if (!enabled) return undefined;
  try {
    await access(join(config.webRoot, "index.html"));
    return config.webRoot;
  } catch {
    return undefined;
  }
}

export async function startLocalServer(
  options: StartLocalServerOptions = {},
): Promise<RunningLocalServer> {
  const config = options.config ?? (await loadLocalConfig());
  await Promise.all([
    mkdir(dirname(config.databaseFilename), { recursive: true }),
    mkdir(dirname(config.logFilename), { recursive: true }),
  ]);
  const logger = await createDevelopmentLogger({
    filename: config.logFilename,
    knownSecrets: config.knownSecrets,
  });
  const [worldText, pluginLock, store] = await Promise.all([
    readFile(config.worldDefinitionPath, "utf8"),
    buildExpectedPluginLock(config.pluginDescriptors),
    createSqliteTimelineStore({ filename: config.databaseFilename }),
  ]);
  const worldDefinition = JsonValueSchema.parse(JSON.parse(worldText) as unknown);
  const worldId = WorldIdSchema.parse(
    typeof worldDefinition === "object" &&
      worldDefinition !== null &&
      !Array.isArray(worldDefinition) &&
      "id" in worldDefinition
      ? worldDefinition.id
      : undefined,
  );
  const persistence = new PersistenceWriter(store);
  await persistence.savePluginLock({
    worldId,
    pluginLock,
    recordedAtRealTime: new Date().toISOString(),
  });
  const worker = new ProcessWorkerSupervisor({
    entryPath: config.workerEntryPath,
    pluginDescriptors: config.pluginDescriptors,
    cwd: config.projectRoot,
    execArgv: config.workerExecArgv,
  });
  const session = new SessionCoordinator({
    worker,
    decisionProvider: options.decisionProvider ?? configuredDecisionProvider(config),
    persistence,
    modelId: config.diagnostics.modelId,
    onError(error): void {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message.slice(0, 2_000) }, "Session coordination failed");
    },
  });
  let app: FastifyInstance | null = null;
  try {
    await session.start({
      type: "initialize",
      protocolVersion: 1,
      worldDefinition,
      pluginLock,
      reviewRequired: config.reviewRequired,
      deterministicSeed: config.deterministicSeed,
    });
    const configuredStaticRoot = await staticRoot(config, options.serveStaticWeb ?? true);
    app = await createLocalServerApp({
      session,
      logger,
      ...(configuredStaticRoot === undefined ? {} : { staticRoot: configuredStaticRoot }),
    });
    const url = options.listen === false
      ? null
      : await app.listen({ host: config.host, port: config.port });
    logger.info({ ...config.diagnostics, url }, "Local server started");
    let stopped = false;
    return {
      app,
      config,
      url,
      async stop(): Promise<void> {
        if (stopped) return;
        stopped = true;
        await app?.close();
        await session.stop();
        logger.info("Local server stopped");
        logger.flush();
      },
    };
  } catch (error) {
    await app?.close();
    await session.stop();
    throw error;
  }
}
