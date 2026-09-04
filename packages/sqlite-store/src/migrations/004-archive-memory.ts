import { sql, type Kysely } from "kysely";

import type { DatabaseSchema } from "../database-schema";

export async function migrateArchiveMemorySchema(
  db: Kysely<DatabaseSchema>,
): Promise<void> {
  const tables = await db.introspection.getTables();
  if (!tables.some((table) => table.name === "worlds")) {
    throw new Error("Initial timeline schema must exist before archive memory migration");
  }

  await db.schema
    .createTable("archive_memory_collections")
    .ifNotExists()
    .addColumn("world_id", "text", (column) =>
      column.notNull().references("worlds.world_id").onDelete("cascade"),
    )
    .addColumn("branch_id", "text", (column) => column.notNull())
    .addColumn("agent_id", "text", (column) => column.notNull())
    .addColumn("archive_version", "integer", (column) => column.notNull())
    .addColumn("full_text_index_version", "integer", (column) => column.notNull())
    .addColumn("vector_index_version", "integer", (column) => column.notNull())
    .addColumn("vector_status", "text", (column) => column.notNull())
    .addColumn("vector_archive_version", "integer")
    .addColumn("encoder_id", "text")
    .addColumn("encoder_version", "text")
    .addColumn("encoder_dimension", "integer")
    .addColumn("encoder_normalization", "text")
    .addColumn("encoder_model_file_identity", "text")
    .addCheckConstraint(
      "archive_memory_collections_versions_nonnegative",
      sql`archive_version >= 0 AND full_text_index_version >= 0 AND vector_index_version >= 0`,
    )
    .addCheckConstraint(
      "archive_memory_collections_vector_status",
      sql`vector_status IN ('unconfigured', 'stale', 'ready')`,
    )
    .addCheckConstraint(
      "archive_memory_collections_encoder_lock",
      sql`(
        vector_status = 'unconfigured'
        AND vector_archive_version IS NULL
        AND encoder_id IS NULL
        AND encoder_version IS NULL
        AND encoder_dimension IS NULL
        AND encoder_normalization IS NULL
        AND encoder_model_file_identity IS NULL
      ) OR (
        vector_status = 'stale'
        AND vector_archive_version IS NULL
        AND encoder_id IS NOT NULL
        AND encoder_version IS NOT NULL
        AND encoder_dimension > 0
        AND encoder_normalization IS NOT NULL
        AND encoder_model_file_identity IS NOT NULL
      ) OR (
        vector_status = 'ready'
        AND vector_archive_version = archive_version
        AND encoder_id IS NOT NULL
        AND encoder_version IS NOT NULL
        AND encoder_dimension > 0
        AND encoder_normalization IS NOT NULL
        AND encoder_model_file_identity IS NOT NULL
      )`,
    )
    .addPrimaryKeyConstraint("archive_memory_collections_primary", [
      "world_id",
      "branch_id",
      "agent_id",
    ])
    .execute();

  await db.schema
    .createTable("archived_memories")
    .ifNotExists()
    .addColumn("row_id", "integer", (column) => column.primaryKey().autoIncrement())
    .addColumn("world_id", "text", (column) => column.notNull())
    .addColumn("branch_id", "text", (column) => column.notNull())
    .addColumn("agent_id", "text", (column) => column.notNull())
    .addColumn("consolidation_cycle_id", "text", (column) => column.notNull())
    .addColumn("memory_id", "text", (column) => column.notNull())
    .addColumn("content", "text", (column) => column.notNull())
    .addColumn("source_event_ids_json", "text", (column) => column.notNull())
    .addColumn("formed_at_tick", "integer", (column) => column.notNull())
    .addColumn("archived_at_tick", "integer", (column) => column.notNull())
    .addColumn("importance", "text", (column) => column.notNull())
    .addColumn("importance_reason", "text", (column) => column.notNull())
    .addCheckConstraint(
      "archived_memories_ticks",
      sql`formed_at_tick >= 0 AND archived_at_tick >= formed_at_tick`,
    )
    .addCheckConstraint(
      "archived_memories_importance",
      sql`importance IN ('critical', 'high', 'normal', 'low')`,
    )
    .addCheckConstraint(
      "archived_memories_content",
      sql`length(trim(content)) > 0 AND length(trim(importance_reason)) > 0`,
    )
    .addCheckConstraint(
      "archived_memories_sources",
      sql`CASE
        WHEN json_valid(source_event_ids_json)
        THEN json_type(source_event_ids_json) = 'array'
          AND json_array_length(source_event_ids_json) > 0
        ELSE 0
      END`,
    )
    .addUniqueConstraint("archived_memories_identity", [
      "world_id",
      "branch_id",
      "agent_id",
      "memory_id",
    ])
    .addForeignKeyConstraint(
      "archived_memories_collection",
      ["world_id", "branch_id", "agent_id"],
      "archive_memory_collections",
      ["world_id", "branch_id", "agent_id"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .execute();

  await db.schema
    .createIndex("archived_memories_collection_cycle")
    .ifNotExists()
    .on("archived_memories")
    .columns(["world_id", "branch_id", "agent_id", "consolidation_cycle_id"])
    .execute();

  await db.schema
    .createIndex("archived_memories_collection_archive_tick")
    .ifNotExists()
    .on("archived_memories")
    .columns(["world_id", "branch_id", "agent_id", "archived_at_tick"])
    .execute();

  await db.schema
    .createTable("archive_memory_vectors")
    .ifNotExists()
    .addColumn("world_id", "text", (column) => column.notNull())
    .addColumn("branch_id", "text", (column) => column.notNull())
    .addColumn("agent_id", "text", (column) => column.notNull())
    .addColumn("memory_id", "text", (column) => column.notNull())
    .addColumn("encoder_id", "text", (column) => column.notNull())
    .addColumn("encoder_version", "text", (column) => column.notNull())
    .addColumn("encoder_dimension", "integer", (column) => column.notNull())
    .addColumn("encoder_normalization", "text", (column) => column.notNull())
    .addColumn("encoder_model_file_identity", "text", (column) => column.notNull())
    .addColumn("vector_json", "text", (column) => column.notNull())
    .addCheckConstraint(
      "archive_memory_vectors_dimension",
      sql`encoder_dimension > 0
        AND CASE
          WHEN json_valid(vector_json)
          THEN json_type(vector_json) = 'array'
            AND json_array_length(vector_json) = encoder_dimension
          ELSE 0
        END`,
    )
    .addPrimaryKeyConstraint("archive_memory_vectors_primary", [
      "world_id",
      "branch_id",
      "agent_id",
      "memory_id",
    ])
    .addForeignKeyConstraint(
      "archive_memory_vectors_memory",
      ["world_id", "branch_id", "agent_id", "memory_id"],
      "archived_memories",
      ["world_id", "branch_id", "agent_id", "memory_id"],
      (constraint) => constraint.onDelete("cascade"),
    )
    .execute();

  await db.schema
    .createIndex("archive_memory_vectors_lock")
    .ifNotExists()
    .on("archive_memory_vectors")
    .columns([
      "world_id",
      "branch_id",
      "agent_id",
      "encoder_id",
      "encoder_version",
      "encoder_dimension",
      "encoder_normalization",
      "encoder_model_file_identity",
    ])
    .execute();

  const ftsObjects = await sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master
    WHERE name IN (
      'archived_memories_fts',
      'archived_memories_fts_insert',
      'archived_memories_fts_delete',
      'archived_memories_fts_update'
    )
  `.execute(db);
  const existingFtsObjects = new Set(ftsObjects.rows.map((row) => row.name));
  const rebuildFts =
    !existingFtsObjects.has("archived_memories_fts") ||
    !existingFtsObjects.has("archived_memories_fts_insert") ||
    !existingFtsObjects.has("archived_memories_fts_delete") ||
    !existingFtsObjects.has("archived_memories_fts_update");
  await sql`
    CREATE VIRTUAL TABLE IF NOT EXISTS archived_memories_fts USING fts5(
      content,
      content = 'archived_memories',
      content_rowid = 'row_id',
      tokenize = 'unicode61 remove_diacritics 2'
    )
  `.execute(db);

  await sql`
    CREATE TRIGGER IF NOT EXISTS archived_memories_fts_insert
    AFTER INSERT ON archived_memories BEGIN
      INSERT INTO archived_memories_fts(rowid, content)
      VALUES (new.row_id, new.content);
    END
  `.execute(db);
  await sql`
    CREATE TRIGGER IF NOT EXISTS archived_memories_fts_delete
    AFTER DELETE ON archived_memories BEGIN
      INSERT INTO archived_memories_fts(archived_memories_fts, rowid, content)
      VALUES ('delete', old.row_id, old.content);
    END
  `.execute(db);
  await sql`
    CREATE TRIGGER IF NOT EXISTS archived_memories_fts_update
    AFTER UPDATE OF content ON archived_memories BEGIN
      INSERT INTO archived_memories_fts(archived_memories_fts, rowid, content)
      VALUES ('delete', old.row_id, old.content);
      INSERT INTO archived_memories_fts(rowid, content)
      VALUES (new.row_id, new.content);
    END
  `.execute(db);

  if (rebuildFts) {
    await sql`
      INSERT INTO archived_memories_fts(archived_memories_fts) VALUES ('rebuild')
    `.execute(db);
  }
}
