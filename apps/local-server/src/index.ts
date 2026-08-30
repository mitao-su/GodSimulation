import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { startLocalServer } from "./bootstrap/start-local-server";

export * from "./bootstrap/start-local-server";
export * from "./config/local-config";
export * from "./decisions/decision-request-coordinator";
export * from "./logging/development-logger";
export * from "./persistence/persistence-writer";
export * from "./plugins/expected-plugin-lock";
export * from "./sessions/session-coordinator";
export * from "./sessions/worker-supervisor";
export * from "./transport/http-routes";
export * from "./transport/static-web";
export * from "./transport/world-websocket";

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void startLocalServer()
    .then((running) => {
      const stop = (): void => {
        void running.stop().finally(() => process.exit(0));
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
