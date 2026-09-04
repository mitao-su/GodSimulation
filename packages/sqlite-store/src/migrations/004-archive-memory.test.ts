import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { createSqliteTimelineStore } from "../sqlite-timeline-store";

describe("archive memory migration", () => {
  it("is repeatable and creates storage, FTS, vector, and model-lock schema", async () => {
    const directory = await mkdtemp(join(tmpdir(), "god-sim-archive-migration-"));
    const filename = join(directory, "timeline.sqlite");
    try {
      const firstOpen = await createSqliteTimelineStore({ filename });
      await firstOpen.close();
      const secondOpen = await createSqliteTimelineStore({ filename });
      await secondOpen.close();

      const sqlite = new BetterSqlite3(filename, { readonly: true });
      try {
        const objects = sqlite
          .prepare(
            "SELECT name, type FROM sqlite_master WHERE name LIKE 'archive%' OR name = 'archived_memories_fts' ORDER BY name",
          )
          .all() as Array<{ readonly name: string; readonly type: string }>;
        const memoryColumns = sqlite
          .prepare("PRAGMA table_info(archived_memories)")
          .all() as Array<{ readonly name: string }>;
        const collectionColumns = sqlite
          .prepare("PRAGMA table_info(archive_memory_collections)")
          .all() as Array<{ readonly name: string }>;

        expect(objects).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: "archive_memory_collections",
              type: "table",
            }),
            expect.objectContaining({
              name: "archive_memory_vectors",
              type: "table",
            }),
            expect.objectContaining({
              name: "archived_memories_fts",
              type: "table",
            }),
            expect.objectContaining({
              name: "archived_memories_fts_insert",
              type: "trigger",
            }),
          ]),
        );
        expect(memoryColumns.map((column) => column.name)).toEqual(
          expect.arrayContaining([
            "world_id",
            "branch_id",
            "agent_id",
            "consolidation_cycle_id",
            "memory_id",
            "content",
            "search_text",
            "source_event_ids_json",
            "formed_at_tick",
            "archived_at_tick",
            "importance",
            "importance_reason",
          ]),
        );
        expect(memoryColumns.map((column) => column.name)).not.toContain(
          "last_recalled_at_tick",
        );
        expect(memoryColumns.map((column) => column.name)).not.toContain(
          "current_strength",
        );
        expect(collectionColumns.map((column) => column.name)).toEqual(
          expect.arrayContaining([
            "archive_version",
            "full_text_index_version",
            "vector_index_version",
            "vector_status",
            "encoder_id",
            "encoder_version",
            "encoder_dimension",
            "encoder_normalization",
            "encoder_model_file_identity",
          ]),
        );
      } finally {
        sqlite.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
