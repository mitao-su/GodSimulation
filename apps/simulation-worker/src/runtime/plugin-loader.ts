import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";

import { PluginLockSchema, type PluginLock } from "@god-sim/protocol";
import {
  PluginManifestSchema,
  type GamePlugin,
} from "@god-sim/plugin-sdk";

import {
  buildPluginLock,
  type PluginDescriptor,
} from "./plugin-lock";

function isGamePlugin(value: unknown): value is GamePlugin {
  if (typeof value !== "object" || value === null) return false;
  return "manifest" in value && "objects" in value && "agents" in value;
}
export interface LoadedPluginSet {
  readonly plugins: readonly GamePlugin[];
  readonly pluginLock: PluginLock;
}

export async function loadPluginSet(
  descriptors: readonly PluginDescriptor[],
  expectedLock?: PluginLock,
): Promise<LoadedPluginSet> {
  const pluginLock = await buildPluginLock(descriptors);
  if (expectedLock && PluginLockSchema.parse(expectedLock).hash !== pluginLock.hash) {
    throw new Error(
      `Plugin lock mismatch: expected ${expectedLock.hash}, found ${pluginLock.hash}`,
    );
  }
  const plugins = await Promise.all(
    descriptors.map(async (descriptor) => {
      const manifest = PluginManifestSchema.parse(
        JSON.parse(await readFile(descriptor.manifestPath, "utf8")),
      );
      const moduleValue: unknown = await import(pathToFileURL(descriptor.entryPath).href);
      const plugin =
        typeof moduleValue === "object" && moduleValue !== null && "default" in moduleValue
          ? moduleValue.default
          : undefined;
      if (!isGamePlugin(plugin)) {
        throw new Error(`Plugin entry ${descriptor.entryPath} has no valid default export`);
      }
      const runtimeManifest = PluginManifestSchema.parse(plugin.manifest);
      if (JSON.stringify(runtimeManifest) !== JSON.stringify(manifest)) {
        throw new Error(`Plugin entry manifest does not match ${descriptor.manifestPath}`);
      }
      return plugin;
    }),
  );
  return { plugins, pluginLock };
}
