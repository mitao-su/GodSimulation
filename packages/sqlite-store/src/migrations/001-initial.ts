import { sql, type Kysely } from "kysely";

import type { DatabaseSchema } from "../database-schema";

export async function migrateInitialSchema(db: Kysely<DatabaseSchema>): Promise<void> {
  await db.schema
    .createTable("worlds")
    .ifNotExists()
    .addColumn("world_id", "text", (column) => column.primaryKey())
    .addColumn("created_at", "text", (column) => column.notNull())
    .execute();

  await db.schema
    .createTable("plugin_locks")
    .ifNotExists()
    .addColumn("world_id", "text", (column) =>
      column.primaryKey().references("worlds.world_id").onDelete("cascade"),
    )
    .addColumn("lock_hash", "text", (column) => column.notNull())
    .addColumn("payload_json", "text", (column) => column.notNull())
    .addColumn("recorded_at", "text", (column) => column.notNull())
    .execute();

  await db.schema
    .createTable("events")
    .ifNotExists()
    .addColumn("world_id", "text", (column) =>
      column.notNull().references("worlds.world_id").onDelete("cascade"),
    )
    .addColumn("sequence", "integer", (column) => column.notNull())
    .addColumn("event_id", "text", (column) => column.notNull().unique())
    .addColumn("world_version", "integer", (column) => column.notNull())
    .addColumn("world_tick", "integer", (column) => column.notNull())
    .addColumn("event_type", "text", (column) => column.notNull())
    .addColumn("payload_json", "text", (column) => column.notNull())
    .addPrimaryKeyConstraint("events_primary", ["world_id", "sequence"])
    .execute();

  await db.schema
    .createIndex("events_world_sequence")
    .ifNotExists()
    .on("events")
    .columns(["world_id", "sequence"])
    .execute();

  await db.schema
    .createTable("snapshots")
    .ifNotExists()
    .addColumn("id", "integer", (column) => column.primaryKey().autoIncrement())
    .addColumn("world_id", "text", (column) =>
      column.notNull().references("worlds.world_id").onDelete("cascade"),
    )
    .addColumn("world_version", "integer", (column) => column.notNull())
    .addColumn("world_tick", "integer", (column) => column.notNull())
    .addColumn("last_event_sequence", "integer", (column) => column.notNull())
    .addColumn("payload_json", "text", (column) => column.notNull())
    .execute();

  await db.schema
    .createIndex("snapshots_world_version")
    .ifNotExists()
    .on("snapshots")
    .columns(["world_id", "world_version"])
    .execute();

  await db.schema
    .createTable("model_calls")
    .ifNotExists()
    .addColumn("request_id", "text", (column) => column.primaryKey())
    .addColumn("world_id", "text", (column) =>
      column.notNull().references("worlds.world_id").onDelete("cascade"),
    )
    .addColumn("world_version", "integer", (column) => column.notNull())
    .addColumn("agent_id", "text", (column) => column.notNull())
    .addColumn("model_id", "text", (column) => column.notNull())
    .addColumn("status", "text", (column) => column.notNull())
    .addColumn("goal_option_id", "text")
    .addColumn("response_reason", "text")
    .addColumn("latency_ms", "integer", (column) => column.notNull())
    .addColumn("retry_of_request_id", "text")
    .addColumn("recorded_at", "text", (column) => column.notNull())
    .execute();

  await db.schema
    .createTable("technical_failures")
    .ifNotExists()
    .addColumn("failure_id", "text", (column) => column.primaryKey())
    .addColumn("world_id", "text", (column) =>
      column.notNull().references("worlds.world_id").onDelete("cascade"),
    )
    .addColumn("category", "text", (column) => column.notNull())
    .addColumn("message", "text", (column) => column.notNull())
    .addColumn("request_id", "text")
    .addColumn("retryable", "integer", (column) => column.notNull())
    .addColumn("occurred_at", "text", (column) => column.notNull())
    .execute();

  await sql`PRAGMA foreign_keys = ON`.execute(db);
}

