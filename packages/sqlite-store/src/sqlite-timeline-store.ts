import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect, type Transaction } from "kysely";

import {
  DomainEventSchema,
  PluginLockSchema,
  TechnicalFailureSchema,
  WorldSnapshotSchema,
  type DomainEvent,
  type TechnicalFailure,
  type WorldId,
  type WorldSnapshot,
} from "@god-sim/protocol";
import type {
  ModelCallRecord,
  PluginLockRecord,
  RestoredTimeline,
  TimelineStore,
} from "@god-sim/timeline";

import type { DatabaseSchema } from "./database-schema";
import { migrateInitialSchema } from "./migrations/001-initial";

export interface SqliteTimelineStoreOptions {
  readonly filename: string;
}

type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

async function ensureWorld(db: DatabaseExecutor, worldId: string): Promise<void> {
  await db
    .insertInto("worlds")
    .values({ world_id: worldId, created_at: new Date().toISOString() })
    .onConflict((conflict) => conflict.column("world_id").doNothing())
    .execute();
}

class SqliteTimelineStore implements TimelineStore {
  readonly #db: Kysely<DatabaseSchema>;
  #closed = false;

  constructor(db: Kysely<DatabaseSchema>) {
    this.#db = db;
  }

  async appendEvents(eventValues: readonly DomainEvent[]): Promise<void> {
    if (eventValues.length === 0) return;
    const events = eventValues.map((event) => DomainEventSchema.parse(event));
    await this.#db.transaction().execute(async (transaction) => {
      for (const event of events) {
        await ensureWorld(transaction, event.worldId);
        const payloadJson = JSON.stringify(event);
        await transaction
          .insertInto("events")
          .values({
            world_id: event.worldId,
            sequence: event.sequence,
            event_id: event.eventId,
            world_version: event.worldVersion,
            world_tick: event.worldTick,
            event_type: event.type,
            payload_json: payloadJson,
          })
          .onConflict((conflict) =>
            conflict.columns(["world_id", "sequence"]).doNothing(),
          )
          .execute();
        const stored = await transaction
          .selectFrom("events")
          .select(["event_id", "payload_json"])
          .where("world_id", "=", event.worldId)
          .where("sequence", "=", event.sequence)
          .executeTakeFirstOrThrow();
        if (stored.event_id !== event.eventId || stored.payload_json !== payloadJson) {
          throw new Error(
            `Event replay conflicts at ${event.worldId} sequence ${event.sequence}`,
          );
        }
      }
    });
  }

  async saveSnapshot(snapshotValue: WorldSnapshot): Promise<void> {
    const snapshot = WorldSnapshotSchema.parse(snapshotValue);
    await this.#db.transaction().execute(async (transaction) => {
      await ensureWorld(transaction, snapshot.worldId);
      const payloadJson = JSON.stringify(snapshot);
      const stored = await transaction
        .selectFrom("snapshots")
        .select("payload_json")
        .where("world_id", "=", snapshot.worldId)
        .where("world_version", "=", snapshot.worldVersion)
        .execute();
      if (stored.length > 0) {
        if (stored.some((row) => row.payload_json !== payloadJson)) {
          throw new Error(
            `Snapshot replay conflicts at ${snapshot.worldId} version ${snapshot.worldVersion}`,
          );
        }
        return;
      }
      await transaction
        .insertInto("snapshots")
        .values({
          world_id: snapshot.worldId,
          world_version: snapshot.worldVersion,
          world_tick: snapshot.worldTick,
          last_event_sequence: snapshot.lastEventSequence,
          payload_json: payloadJson,
        })
        .executeTakeFirstOrThrow();
    });
  }

  async savePluginLock(record: PluginLockRecord): Promise<void> {
    const pluginLock = PluginLockSchema.parse(record.pluginLock);
    await this.#db.transaction().execute(async (transaction) => {
      await ensureWorld(transaction, record.worldId);
      await transaction
        .insertInto("plugin_locks")
        .values({
          world_id: record.worldId,
          lock_hash: pluginLock.hash,
          payload_json: JSON.stringify(pluginLock),
          recorded_at: record.recordedAtRealTime,
        })
        .onConflict((conflict) =>
          conflict.column("world_id").doUpdateSet({
            lock_hash: pluginLock.hash,
            payload_json: JSON.stringify(pluginLock),
            recorded_at: record.recordedAtRealTime,
          }),
        )
        .execute();
    });
  }

  async saveModelCall(record: ModelCallRecord): Promise<void> {
    await this.#db.transaction().execute(async (transaction) => {
      await ensureWorld(transaction, record.worldId);
      const values = {
        request_id: record.requestId,
        world_id: record.worldId,
        world_version: record.worldVersion,
        agent_id: record.agentId,
        model_id: record.modelId,
        status: record.status,
        goal_option_id: record.goalOptionId,
        response_reason: record.responseReason,
        latency_ms: record.latencyMs,
        retry_of_request_id: record.retryOfRequestId,
        recorded_at: record.recordedAtRealTime,
      };
      await transaction
        .insertInto("model_calls")
        .values(values)
        .onConflict((conflict) => conflict.column("request_id").doNothing())
        .execute();
      const stored = await transaction
        .selectFrom("model_calls")
        .selectAll()
        .where("request_id", "=", record.requestId)
        .executeTakeFirstOrThrow();
      if (
        stored.world_id !== values.world_id ||
        stored.world_version !== values.world_version ||
        stored.agent_id !== values.agent_id ||
        stored.model_id !== values.model_id ||
        stored.status !== values.status ||
        stored.goal_option_id !== values.goal_option_id ||
        stored.response_reason !== values.response_reason ||
        stored.latency_ms !== values.latency_ms ||
        stored.retry_of_request_id !== values.retry_of_request_id ||
        stored.recorded_at !== values.recorded_at
      ) {
        throw new Error(`Model call replay conflicts for ${record.requestId}`);
      }
    });
  }

  async recordFailure(worldId: WorldId, failureValue: TechnicalFailure): Promise<void> {
    const failure = TechnicalFailureSchema.parse(failureValue);
    await this.#db.transaction().execute(async (transaction) => {
      await ensureWorld(transaction, worldId);
      const values = {
        failure_id: failure.id,
        world_id: worldId,
        category: failure.category,
        message: failure.message,
        request_id: failure.requestId ?? null,
        retryable: failure.retryable ? 1 : 0,
        occurred_at: failure.occurredAtRealTime,
      };
      await transaction
        .insertInto("technical_failures")
        .values(values)
        .onConflict((conflict) => conflict.column("failure_id").doNothing())
        .execute();
      const stored = await transaction
        .selectFrom("technical_failures")
        .selectAll()
        .where("failure_id", "=", failure.id)
        .executeTakeFirstOrThrow();
      if (
        stored.world_id !== values.world_id ||
        stored.category !== values.category ||
        stored.message !== values.message ||
        stored.request_id !== values.request_id ||
        stored.retryable !== values.retryable ||
        stored.occurred_at !== values.occurred_at
      ) {
        throw new Error(`Technical failure replay conflicts for ${failure.id}`);
      }
    });
  }

  async loadLatest(worldId: WorldId): Promise<RestoredTimeline> {
    const snapshotRow = await this.#db
      .selectFrom("snapshots")
      .select(["payload_json", "last_event_sequence"])
      .where("world_id", "=", worldId)
      .orderBy("world_version", "desc")
      .orderBy("id", "desc")
      .executeTakeFirst();
    const snapshot = snapshotRow
      ? WorldSnapshotSchema.parse(JSON.parse(snapshotRow.payload_json))
      : null;
    const events = await this.#db
      .selectFrom("events")
      .select("payload_json")
      .where("world_id", "=", worldId)
      .where("sequence", ">", snapshotRow?.last_event_sequence ?? 0)
      .orderBy("sequence", "asc")
      .execute();
    return {
      snapshot,
      events: events.map((row) => DomainEventSchema.parse(JSON.parse(row.payload_json))),
    };
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#db.destroy();
  }
}

export async function createSqliteTimelineStore(
  options: SqliteTimelineStoreOptions,
): Promise<TimelineStore> {
  if (options.filename.length === 0) throw new Error("SQLite filename is required");
  const sqlite = new BetterSqlite3(options.filename);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({ database: sqlite }),
  });
  await migrateInitialSchema(db);
  return new SqliteTimelineStore(db);
}
