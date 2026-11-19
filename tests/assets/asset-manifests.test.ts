import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import world from "../../content/worlds/starter-home/world.json" with { type: "json" };

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

interface SheetRecord {
  readonly id: string;
  readonly file: string;
  readonly width: number;
  readonly height: number;
}

interface FrameRecord {
  readonly sheetId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface AssetManifest {
  readonly pixelsPerTile: number;
  readonly sheets: readonly SheetRecord[];
  readonly resources: readonly {
    readonly id: string;
    readonly frames: Readonly<Record<string, FrameRecord>>;
  }[];
}

interface AnimationManifest {
  readonly pixelsPerTile: number;
  readonly sheets: readonly (SheetRecord & {
    readonly resourceId: string;
    readonly frameWidth: number;
    readonly frameHeight: number;
    readonly columns: number;
    readonly rows: number;
  })[];
  readonly animationSets: readonly {
    readonly id: string;
    readonly animations: Readonly<
      Record<string, Readonly<Record<"north" | "east" | "south" | "west", readonly number[]>>>
    >;
  }[];
}

function pngDimensions(bytes: Buffer): { readonly width: number; readonly height: number } {
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

describe("Starter Home runtime art", () => {
  it("keeps every declared rectangle inside its source PNG", async () => {
    const assetRoot = resolve(root, "plugins/home-objects/assets");
    const manifest = await readJson<AssetManifest>(resolve(assetRoot, "asset-manifest.json"));
    const sheets = new Map(manifest.sheets.map((sheet) => [sheet.id, sheet]));

    for (const sheet of manifest.sheets) {
      expect(pngDimensions(await readFile(resolve(assetRoot, sheet.file)))).toEqual({
        width: sheet.width,
        height: sheet.height,
      });
    }
    for (const resource of manifest.resources) {
      for (const frame of Object.values(resource.frames)) {
        const sheet = sheets.get(frame.sheetId);
        expect(sheet, `${resource.id} references ${frame.sheetId}`).toBeDefined();
        expect(frame.x).toBeGreaterThanOrEqual(0);
        expect(frame.y).toBeGreaterThanOrEqual(0);
        expect(frame.width).toBeGreaterThan(0);
        expect(frame.height).toBeGreaterThan(0);
        expect(frame.x + frame.width).toBeLessThanOrEqual(sheet!.width);
        expect(frame.y + frame.height).toBeLessThanOrEqual(sheet!.height);
      }
    }
  });

  it("defines every frame placed in the four rooms", async () => {
    const manifest = await readJson<AssetManifest>(
      resolve(root, "plugins/home-objects/assets/asset-manifest.json"),
    );
    for (const { resourceId, frameId } of [...world.floorRegions, ...world.decorations]) {
      const resource = manifest.resources.find(({ id }) => id === resourceId);
      expect(resource?.frames[frameId], resourceId + "." + frameId).toBeDefined();
    }
    const directionalFurniture = new Map([
      ["living-sofa", "modern-pixel.sofa"],
      ["bedroom-chair", "modern-pixel.chair"],
      ["fridge-1", "modern-pixel.refrigerator"],
      ["toilet-1", "modern-pixel.toilet"],
    ]);
    for (const [entityId, resourceId] of directionalFurniture) {
      const object = world.objects.find(({ id }) => id === entityId);
      if (!object) throw new Error("Starter Home is missing " + entityId);
      const frames = manifest.resources.find(({ id }) => id === resourceId)?.frames;
      const placed = frames?.[object.facing];
      expect(placed, resourceId + "." + object.facing).toBeDefined();
      expect(placed, resourceId).not.toEqual(frames?.default);
    }
  });

  it("keeps every floor variant at native art density independently of the logical grid", async () => {
    const manifest = await readJson<AssetManifest>(
      resolve(root, "plugins/home-objects/assets/asset-manifest.json"),
    );
    expect(manifest.pixelsPerTile).toBe(96);
    expect(world.tileSize).toBe(16);
    for (const { resourceId, frameId } of world.floorRegions) {
      const frames = manifest.resources.find(({ id }) => id === resourceId)?.frames;
      for (const name of [frameId, ...[1, 2, 3].map((variant) => frameId + "." + variant)]) {
        expect(frames?.[name], name).toMatchObject({
          width: manifest.pixelsPerTile,
          height: manifest.pixelsPerTile,
        });
      }
    }
  });

  it("provides idle, walking and interaction in four directions for both characters", async () => {
    const assetRoot = resolve(root, "plugins/starter-agents/assets");
    const manifest = await readJson<AnimationManifest>(
      resolve(assetRoot, "animation-manifest.json"),
    );
    expect(manifest.pixelsPerTile).toBe(96);
    expect(manifest.sheets.map((sheet) => sheet.resourceId)).toEqual([
      "starter-agents.modern-pixel.alice",
      "starter-agents.modern-pixel.bob",
    ]);
    for (const sheet of manifest.sheets) {
      expect(sheet.frameWidth).toBe(144);
      expect(sheet.frameHeight).toBe(168);
      expect(pngDimensions(await readFile(resolve(assetRoot, sheet.file)))).toEqual({
        width: sheet.frameWidth * sheet.columns,
        height: sheet.frameHeight * sheet.rows,
      });
    }
    const humanoid = manifest.animationSets.find(
      (animationSet) => animationSet.id === "starter-agents.modern-pixel.humanoid",
    );
    expect(humanoid).toBeDefined();
    for (const id of ["idle", "walk", "interact"]) {
      for (const facing of ["north", "east", "south", "west"] as const) {
        const frames = humanoid!.animations[id]?.[facing] ?? [];
        expect(new Set(frames).size).toBeGreaterThanOrEqual(id === "idle" ? 1 : 2);
        expect(Math.min(...frames)).toBeGreaterThanOrEqual(0);
        for (const sheet of manifest.sheets) {
          expect(Math.max(...frames)).toBeLessThan(sheet.columns * sheet.rows);
        }
      }
    }
  });

  it("ships only the five selected runtime PNG files", async () => {
    const runtimeRoots = [
      resolve(root, "plugins/home-objects/assets/modern-pixel"),
      resolve(root, "plugins/starter-agents/assets/modern-pixel"),
    ];
    const pngFiles: string[] = [];
    for (const runtimeRoot of runtimeRoots) {
      const pending = [runtimeRoot];
      while (pending.length > 0) {
        const directory = pending.pop()!;
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const path = resolve(directory, entry.name);
          if (entry.isDirectory()) pending.push(path);
          else if (entry.name.endsWith(".png")) {
            pngFiles.push(path.slice(root.length + 1).replaceAll("\\", "/"));
          }
        }
      }
    }
    pngFiles.sort();
    expect(pngFiles).toEqual([
      "plugins/home-objects/assets/modern-pixel/furniture.png",
      "plugins/home-objects/assets/modern-pixel/textiles.png",
      "plugins/home-objects/assets/modern-pixel/tiles.png",
      "plugins/starter-agents/assets/modern-pixel/alice.png",
      "plugins/starter-agents/assets/modern-pixel/bob.png",
    ]);
  });
});
