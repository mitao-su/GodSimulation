import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "es2024",
  sourcemap: true,
  clean: true,
  noExternal: [/^@god-sim\//],
});
