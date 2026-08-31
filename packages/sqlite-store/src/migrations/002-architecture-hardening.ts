import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database-schema";

export async function migrateArchitectureHardening(
  db: Kysely<DatabaseSchema>,
): Promise<void> {
  const tables = await db.introspection.getTables();
  const snapshots = tables.find((table) => table.name === "snapshots");
  const modelCalls = tables.find((table) => table.name === "model_calls");
  if (!snapshots || !modelCalls) {
    throw new Error("Initial timeline schema must exist before architecture migration");
  }

  if (!snapshots.columns.some((column) => column.name === "checkpoint_id")) {
    await db.schema
      .alterTable("snapshots")
      .addColumn("checkpoint_id", "text")
      .execute();
  }

  const modelColumns = new Set(modelCalls.columns.map((column) => column.name));
  if (!modelColumns.has("protocol_schema_version")) {
    await db.schema
      .alterTable("model_calls")
      .addColumn("protocol_schema_version", "integer")
      .execute();
  }
  if (!modelColumns.has("decision_cycle_id")) {
    await db.schema
      .alterTable("model_calls")
      .addColumn("decision_cycle_id", "text")
      .execute();
  }
  if (!modelColumns.has("plugin_lock_hash")) {
    await db.schema
      .alterTable("model_calls")
      .addColumn("plugin_lock_hash", "text")
      .execute();
  }
  if (!modelColumns.has("decision_reason_code")) {
    await db.schema
      .alterTable("model_calls")
      .addColumn("decision_reason_code", "text")
      .execute();
  }

  await db.schema
    .createIndex("snapshots_checkpoint_id_unique")
    .ifNotExists()
    .unique()
    .on("snapshots")
    .column("checkpoint_id")
    .execute();
}
