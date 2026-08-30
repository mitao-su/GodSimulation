import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const manifestPaths = [
  "apps/web/package.json",
  "apps/local-server/package.json",
  "apps/simulation-worker/package.json",
  "packages/protocol/package.json",
  "packages/plugin-sdk/package.json",
  "packages/simulation/package.json",
  "packages/cognition/package.json",
  "packages/timeline/package.json",
  "packages/model-gateway/package.json",
  "packages/sqlite-store/package.json",
  "plugins/spatial-objects/package.json",
  "plugins/home-objects/package.json",
  "plugins/starter-agents/package.json",
] as const;

function readManifest(path: string): {
  readonly dependencies?: Readonly<Record<string, string>>;
} {
  return JSON.parse(readFileSync(path, "utf8")) as {
    readonly dependencies?: Readonly<Record<string, string>>;
  };
}

describe("workspace boundaries", () => {
  it("declares every architectural package as a workspace member", () => {
    expect(manifestPaths.filter((path) => !existsSync(path))).toEqual([]);
  });

  it("keeps the web app independent from the simulation package", () => {
    expect(existsSync("apps/web/package.json")).toBe(true);
    if (!existsSync("apps/web/package.json")) return;

    const manifest = readManifest("apps/web/package.json");
    expect(manifest.dependencies?.["@god-sim/simulation"]).toBeUndefined();
    expect(manifest.dependencies?.["@god-sim/protocol"]).toBe("workspace:*");
  });
});
