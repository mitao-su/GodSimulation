import type { GamePlugin } from "@god-sim/plugin-sdk";

import { createOperationRegistry } from "../execution/operation-registry";
import type { OperationRegistry } from "../execution/operation-runtime";
import {
  createPluginRegistry,
  type PluginRegistry,
} from "../world/plugin-registry";

export interface SimulationRegistry
  extends PluginRegistry,
    OperationRegistry {}

export function createSimulationRegistry(
  plugins: readonly GamePlugin[],
): SimulationRegistry {
  const pluginRegistry = createPluginRegistry(plugins);
  const operationRegistry = createOperationRegistry(pluginRegistry);
  return { ...pluginRegistry, ...operationRegistry };
}
