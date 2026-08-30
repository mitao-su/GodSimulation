import type { PluginLock, WorldId } from "@god-sim/protocol";

export interface PluginLockRecord {
  readonly worldId: WorldId;
  readonly pluginLock: PluginLock;
  readonly recordedAtRealTime: string;
}
