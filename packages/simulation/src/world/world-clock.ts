import type { WorldState } from "./world-state";

export function advanceWorldClock(world: WorldState): WorldState {
  if (world.mode !== "RUNNING") return world;
  return { ...world, version: world.version + 1, tick: world.tick + 1 };
}
