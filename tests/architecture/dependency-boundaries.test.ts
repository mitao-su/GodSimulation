import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

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
  readonly name: string;
  readonly dependencies?: Readonly<Record<string, string>>;
} {
  return JSON.parse(readFileSync(path, "utf8")) as {
    readonly name: string;
    readonly dependencies?: Readonly<Record<string, string>>;
  };
}

function manifestFor(name: string) {
  const path = manifestPaths.find((candidate) => readManifest(candidate).name === name);
  if (!path) throw new Error(`Missing manifest for ${name}`);
  return readManifest(path);
}

function workspaceDependencies(manifest: ReturnType<typeof readManifest>): string[] {
  return Object.keys(manifest.dependencies ?? {}).filter((name) => name.startsWith("@god-sim/"));
}

const allowed = {
  "@god-sim/protocol": [],
  "@god-sim/plugin-sdk": ["@god-sim/protocol"],
  "@god-sim/simulation": ["@god-sim/plugin-sdk", "@god-sim/protocol"],
  "@god-sim/cognition": ["@god-sim/plugin-sdk", "@god-sim/protocol"],
  "@god-sim/timeline": ["@god-sim/protocol"],
  "@god-sim/model-gateway": ["@god-sim/protocol"],
  "@god-sim/sqlite-store": ["@god-sim/protocol", "@god-sim/timeline"],
  "@god-sim/web": ["@god-sim/protocol"],
  "@god-sim/simulation-worker": [
    "@god-sim/cognition",
    "@god-sim/plugin-sdk",
    "@god-sim/protocol",
    "@god-sim/simulation",
  ],
  "@god-sim/local-server": [
    "@god-sim/model-gateway",
    "@god-sim/protocol",
    "@god-sim/sqlite-store",
    "@god-sim/timeline",
  ],
  "@god-sim/spatial-objects": ["@god-sim/plugin-sdk", "@god-sim/protocol"],
  "@god-sim/home-objects": ["@god-sim/plugin-sdk", "@god-sim/protocol"],
  "@god-sim/starter-agents": ["@god-sim/plugin-sdk", "@god-sim/protocol"],
} as const;

const workspaceRoots: Readonly<Record<keyof typeof allowed, string>> = {
  "@god-sim/protocol": "packages/protocol",
  "@god-sim/plugin-sdk": "packages/plugin-sdk",
  "@god-sim/simulation": "packages/simulation",
  "@god-sim/cognition": "packages/cognition",
  "@god-sim/timeline": "packages/timeline",
  "@god-sim/model-gateway": "packages/model-gateway",
  "@god-sim/sqlite-store": "packages/sqlite-store",
  "@god-sim/web": "apps/web",
  "@god-sim/simulation-worker": "apps/simulation-worker",
  "@god-sim/local-server": "apps/local-server",
  "@god-sim/spatial-objects": "plugins/spatial-objects",
  "@god-sim/home-objects": "plugins/home-objects",
  "@god-sim/starter-agents": "plugins/starter-agents",
};

interface PathRestriction {
  readonly path?: string;
  readonly pathNot?: string;
}

interface DependencyRule {
  readonly from: PathRestriction;
  readonly to: PathRestriction;
}

const require = createRequire(import.meta.url);
const dependencyConfig = require("../../.dependency-cruiser.cjs") as {
  readonly forbidden: readonly DependencyRule[];
};

function restrictionMatches(restriction: PathRestriction, path: string): boolean {
  if (restriction.path && !new RegExp(restriction.path, "u").test(path)) return false;
  if (restriction.pathNot && new RegExp(restriction.pathNot, "u").test(path)) return false;
  return true;
}

function isForbidden(from: string, to: string): boolean {
  return dependencyConfig.forbidden.some(
    (rule) =>
      rule.from.path !== undefined &&
      rule.to.path !== undefined &&
      restrictionMatches(rule.from, from) &&
      restrictionMatches(rule.to, to),
  );
}

describe("workspace boundaries", () => {
  it("declares every architectural package as a workspace member", () => {
    expect(manifestPaths.filter((path) => !existsSync(path))).toEqual([]);
  });

  it("declares exactly the allowed production workspace dependencies", () => {
    for (const [name, expected] of Object.entries(allowed)) {
      expect(workspaceDependencies(manifestFor(name)).sort(), name).toEqual(
        [...expected].sort(),
      );
    }
  });

  it("forbids every unlisted production workspace import by path and alias", () => {
    for (const [fromName, fromRoot] of Object.entries(workspaceRoots)) {
      const allowedTargets = new Set<string>([
        fromName,
        ...allowed[fromName as keyof typeof allowed],
      ]);
      const source = `${fromRoot}/src/example.ts`;
      for (const [toName, toRoot] of Object.entries(workspaceRoots)) {
        const expectedForbidden = !allowedTargets.has(toName);
        expect(isForbidden(source, toName), `${fromName} -> ${toName}`).toBe(
          expectedForbidden,
        );
        expect(
          isForbidden(source, `${toRoot}/src/index.ts`),
          `${fromRoot} -> ${toRoot}`,
        ).toBe(expectedForbidden);
      }
    }
  });

  it("allows official plugin composition only from test files", () => {
    const productionSource = "apps/simulation-worker/src/runtime/world-session.ts";
    const testSource = "apps/simulation-worker/src/runtime/world-session.test.ts";

    expect(isForbidden(productionSource, "@god-sim/home-objects")).toBe(true);
    expect(isForbidden(testSource, "@god-sim/home-objects")).toBe(false);
    expect(isForbidden(testSource, "@god-sim/local-server")).toBe(true);
  });
});
