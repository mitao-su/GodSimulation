import manifestJson from "../plugin.json" with { type: "json" };

import { definePlugin, PluginManifestSchema } from "@god-sim/plugin-sdk";

import { aliceDefinition } from "./agents/alice";
import { bobDefinition } from "./agents/bob";

export { aliceDefinition } from "./agents/alice";
export { bobDefinition } from "./agents/bob";

export default definePlugin(PluginManifestSchema.parse(manifestJson), {
  objects: [],
  agents: [aliceDefinition, bobDefinition],
});
