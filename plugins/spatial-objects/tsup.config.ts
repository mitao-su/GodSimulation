import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  entry: ["src/index.ts"],
  format: ["esm"],
  noExternal: [/^@god-sim\//, "zod"],
  platform: "node",
  target: "node24",
});
