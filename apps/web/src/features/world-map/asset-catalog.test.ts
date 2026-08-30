import { describe, expect, it } from "vitest";

import { parseAssetCatalog } from "./asset-catalog";

const animationManifest = {
  schemaVersion: 1,
  sheets: [],
  resources: [],
  animationSets: [],
};

describe("asset catalog", () => {
  it("rejects a frame that references an undeclared sheet", () => {
    expect(() =>
      parseAssetCatalog(
        {
          schemaVersion: 1,
          sheets: [],
          resources: [
            {
              id: "pixel-16-interiors.floor",
              anchor: { x: 0, y: 0 },
              frames: {
                default: {
                  sheetId: "missing-sheet",
                  x: 0,
                  y: 0,
                  width: 16,
                  height: 16,
                },
              },
            },
          ],
        },
        animationManifest,
      ),
    ).toThrow(/missing-sheet/);
  });

  it("indexes a valid static frame by stable resource ID", () => {
    const catalog = parseAssetCatalog(
      {
        schemaVersion: 1,
        sheets: [{ id: "tiles", file: "tiles.png", width: 32, height: 32 }],
        resources: [
          {
            id: "pixel-16-interiors.floor",
            anchor: { x: 0, y: 0 },
            frames: {
              default: { sheetId: "tiles", x: 0, y: 0, width: 16, height: 16 },
            },
          },
        ],
      },
      animationManifest,
    );

    expect(catalog.staticResources.get("pixel-16-interiors.floor")?.frames.default).toEqual({
      sheetId: "tiles",
      x: 0,
      y: 0,
      width: 16,
      height: 16,
    });
  });
});
