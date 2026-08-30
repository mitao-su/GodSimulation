import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { PluginLockSchema, type PluginLock } from "@god-sim/protocol";
import { PluginManifestSchema } from "@god-sim/plugin-sdk";

export interface PluginDescriptor {
  readonly manifestPath: string;
  readonly entryPath: string;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function buildPluginLock(
  descriptors: readonly PluginDescriptor[],
): Promise<PluginLock> {
  if (descriptors.length === 0) throw new Error("At least one plugin descriptor is required");
  const entries = await Promise.all(
    descriptors.map(async (descriptor) => {
      const [manifestText, entryBytes] = await Promise.all([
        readFile(descriptor.manifestPath, "utf8"),
        readFile(descriptor.entryPath),
      ]);
      const manifest = PluginManifestSchema.parse(JSON.parse(manifestText));
      return {
        pluginId: manifest.id,
        version: manifest.version,
        stateVersion: manifest.stateVersion,
        buildHash: sha256(entryBytes),
      };
    }),
  );
  entries.sort((left, right) => left.pluginId.localeCompare(right.pluginId));
  const duplicate = entries.find(
    (entry, index) => index > 0 && entries[index - 1]?.pluginId === entry.pluginId,
  );
  if (duplicate) throw new Error(`Duplicate plugin descriptor: ${duplicate.pluginId}`);
  return PluginLockSchema.parse({ hash: sha256(JSON.stringify(entries)), entries });
}

export async function verifyPluginLock(
  descriptors: readonly PluginDescriptor[],
  expected: PluginLock,
): Promise<void> {
  const actual = await buildPluginLock(descriptors);
  if (actual.hash !== expected.hash) {
    throw new Error(`Plugin lock mismatch: expected ${expected.hash}, found ${actual.hash}`);
  }
}
