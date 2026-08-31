import type { Generated } from "kysely";

export interface WorldRow {
  world_id: string;
  created_at: string;
}

export interface PluginLockRow {
  world_id: string;
  lock_hash: string;
  payload_json: string;
  recorded_at: string;
}

export interface EventRow {
  world_id: string;
  sequence: number;
  event_id: string;
  world_version: number;
  world_tick: number;
  event_type: string;
  payload_json: string;
}

export interface SnapshotRow {
  id: Generated<number>;
  world_id: string;
  world_version: number;
  world_tick: number;
  last_event_sequence: number;
  checkpoint_id: string | null;
  payload_json: string;
}

export interface ModelCallRow {
  request_id: string;
  world_id: string;
  world_version: number;
  agent_id: string;
  protocol_schema_version: number | null;
  decision_cycle_id: string | null;
  plugin_lock_hash: string | null;
  decision_reason_code: string | null;
  model_id: string;
  status: string;
  goal_option_id: string | null;
  response_reason: string | null;
  latency_ms: number;
  retry_of_request_id: string | null;
  recorded_at: string;
}

export interface TechnicalFailureRow {
  failure_id: string;
  world_id: string;
  category: string;
  message: string;
  request_id: string | null;
  retryable: number;
  occurred_at: string;
}

export interface DatabaseSchema {
  worlds: WorldRow;
  plugin_locks: PluginLockRow;
  events: EventRow;
  snapshots: SnapshotRow;
  model_calls: ModelCallRow;
  technical_failures: TechnicalFailureRow;
}
