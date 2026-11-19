import { type Coordinate, type Facing } from "@god-sim/protocol";

export function facingToward(from: Coordinate, to: Coordinate): Facing | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx !== 0 && Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "east" : "west";
  if (dy !== 0) return dy > 0 ? "south" : "north";
  return undefined;
}
