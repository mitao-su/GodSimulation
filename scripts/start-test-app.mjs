import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadLocalConfig, startLocalServer } from "../apps/local-server/src/index.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const supportedScenarios = new Set([
  "basic-loop",
  "bladder-toilet",
  "review-mode",
  "technical-retry",
]);

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function operation(operationId, argumentsValue, hostEntityId) {
  return {
    kind: "replace",
    task: {
      kind: "operation",
      operationId,
      ...(hostEntityId === undefined ? {} : { hostEntityId }),
      arguments: argumentsValue,
    },
  };
}

function directDecision(body, reason) {
  return {
    schemaVersion: 3,
    head: { kind: "continue" },
    body,
    reason,
  };
}

function waitForDelay(milliseconds, signal) {
  if (milliseconds === 0) return Promise.resolve();
  return new Promise((resolveDelay, rejectDelay) => {
    const timer = setTimeout(resolveDelay, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        rejectDelay(signal.reason);
      },
      { once: true },
    );
  });
}

class ScenarioDecisionProvider {
  #scenario;
  #technicalFailureRequestId = null;

  constructor(scenario) {
    this.#scenario = scenario;
  }

  async decide(request, signal) {
    if (
      this.#scenario === "technical-retry" &&
      request.agentId === "alice" &&
      request.decisionReason.code === "initial_goal" &&
      request.retryOfRequestId === undefined &&
      (this.#technicalFailureRequestId === null ||
        this.#technicalFailureRequestId === request.requestId)
    ) {
      this.#technicalFailureRequestId = request.requestId;
      await waitForDelay(250, signal);
      throw new Error("Deterministic model outage");
    }

    const thinkingDelay =
      request.decisionReason.code === "initial_goal" ||
      request.decisionReason.code === "perceived_goal_conflict" ||
      request.decisionReason.code === "urgent_bladder"
        ? 1_500
        : 20;
    await waitForDelay(thinkingDelay, signal);

    if (this.#scenario === "basic-loop") {
      const bobAlreadyNearFridge = request.agentId === "bob";
      return request.decisionReason.code === "initial_goal" && !bobAlreadyNearFridge
        ? directDecision(
            operation("core.move", { targetEntityId: "fridge-1" }),
            `Deterministic ${this.#scenario} decision`,
          )
        : directDecision(
            operation("object.home.refrigerator.use", {}, "fridge-1"),
            `Deterministic ${this.#scenario} decision`,
          );
    }
    if (
      this.#scenario === "bladder-toilet" &&
      request.agentId === "alice" &&
      request.decisionReason.code !== "initial_goal"
    ) {
      return request.decisionReason.code === "urgent_bladder"
        ? directDecision(operation("core.move", { targetEntityId: "toilet-1" }), `Deterministic ${this.#scenario} decision`)
        : directDecision(
            operation("object.home.toilet.use", {}, "toilet-1"),
            `Deterministic ${this.#scenario} decision`,
          );
    }
    return directDecision(
      operation("core.wait", { durationTicks: 600 }),
      `Deterministic ${this.#scenario} decision`,
    );
  }
}

async function scenarioWorld(scenario, runtimeRoot) {
  const source = join(projectRoot, "content", "worlds", "starter-home", "world.json");
  const world = JSON.parse(await readFile(source, "utf8"));
  if (scenario === "bladder-toilet") {
    world.spawns = world.spawns.map((spawn) =>
      spawn.agentId === "alice"
        ? { ...spawn, needs: { ...spawn.needs, bladder: 74 } }
        : { ...spawn, needs: { ...spawn.needs, bladder: 0 } },
    );
  }
  const destination = join(runtimeRoot, "world.json");
  await writeFile(destination, `${JSON.stringify(world, null, 2)}\n`, "utf8");
  return destination;
}

async function removeRuntimeRoot(runtimeRoot) {
  const resolvedRoot = resolve(runtimeRoot);
  if (
    dirname(resolvedRoot) !== resolve(tmpdir()) ||
    !basename(resolvedRoot).startsWith("god-simulation-e2e-")
  ) {
    throw new Error(`Refusing to remove unexpected test directory: ${resolvedRoot}`);
  }
  await rm(resolvedRoot, { recursive: true, force: true });
}

async function main() {
  const scenario = argument("scenario", "basic-loop");
  if (!supportedScenarios.has(scenario)) throw new Error(`Unsupported test scenario: ${scenario}`);
  const port = Number(argument("port", "4411"));
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Test app port must be an integer between 1 and 65535");
  }

  const runtimeRoot = await mkdtemp(join(tmpdir(), "god-simulation-e2e-"));
  let running = null;
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await running?.stop();
    } finally {
      await removeRuntimeRoot(runtimeRoot);
    }
  };

  try {
    const worldDefinitionPath = await scenarioWorld(scenario, runtimeRoot);
    const environment = {
      ...process.env,
      GOD_SIM_DECISION_PROVIDER: "fixed",
      GOD_SIM_HOST: "127.0.0.1",
      GOD_SIM_PORT: String(port),
      GOD_SIM_WORLD: worldDefinitionPath,
      GOD_SIM_DATABASE: join(runtimeRoot, "timeline.sqlite"),
      GOD_SIM_LOG: join(runtimeRoot, "local-server.ndjson"),
      GOD_SIM_WEB_ROOT: join(projectRoot, "apps", "web", "dist"),
      GOD_SIM_REVIEW_REQUIRED: "true",
      GOD_SIM_DETERMINISTIC_SEED: "1",
    };
    const config = await loadLocalConfig({ projectRoot, environment });
    running = await startLocalServer({
      config,
      decisionProvider: new ScenarioDecisionProvider(scenario),
      serveStaticWeb: true,
    });
    process.stdout.write(`${JSON.stringify({ status: "ready", scenario, url: running.url })}\n`);

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (value) => {
      if (value.toString().trim() === "shutdown") void stop();
    });
    process.once("SIGINT", () => void stop());
    process.once("SIGTERM", () => void stop());
  } catch (error) {
    await stop();
    throw error;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
