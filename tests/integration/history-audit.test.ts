import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DomainEventSchema, WorldSnapshotV2Schema } from "@god-sim/protocol";
import { createSqliteTimelineStore } from "@god-sim/sqlite-store";

const projectRoot = resolve(import.meta.dirname, "../..");
const auditScript = resolve(projectRoot, "scripts", "audit-world-history.mjs");
const temporaryDirectories: string[] = [];
const privateMarker = "PRIVATE_PROMPT_MUST_NOT_BE_PRINTED";

interface RawStatement {
  run(...parameters: readonly unknown[]): unknown;
}

interface RawDatabase {
  prepare(sql: string): RawStatement;
  close(): void;
}

const requireFromSqliteStore = createRequire(
  resolve(projectRoot, "packages", "sqlite-store", "package.json"),
);
const BetterSqlite3 = requireFromSqliteStore("better-sqlite3") as new (
  filename: string,
) => RawDatabase;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (path) => {
      const resolvedPath = resolve(path);
      if (
        dirname(resolvedPath) !== resolve(tmpdir()) ||
        !basename(resolvedPath).startsWith("god-simulation-audit-")
      ) {
        throw new Error(`Refusing to remove unexpected test directory: ${resolvedPath}`);
      }
      await rm(resolvedPath, { recursive: true, force: true });
    }),
  );
});

function runAudit(filename: string) {
  return spawnSync(process.execPath, [auditScript, filename], {
    cwd: projectRoot,
    encoding: "utf8",
  });
}

describe("world history audit", () => {
  it("accepts complete history and reports a missing causal Event without leaking state", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "god-simulation-audit-"));
    temporaryDirectories.push(runtimeRoot);
    const filename = join(runtimeRoot, "timeline.sqlite");
    const event = DomainEventSchema.parse({
      schemaVersion: 1,
      eventId: "event:starter-world:1",
      worldId: "starter-world",
      worldVersion: 1,
      worldTick: 1,
      sequence: 1,
      parentSequence: null,
      causationId: "cause:audit:1",
      correlationId: "cycle:audit:1",
      type: "decision_requested",
      agentId: "alice",
      requestId: "request:audit:1",
      decisionCycleId: "cycle:audit:1",
      reasonCode: "audit_fixture",
    });
    const snapshot = WorldSnapshotV2Schema.parse({
      schemaVersion: 2,
      worldId: "starter-world",
      worldVersion: 1,
      worldTick: 1,
      lastEventSequence: 1,
      pluginLockHash: "a".repeat(64),
      history: { mode: "strict", causalFromSequence: 1 },
      causalEventIds: [event.eventId],
      state: { privateMarker },
    });
    const store = await createSqliteTimelineStore({ filename });
    try {
      await store.commitCheckpoint({
        checkpointId: "checkpoint:starter-world:1:1" as never,
        events: [event],
        snapshot,
      });
    } finally {
      await store.close();
    }

    const valid = runAudit(filename);
    expect(valid.status).toBe(0);
    expect(valid.stdout).toContain("integrity: ok");
    expect(valid.stdout).toContain("missing causal events: 0");
    expect(`${valid.stdout}\n${valid.stderr}`).not.toContain(privateMarker);

    const raw = new BetterSqlite3(filename);
    try {
      raw.prepare("DELETE FROM events WHERE event_id = ?").run(event.eventId);
    } finally {
      raw.close();
    }

    const invalid = runAudit(filename);
    expect(invalid.status).not.toBe(0);
    expect(`${invalid.stdout}\n${invalid.stderr}`).toMatch(/missing causal event/i);
    expect(`${invalid.stdout}\n${invalid.stderr}`).toContain(event.eventId);
    expect(`${invalid.stdout}\n${invalid.stderr}`).not.toContain(privateMarker);
  });
});
