import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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
  readonly sheets: readonly SheetRecord[];
  readonly resources: readonly {
    readonly id: string;
    readonly frames: Readonly<Record<string, FrameRecord>>;
  }[];
}

interface AnimationManifest {
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

describe("licensed asset manifests", () => {
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

  it("defines two complete 8 by 8 Memao character sheets", async () => {
    const assetRoot = resolve(root, "plugins/starter-agents/assets");
    const manifest = await readJson<AnimationManifest>(
      resolve(assetRoot, "animation-manifest.json"),
    );
    expect(manifest.sheets.map((sheet) => sheet.resourceId)).toEqual([
      "starter-agents.memao.alice",
      "starter-agents.memao.bob",
    ]);
    for (const sheet of manifest.sheets) {
      expect(sheet).toMatchObject({
        width: 384,
        height: 384,
        frameWidth: 48,
        frameHeight: 48,
        columns: 8,
        rows: 8,
      });
      expect(pngDimensions(await readFile(resolve(assetRoot, sheet.file)))).toEqual({
        width: sheet.width,
        height: sheet.height,
      });
    }
    const humanoid = manifest.animationSets.find(
      (animationSet) => animationSet.id === "starter-agents.memao.humanoid",
    );
    expect(humanoid).toBeDefined();
    for (const animation of Object.values(humanoid!.animations)) {
      for (const frames of Object.values(animation)) {
        expect(frames.length).toBeGreaterThan(0);
        expect(Math.max(...frames)).toBeLessThan(64);
        expect(Math.min(...frames)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("ships only the five selected runtime PNG files", async () => {
    const runtimeRoots = [
      resolve(root, "plugins/home-objects/assets"),
      resolve(root, "plugins/starter-agents/assets"),
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
      "plugins/home-objects/assets/pixel-16-interiors/carpets.png",
      "plugins/home-objects/assets/pixel-16-interiors/furniture.png",
      "plugins/home-objects/assets/pixel-16-interiors/tiles.png",
      "plugins/starter-agents/assets/memao/alice.png",
      "plugins/starter-agents/assets/memao/bob.png",
    ]);
  });
});
