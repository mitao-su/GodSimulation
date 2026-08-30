import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@god-sim/cognition": `${root}packages/cognition/src/index.ts`,
      "@god-sim/home-objects": `${root}plugins/home-objects/src/index.ts`,
      "@god-sim/model-gateway": `${root}packages/model-gateway/src/index.ts`,
      "@god-sim/plugin-sdk": `${root}packages/plugin-sdk/src/index.ts`,
      "@god-sim/protocol": `${root}packages/protocol/src/index.ts`,
      "@god-sim/simulation": `${root}packages/simulation/src/index.ts`,
      "@god-sim/spatial-objects": `${root}plugins/spatial-objects/src/index.ts`,
      "@god-sim/sqlite-store": `${root}packages/sqlite-store/src/index.ts`,
      "@god-sim/starter-agents": `${root}plugins/starter-agents/src/index.ts`,
      "@god-sim/timeline": `${root}packages/timeline/src/index.ts`,
    },
  },
  test: {
    clearMocks: true,
    include: ["**/*.test.{ts,tsx}"],
    passWithNoTests: false,
    restoreMocks: true,
  },
});

