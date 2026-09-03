import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { describe, expect, it } from "vitest";

import type { DatabaseSchema } from "../database-schema";
import { createSqliteTimelineStore } from "../sqlite-timeline-store";
import { migrateInitialSchema } from "./001-initial";

describe("architecture hardening migration", () => {
  it("adds nullable identity columns without changing version-one rows", async () => {
    const directory = await mkdtemp(join(tmpdir(), "god-sim-migration-"));
    const filename = join(directory, "legacy.sqlite");
    const snapshotPayload = JSON.stringify({
      schemaVersion: 1,
      worldId: "starter-world",
      worldVersion: 1,
      worldTick: 1,
      lastEventSequence: 1,
      pluginLockHash: "a".repeat(64),
      state: { marker: "preserve exactly" },
    });
    const eventPayload = JSON.stringify({ marker: "legacy event bytes" });

    try {
      const sqlite = new BetterSqlite3(filename);
      const database = new Kysely<DatabaseSchema>({
        dialect: new SqliteDialect({ database: sqlite }),
      });
      await migrateInitialSchema(database);
      sqlite
        .prepare("INSERT INTO worlds (world_id, created_at) VALUES (?, ?)")
        .run("starter-world", "2026-08-31T00:00:00.000Z");
      sqlite
        .prepare(
          "INSERT INTO events (world_id, sequence, event_id, world_version, world_tick, event_type, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "starter-world",
          1,
          "event:starter-world:1",
          1,
          1,
          "decision_requested",
          eventPayload,
        );
      sqlite
        .prepare(
          "INSERT INTO snapshots (world_id, world_version, world_tick, last_event_sequence, payload_json) VALUES (?, ?, ?, ?, ?)",
        )
        .run("starter-world", 1, 1, 1, snapshotPayload);
      sqlite
        .prepare(
          "INSERT INTO model_calls (request_id, world_id, world_version, agent_id, model_id, status, goal_option_id, response_reason, latency_ms, retry_of_request_id, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "request:1",
          "starter-world",
          1,
          "alice",
          "legacy-model",
          "accepted",
          "goal-option:legacy:wait",
          null,
          5,
          null,
          "2026-08-31T00:00:00.000Z",
        );
      await database.destroy();

      const firstOpen = await createSqliteTimelineStore({ filename });
      await firstOpen.close();
      const secondOpen = await createSqliteTimelineStore({ filename });
      await secondOpen.close();

      const migrated = new BetterSqlite3(filename, { readonly: true });
      try {
        const snapshot = migrated
          .prepare(
            "SELECT payload_json, checkpoint_id FROM snapshots WHERE world_id = ?",
          )
          .get("starter-world") as {
          payload_json: string;
          checkpoint_id: string | null;
        };
        const event = migrated
          .prepare("SELECT payload_json FROM events WHERE event_id = ?")
          .get("event:starter-world:1") as { payload_json: string };
        const modelCall = migrated
          .prepare(
            "SELECT protocol_schema_version, decision_cycle_id, plugin_lock_hash, decision_reason_code, goal_option_id, task_decision_json FROM model_calls WHERE request_id = ?",
          )
          .get("request:1") as Record<string, unknown>;
        const indexes = migrated
          .prepare("PRAGMA index_list(snapshots)")
          .all() as Array<{ name: string; unique: number }>;

        expect(snapshot).toEqual({
          payload_json: snapshotPayload,
          checkpoint_id: null,
        });
        expect(event.payload_json).toBe(eventPayload);
        expect(modelCall).toEqual({
          protocol_schema_version: null,
          decision_cycle_id: null,
          plugin_lock_hash: null,
          decision_reason_code: null,
          goal_option_id: "goal-option:legacy:wait",
          task_decision_json: null,
        });
        expect(indexes).toContainEqual(
          expect.objectContaining({
            name: "snapshots_checkpoint_id_unique",
            unique: 1,
          }),
        );
      } finally {
        migrated.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
