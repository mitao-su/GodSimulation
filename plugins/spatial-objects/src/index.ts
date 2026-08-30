import manifestJson from "../plugin.json" with { type: "json" };

import { definePlugin, PluginManifestSchema } from "@god-sim/plugin-sdk";

import { doorDefinition } from "./objects/door/definition";
import { wallDefinition } from "./objects/wall/definition";

export { doorDefinition } from "./objects/door/definition";
export { wallDefinition } from "./objects/wall/definition";

export default definePlugin(PluginManifestSchema.parse(manifestJson), {
  objects: [wallDefinition, doorDefinition],
  agents: [],
});
