import type { Coordinate } from "@god-sim/protocol";

import type { MapDefinition, ZoneDefinition } from "./map-definition";

function coordinateKey(position: Coordinate): string {
  return `${position.x},${position.y}`;
}

export class ZoneIndex {
  readonly #zonesByCell = new Map<string, ZoneDefinition>();

  constructor(map: MapDefinition) {
    for (const zone of map.zones) {
      for (let y = zone.y; y < zone.y + zone.height; y += 1) {
        for (let x = zone.x; x < zone.x + zone.width; x += 1) {
          const key = coordinateKey({ x, y });
          if (this.#zonesByCell.has(key)) {
            throw new Error(`Map zones overlap at ${key}`);
          }
          this.#zonesByCell.set(key, zone);
        }
      }
    }
  }

  at(position: Coordinate): ZoneDefinition | undefined {
    return this.#zonesByCell.get(coordinateKey(position));
  }
}
