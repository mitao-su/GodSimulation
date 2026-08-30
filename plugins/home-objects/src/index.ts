import manifestJson from "../plugin.json" with { type: "json" };

import { definePlugin, PluginManifestSchema } from "@god-sim/plugin-sdk";

import { refrigeratorDefinition } from "./objects/refrigerator/definition";
import { toiletDefinition } from "./objects/toilet/definition";

export { refrigeratorDefinition } from "./objects/refrigerator/definition";
export { toiletDefinition } from "./objects/toilet/definition";

export default definePlugin(PluginManifestSchema.parse(manifestJson), {
  objects: [refrigeratorDefinition, toiletDefinition],
  agents: [],
});
