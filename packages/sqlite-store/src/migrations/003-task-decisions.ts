import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database-schema";

export async function migrateTaskDecisions(
  db: Kysely<DatabaseSchema>,
): Promise<void> {
  const tables = await db.introspection.getTables();
  const modelCalls = tables.find((table) => table.name === "model_calls");
  if (!modelCalls) {
    throw new Error("Initial timeline schema must exist before task decision migration");
  }
  if (
    !modelCalls.columns.some((column) => column.name === "task_decision_json")
  ) {
    await db.schema
      .alterTable("model_calls")
      .addColumn("task_decision_json", "text")
      .execute();
  }
}
