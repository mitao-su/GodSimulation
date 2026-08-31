import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, searchForWorkspaceRoot } from "vite";

const appRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@god-sim/protocol": resolve(appRoot, "../../packages/protocol/src/index.ts"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    fs: { allow: [searchForWorkspaceRoot(appRoot)] },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4317",
        ws: true,
      },
    },
  },
});
