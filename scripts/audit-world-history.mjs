import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireFromSqliteStore = createRequire(
  resolve(projectRoot, "packages", "sqlite-store", "package.json"),
);
const BetterSqlite3 = requireFromSqliteStore("better-sqlite3");

function parseSnapshot(row, invalidSnapshots) {
  let payload;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    invalidSnapshots.push({ snapshotId: row.id, worldId: row.world_id });
    return null;
  }
  if (!payload || typeof payload !== "object") {
    invalidSnapshots.push({ snapshotId: row.id, worldId: row.world_id });
    return null;
  }
  return payload;
}

function main() {
  const filename = process.argv[2];
  if (!filename) {
    throw new Error("Usage: pnpm audit:history -- <database-file>");
  }

  const database = new BetterSqlite3(filename, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const integrityRows = database.pragma("integrity_check");
    const integrityOk =
      integrityRows.length === 1 && integrityRows[0]?.integrity_check === "ok";
    const duplicateWorldSequences = database
      .prepare(
        "SELECT world_id, sequence, COUNT(*) AS duplicate_count " +
          "FROM events GROUP BY world_id, sequence HAVING COUNT(*) > 1",
      )
      .all();
    const duplicateEventIds = database
      .prepare(
        "SELECT event_id, COUNT(*) AS duplicate_count " +
          "FROM events GROUP BY event_id HAVING COUNT(*) > 1",
      )
      .all();
    const snapshotRows = database
      .prepare(
        "SELECT id, world_id, world_version, last_event_sequence, " +
          "checkpoint_id, payload_json FROM snapshots " +
          "ORDER BY world_id ASC, world_version DESC, id DESC",
      )
      .all();
    const invalidSnapshots = [];
    const latestCausalSnapshotByWorld = new Map();
    for (const row of snapshotRows) {
      const snapshot = parseSnapshot(row, invalidSnapshots);
      if (
        (snapshot?.schemaVersion !== 2 && snapshot?.schemaVersion !== 3) ||
        latestCausalSnapshotByWorld.has(row.world_id)
      ) {
        continue;
      }
      latestCausalSnapshotByWorld.set(row.world_id, { row, snapshot });
    }

    const maxSequence = database.prepare(
      "SELECT COALESCE(MAX(sequence), 0) AS max_sequence FROM events WHERE world_id = ?",
    );
    const eventExists = database.prepare(
      "SELECT 1 AS found FROM events WHERE world_id = ? AND event_id = ? LIMIT 1",
    );
    const tailMismatches = [];
    const missingCausalEvents = [];
    for (const { row, snapshot } of latestCausalSnapshotByWorld.values()) {
      const durableTail = maxSequence.get(row.world_id)?.max_sequence ?? 0;
      if (
        !Number.isSafeInteger(snapshot.lastEventSequence) ||
        snapshot.lastEventSequence !== row.last_event_sequence ||
        snapshot.lastEventSequence !== durableTail
      ) {
        tailMismatches.push({
          checkpointId: row.checkpoint_id,
          durableTail,
          snapshotId: row.id,
          snapshotTail: snapshot.lastEventSequence,
          worldId: row.world_id,
        });
      }
      if (!Array.isArray(snapshot.causalEventIds)) {
        invalidSnapshots.push({ snapshotId: row.id, worldId: row.world_id });
        continue;
      }
      for (const eventId of snapshot.causalEventIds) {
        if (typeof eventId !== "string" || !eventExists.get(row.world_id, eventId)) {
          missingCausalEvents.push({
            eventId: typeof eventId === "string" ? eventId : "invalid-event-id",
            snapshotId: row.id,
            worldId: row.world_id,
          });
        }
      }
    }

    const lines = [
      "integrity: " + (integrityOk ? "ok" : "failed"),
      "causal snapshots audited: " + latestCausalSnapshotByWorld.size,
      "invalid snapshots: " + invalidSnapshots.length,
      "event tail mismatches: " + tailMismatches.length,
      "duplicate world sequences: " + duplicateWorldSequences.length,
      "duplicate event ids: " + duplicateEventIds.length,
      "missing causal events: " + missingCausalEvents.length,
    ];
    for (const issue of invalidSnapshots) {
      lines.push(
        "invalid snapshot: world=" + issue.worldId + " snapshot=" + issue.snapshotId,
      );
    }
    for (const issue of tailMismatches) {
      lines.push(
        "event tail mismatch: world=" +
          issue.worldId +
          " snapshot=" +
          issue.snapshotId +
          " checkpoint=" +
          (issue.checkpointId ?? "legacy") +
          " snapshot_tail=" +
          String(issue.snapshotTail) +
          " event_tail=" +
          issue.durableTail,
      );
    }
    for (const issue of duplicateWorldSequences) {
      lines.push(
        "duplicate world sequence: world=" +
          issue.world_id +
          " sequence=" +
          issue.sequence +
          " count=" +
          issue.duplicate_count,
      );
    }
    for (const issue of duplicateEventIds) {
      lines.push(
        "duplicate event id: event=" +
          issue.event_id +
          " count=" +
          issue.duplicate_count,
      );
    }
    for (const issue of missingCausalEvents) {
      lines.push(
        "missing causal event: world=" +
          issue.worldId +
          " snapshot=" +
          issue.snapshotId +
          " event=" +
          issue.eventId,
      );
    }
    process.stdout.write(lines.join("\n") + "\n");

    if (
      !integrityOk ||
      invalidSnapshots.length > 0 ||
      tailMismatches.length > 0 ||
      duplicateWorldSequences.length > 0 ||
      duplicateEventIds.length > 0 ||
      missingCausalEvents.length > 0
    ) {
      process.exitCode = 1;
    }
  } finally {
    database.close();
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message + "\n");
  process.exitCode = 1;
}
