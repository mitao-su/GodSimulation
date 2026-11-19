import { z } from "zod";

import { type ObjectDefinition } from "@god-sim/plugin-sdk";

const fixedFurnitureState = z.object({}).strict();
type Placement = ObjectDefinition["placement"];

function fixedFurniture(
  name: string,
  displayName: string,
  footprint: Placement["footprint"] = [{ x: 0, y: 0 }],
  approach: Placement["interactionOffsets"][number] = { x: 0, y: 1 },
): ObjectDefinition<z.infer<typeof fixedFurnitureState>> {
  return {
    id: `home.${name}`,
    version: "0.1.0",
    stateVersion: 1,
    displayName,
    tags: ["home", "furniture"],
    capabilities: ["approachable", "observable"],
    stateSchema: fixedFurnitureState,
    initialState: () => ({}),
    resourceId: `modern-pixel.${name}`,
    placement: { kind: "cell", footprint, interactionOffsets: [approach] },
    movement: { blocksMovement: () => true },
    interactions: [],
    observe: () => ({ status: "solid", summary: displayName, details: {} }),
  };
}

export const fixedFurnitureDefinitions = [
  fixedFurniture("bookcase", "Bookcase"),
  fixedFurniture("sofa", "Sofa", [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], { x: -1, y: 1 }),
  fixedFurniture("plant", "Potted plant"),
  fixedFurniture("coffee-table", "Coffee table"),
  fixedFurniture("records", "Record console"),
  fixedFurniture("media-stand", "TV console"),
  fixedFurniture("wardrobe", "Wardrobe"),
  fixedFurniture("bed", "Bed", [{ x: 0, y: 0 }, { x: 0, y: 1 }], { x: 0, y: 2 }),
  fixedFurniture("nightstand", "Nightstand"),
  fixedFurniture("desk", "Desk", undefined, { x: -1, y: 1 }),
  fixedFurniture("chair", "Desk chair", undefined, { x: 0, y: -1 }),
  fixedFurniture("cooktop", "Cooktop"),
  fixedFurniture("counter", "Kitchen counter"),
  fixedFurniture("sink", "Kitchen sink"),
  fixedFurniture("bathtub", "Bathtub", [{ x: 0, y: 0 }, { x: 1, y: 0 }], { x: 1, y: 1 }),
  fixedFurniture("vanity", "Bathroom vanity"),
  fixedFurniture("washer", "Washing machine"),
];
