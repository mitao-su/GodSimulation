import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { PluginLockSchema, type PluginLock } from "@god-sim/protocol";

import type { LocalPluginDescriptor } from "../config/local-config";

interface ManifestFingerprint {
  readonly id: string;
  readonly version: string;
  readonly stateVersion: number;
  readonly entry: string;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseManifestFingerprint(value: unknown, source: string): ManifestFingerprint {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Plugin manifest ${source} must be an object`);
  }
  const manifest = value as Record<string, unknown>;
  if (
    typeof manifest.id !== "string" ||
    manifest.id.length === 0 ||
    typeof manifest.version !== "string" ||
    manifest.version.length === 0 ||
    typeof manifest.entry !== "string" ||
    manifest.entry.length === 0 ||
    !Number.isInteger(manifest.stateVersion) ||
    Number(manifest.stateVersion) < 1
  ) {
    throw new Error(`Plugin manifest ${source} has invalid lock metadata`);
  }
  return {
    id: manifest.id,
    version: manifest.version,
    stateVersion: Number(manifest.stateVersion),
    entry: manifest.entry,
  };
}

export async function buildExpectedPluginLock(
  descriptors: readonly LocalPluginDescriptor[],
): Promise<PluginLock> {
  if (descriptors.length === 0) throw new Error("At least one plugin descriptor is required");
  const entries = await Promise.all(
    descriptors.map(async (descriptor) => {
      const [manifestText, entryBytes] = await Promise.all([
        readFile(descriptor.manifestPath, "utf8"),
        readFile(descriptor.entryPath),
      ]);
      const manifest = parseManifestFingerprint(
        JSON.parse(manifestText) as unknown,
        descriptor.manifestPath,
      );
      const manifestEntryPath = resolve(dirname(descriptor.manifestPath), manifest.entry);
      if (resolve(descriptor.entryPath) !== manifestEntryPath) {
        throw new Error(
          `Plugin manifest entry ${manifestEntryPath} does not match ${descriptor.entryPath}`,
        );
      }
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
