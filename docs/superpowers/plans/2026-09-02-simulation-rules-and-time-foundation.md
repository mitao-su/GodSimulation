# Simulation Rules and Tick Time Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every cross-module simulation parameter come from a strict, versioned rule set locked into each world, then expose one deterministic game-time projection derived from `worldTick`.

**Architecture:** Shared Zod contracts live in `@god-sim/protocol`; the local server loads and hashes `content/rules/<id>.json`, and the worker receives the immutable lock with world initialization. The simulation stores the lock in authoritative state and version-3 snapshots, verifies it on restore, and derives day/hour/minute exclusively from the locked rule set and integer Tick.

**Tech Stack:** Node.js 24, pnpm 10, strict TypeScript 6, Zod 4, Vitest 4, SHA-256 through `node:crypto`.

**Spec:** `docs/architecture/character-context-implementation-todo.md`

## Global Constraints

- `worldTick` remains the only writable game clock; only `RUNNING` advances it.
- The default time scale is exactly `6` game seconds per Tick.
- Derived minute/day constants are functions, never duplicated configuration fields.
- The world definition references a rule-set ID and integer version; it does not inline mutable rules.
- Rule files are strict and complete. Production code has no fallback rule object or missing-field defaults.
- The normalized parsed rules, ID, version, and SHA-256 hash form one immutable `SimulationRulesLock`.
- New snapshots write schema version 3 and contain the complete rule lock. Version 1/2 snapshots remain parseable only through the explicit legacy adoption path and are rewritten as version 3 at the next checkpoint.
- Restoring a version-3 snapshot with a different rule ID, version, normalized content, or hash fails before simulation starts.
- Deployment values such as the real `100ms` worker interval, API credentials, GPU selection, and model timeout do not enter the simulation rules.
- Work is executed inline in the current checkout; do not create commits unless the user explicitly requests them.

## File Responsibility Map

| Responsibility | Owning files |
| --- | --- |
| Rule schemas, reference, lock, and current snapshot type | `packages/protocol/src/rules/simulation-rules.ts`, `world/world-snapshot.ts` |
| Default versioned values | `content/rules/default.json` |
| Rule file discovery, strict parsing, canonical hashing | `apps/local-server/src/rules/load-simulation-rules.ts` |
| World-to-rule reference | `packages/simulation/src/map/map-definition.ts`, `content/worlds/starter-home/world.json` |
| Worker initialization transport | `packages/protocol/src/ipc/host-worker-message.ts`, `apps/simulation-worker/src/` |
| Authoritative lock and restore verification | `packages/simulation/src/world/world-state.ts`, `engine/snapshot-projector.ts`, `engine/snapshot-restorer.ts` |
| Store-neutral current snapshot type | `packages/timeline/src/timeline-store.ts`, `packages/sqlite-store/src/sqlite-timeline-store.ts` |
| Tick-derived calendar projection | `packages/simulation/src/world/game-time.ts`, `packages/protocol/src/view-models/world-view.ts` |
| Visible current time | `packages/simulation/src/engine/view-projector.ts`, `apps/web/src/app/app.tsx` |

---

### Task 1: Strict Shared Simulation Rule Contracts

**Files:**
- Create: `packages/protocol/src/rules/simulation-rules.ts`
- Create: `packages/protocol/src/rules/simulation-rules.test.ts`
- Modify: `packages/protocol/src/identity/ids.ts`
- Modify: `packages/protocol/src/index.ts`

**Interfaces:**
- Produces `SimulationRulesIdSchema`, `SimulationRulesHashSchema`, and branded types.
- Produces `WorldRulesReferenceSchema = { id, version }`.
- Produces strict `SimulationRulesSchema` and `SimulationRulesLockSchema`.
- Produces `SpeakVolumeSchema = "quiet" | "normal" | "loud"`; presentation later renders these as “小声 / 正常 / 大声”.

- [x] **Step 1: Write failing strict-schema tests**

```ts
const validRules = {
  schemaVersion: 1,
  id: "default",
  version: 1,
  time: { secondsPerGameTick: 6, epoch: { day: 1, hour: 8, minute: 0 } },
  context: { attentionBudgetTokens: 200_000, technicalHardLimitTokens: 200_000 },
  fatigue: {
    timeWeight: 0.6,
    tokenWeight: 0.4,
    forcedSleepThreshold: 0.6,
    timePressureFullAtTicks: 43_200,
  },
  inventory: { capacityUnits: 9 },
  memory: {
    importance: {
      critical: { initialStrength: 1, halfLifeDays: 90 },
      high: { initialStrength: 1, halfLifeDays: 30 },
      normal: { initialStrength: 1, halfLifeDays: 7 },
      low: { initialStrength: 1, halfLifeDays: 2 },
    },
    deletionThreshold: 0.1,
    recall: {
      maxReturnTokensPerOperation: 8_000,
      rankingWeights: { semanticSimilarity: 0.55, keywordMatch: 0.25, currentStrength: 0.2 },
    },
  },
  sound: {
    speakSourceStrength: { quiet: 1, normal: 2, loud: 4 },
    attenuationPerTile: 0.25,
    fullContentThreshold: 1,
    unclearContentThreshold: 0.25,
  },
};

expect(SimulationRulesSchema.parse(validRules)).toEqual(validRules);
expect(SimulationRulesSchema.safeParse({ ...validRules, extra: true }).success).toBe(false);
expect(SimulationRulesSchema.safeParse({
  ...validRules,
  fatigue: { ...validRules.fatigue, tokenWeight: 0.5 },
}).success).toBe(false);
expect(SimulationRulesSchema.safeParse({
  ...validRules,
  sound: { ...validRules.sound, speakSourceStrength: { quiet: 2, normal: 1, loud: 4 } },
}).success).toBe(false);
```

- [x] **Step 2: Run the focused test and verify red**

Run: `pnpm exec vitest run packages/protocol/src/rules/simulation-rules.test.ts`

Expected: FAIL because the rule schemas do not exist.

- [x] **Step 3: Implement the schemas and invariants**

Use strict nested objects. Enforce all of these in the schema:

```ts
timeWeight + tokenWeight === 1
technicalHardLimitTokens >= attentionBudgetTokens
critical.halfLifeDays > high.halfLifeDays
high.halfLifeDays > normal.halfLifeDays
normal.halfLifeDays > low.halfLifeDays
semanticSimilarity + keywordMatch + currentStrength === 1
loud > normal && normal > quiet
fullContentThreshold > unclearContentThreshold
```

All configured numbers must be finite. Counts/Ticks/tokens are positive integers; ratios and strengths are positive or bounded exactly as their meaning requires.

- [x] **Step 4: Export and verify**

Run: `pnpm exec vitest run packages/protocol/src/rules/simulation-rules.test.ts && pnpm --filter @god-sim/protocol typecheck`

Expected: PASS.

### Task 2: Versioned Rule File Loading and Canonical Hashing

**Files:**
- Create: `content/rules/default.json`
- Create: `apps/local-server/src/rules/load-simulation-rules.ts`
- Create: `apps/local-server/src/rules/load-simulation-rules.test.ts`
- Modify: `apps/local-server/src/config/local-config.ts`
- Modify: `apps/local-server/src/config/local-config.test.ts`

**Interfaces:**
- Produces `loadSimulationRules({ rulesDirectory, reference }): Promise<SimulationRulesLock>`.
- `LocalConfig.rulesDirectory` resolves to `<projectRoot>/content/rules` and is content configuration, not an environment-tunable gameplay number.

- [x] **Step 1: Write failing loader tests**

Create temporary rule files with different key orders and assert identical locks. Also assert rejection when the filename/reference says `default@1` but the parsed content says another ID/version, when an unknown field exists, and when a value violates the shared schema.

```ts
const first = await loadSimulationRules({ rulesDirectory, reference: { id: "default", version: 1 } });
await writeFile(rulePath, JSON.stringify(reorderedRules), "utf8");
const second = await loadSimulationRules({ rulesDirectory, reference: { id: "default", version: 1 } });
expect(second).toEqual(first);
expect(first.hash).toMatch(/^[a-f0-9]{64}$/u);
```

- [x] **Step 2: Run tests and verify red**

Run: `pnpm exec vitest run apps/local-server/src/rules/load-simulation-rules.test.ts apps/local-server/src/config/local-config.test.ts`

Expected: FAIL because the loader and `rulesDirectory` do not exist.

- [x] **Step 3: Add the default rule file**

Write exactly the `validRules` values from Task 1 to `content/rules/default.json`; no comments, omitted fields, or duplicate derived time values.

- [x] **Step 4: Implement canonical hashing**

Parse with `SimulationRulesSchema`, recursively sort object keys while preserving array order, serialize the normalized value, and hash the UTF-8 bytes with SHA-256. Return:

```ts
SimulationRulesLockSchema.parse({
  hash: createHash("sha256").update(canonicalJson(parsed)).digest("hex"),
  rules: parsed,
});
```

Resolve only `${reference.id}.json` beneath `rulesDirectory`; the shared stable-ID regex prevents traversal characters. Verify parsed ID and version equal the reference before returning.

- [x] **Step 5: Verify**

Run: `pnpm exec vitest run apps/local-server/src/rules/load-simulation-rules.test.ts apps/local-server/src/config/local-config.test.ts && pnpm --filter @god-sim/local-server typecheck`

Expected: PASS.

### Task 3: World Reference and Worker Initialization

**Files:**
- Modify: `packages/simulation/src/map/map-definition.ts`
- Modify: `packages/simulation/src/map/map-loader.test.ts`
- Modify: `packages/simulation/src/testing/simulation-test-fixtures.ts`
- Modify: `content/worlds/starter-home/world.json`
- Modify: `packages/protocol/src/ipc/host-worker-message.ts`
- Modify: `packages/protocol/src/ipc/host-worker-message.test.ts`
- Modify: `apps/local-server/src/bootstrap/start-local-server.ts`
- Modify: `apps/simulation-worker/src/ipc/worker-message-handler.ts`
- Modify: `apps/simulation-worker/src/ipc/worker-message-handler.test.ts`
- Modify: `apps/simulation-worker/src/runtime/world-session.ts`
- Modify: `apps/simulation-worker/src/runtime/world-session.test.ts`

**Interfaces:**
- `MapDefinition.rules` is a required `WorldRulesReference`.
- The initialize IPC message requires `simulationRulesLock`.
- `WorldSessionOptions` requires the parsed lock and passes it to create/restore paths.

- [x] **Step 1: Write failing protocol and map tests**

Assert a map without `rules` fails, `{ rules: { id: "default", version: 1 } }` passes, and an initialize message without `simulationRulesLock` fails.

- [x] **Step 2: Run tests and verify red**

Run: `pnpm exec vitest run packages/simulation/src/map/map-loader.test.ts packages/protocol/src/ipc/host-worker-message.test.ts apps/simulation-worker/src/ipc/worker-message-handler.test.ts`

Expected: FAIL because maps and initialization do not carry the rule reference/lock.

- [x] **Step 3: Load the referenced rules before session startup**

In `startLocalServer`, parse the world JSON, parse its `rules` field with `WorldRulesReferenceSchema`, and load the lock alongside the plugin lock. Pass both immutable locks in the initialize message. Do not let the Worker read local files.

- [x] **Step 4: Thread the lock through the Worker**

`WorkerMessageHandler` passes `message.simulationRulesLock` into `WorldSession`; `WorldSession` passes the same object into `createSimulation` or `restoreSimulation`. Extend test initialization helpers rather than adding production defaults.

- [x] **Step 5: Verify**

Run: `pnpm exec vitest run packages/protocol/src/ipc/host-worker-message.test.ts packages/simulation/src/map/map-loader.test.ts apps/simulation-worker/src/ipc/worker-message-handler.test.ts apps/simulation-worker/src/runtime/world-session.test.ts`

Expected: PASS.

### Task 4: Authoritative Rule Lock and Version-3 Snapshots

**Files:**
- Modify: `packages/protocol/src/world/world-snapshot.ts`
- Modify: `packages/protocol/src/world/world-snapshot.test.ts`
- Modify: `packages/protocol/src/ipc/host-worker-message.ts`
- Modify: `packages/simulation/src/world/world-state.ts`
- Modify: `packages/simulation/src/map/map-loader.ts`
- Modify: `packages/simulation/src/engine/simulation-engine.ts`
- Modify: `packages/simulation/src/engine/snapshot-projector.ts`
- Modify: `packages/simulation/src/engine/snapshot-restorer.ts`
- Modify: `packages/simulation/src/engine/snapshot-restorer.test.ts`
- Modify: `packages/simulation/src/engine/snapshot-causality.ts`
- Modify: `packages/timeline/src/timeline-store.ts`
- Modify: `packages/sqlite-store/src/sqlite-timeline-store.ts`
- Modify: affected timeline/SQLite/integration tests that construct the current snapshot type

**Interfaces:**
- Produces `WorldSnapshotV3Schema` and `WorldSnapshotCurrent = WorldSnapshotV3`.
- `WorldSnapshotV3.simulationRulesLock` stores full normalized rules and hash.
- `SimulationOptions.simulationRulesLock` and `SimulationRestoreOptions.simulationRulesLock` are required.

- [x] **Step 1: Write failing snapshot contract tests**

```ts
const snapshot = WorldSnapshotV3Schema.parse({
  schemaVersion: 3,
  worldId: "starter-world",
  worldVersion: 8,
  worldTick: 42,
  lastEventSequence: 17,
  pluginLockHash: "b".repeat(64),
  simulationRulesLock,
  history: { mode: "strict", causalFromSequence: 1 },
  causalEventIds: [],
  state: {},
});
expect(snapshot.simulationRulesLock).toEqual(simulationRulesLock);
```

Assert V1/V2 still parse through `WorldSnapshotSchema` and current checkpoint IPC requires V3.

- [x] **Step 2: Run focused tests and verify red**

Run: `pnpm exec vitest run packages/protocol/src/world/world-snapshot.test.ts packages/simulation/src/engine/snapshot-restorer.test.ts packages/sqlite-store/src/sqlite-timeline-store.test.ts`

Expected: FAIL because version 3 and rule-lock verification do not exist.

- [x] **Step 3: Store and project the lock**

Add `simulationRulesLock` to `WorldState`. New-world loading receives it as a required option. `projectWorldSnapshot` writes version 3 with the exact lock. The checkpoint and timeline interfaces use `WorldSnapshotCurrent`, not a hard-coded older version.

- [x] **Step 4: Verify restore semantics**

For V3, compare the complete supplied lock to the snapshot lock after schema parsing; mismatch throws `Snapshot simulation rules do not match the configured rule lock`. For V1/V2, adopt the explicitly supplied lock as a one-way legacy migration because those snapshots predate rule locks; the next projected snapshot is V3. Never synthesize a fallback lock inside the restorer.

- [x] **Step 5: Update all current-snapshot consumers**

Replace `WorldSnapshotV2` in checkpoint-only types with `WorldSnapshotCurrent`. Keep functions that intentionally inspect V2 causal history accepting `WorldSnapshotV2 | WorldSnapshotV3` through a shared strict-history type.

- [x] **Step 6: Verify**

Run: `pnpm exec vitest run packages/protocol/src/world/world-snapshot.test.ts packages/simulation/src/engine/snapshot-restorer.test.ts packages/simulation/src/engine/simulation-checkpoint.test.ts packages/sqlite-store/src/sqlite-timeline-store.test.ts tests/integration/history-audit.test.ts`

Expected: PASS, including a V3 mismatch test and V2-to-V3 migration test.

### Task 5: Unique Tick-Derived Game-Time Projection

**Files:**
- Create: `packages/simulation/src/world/game-time.ts`
- Create: `packages/simulation/src/world/game-time.test.ts`
- Modify: `packages/simulation/src/index.ts`
- Modify: `packages/protocol/src/view-models/world-view.ts`
- Modify: `packages/protocol/src/view-models/world-view.test.ts`
- Modify: `packages/simulation/src/engine/view-projector.ts`
- Modify: `apps/web/src/app/app.tsx`
- Modify: `apps/web/src/app/app.test.tsx`

**Interfaces:**
- Produces `ticksPerGameMinute(rules)`, `ticksPerGameDay(rules)`, and `projectGameTime(worldTick, rules)`.
- `WorldView.gameTime` is `{ day, hour, minute }`; raw `worldTick` remains available to director/debug UI but is not intended for future character perception payloads.

- [x] **Step 1: Write failing projection tests**

```ts
expect(ticksPerGameMinute(timeRules)).toBe(10);
expect(ticksPerGameDay(timeRules)).toBe(14_400);
expect(projectGameTime(0, timeRules)).toEqual({ day: 1, hour: 8, minute: 0 });
expect(projectGameTime(10, timeRules)).toEqual({ day: 1, hour: 8, minute: 1 });
expect(projectGameTime(9_600, timeRules)).toEqual({ day: 2, hour: 0, minute: 0 });
```

Also assert frozen modes retain the same projection before/after `advanceWorldClock`, while one `RUNNING` Tick changes only when crossing an actual minute boundary.

- [x] **Step 2: Run tests and verify red**

Run: `pnpm exec vitest run packages/simulation/src/world/game-time.test.ts packages/protocol/src/view-models/world-view.test.ts apps/web/src/app/app.test.tsx`

Expected: FAIL because `gameTime` and its projector do not exist.

- [x] **Step 3: Implement integer-only projection**

Compute elapsed game seconds as `worldTick * secondsPerGameTick`; combine it with the epoch's day offset and seconds since midnight. Use integer division/modulo for day, hour, and minute. Never save derived values back into `WorldState`.

- [x] **Step 4: Project and render**

`projectWorldView` calls the time projector with `world.simulationRulesLock.rules.time`. Render `第 {day} 天 HH:MM` in the existing world-time area using zero-padded hour/minute; do not introduce a second ticking timer in the web app.

- [x] **Step 5: Verify**

Run: `pnpm exec vitest run packages/simulation/src/world/world-clock.test.ts packages/simulation/src/world/game-time.test.ts packages/protocol/src/view-models/world-view.test.ts apps/web/src/app/app.test.tsx`

Expected: PASS.

### Task 6: First-Batch Regression Gate

**Files:**
- Modify: `docs/architecture/character-context-implementation-todo.md` only to mark items proven complete by tests.

- [x] **Step 1: Run static and focused consistency searches**

Run: `rg -n "secondsPerGameTick|attentionBudgetTokens|timeWeight|tokenWeight|capacityUnits|maxReturnTokensPerOperation|speakSourceStrength" packages apps plugins content -g '*.ts' -g '*.json'`

Expected: configurable policy values originate from `content/rules/default.json`; schemas/tests may repeat expected literals, while production modules read the lock.

- [x] **Step 2: Run the full repository gate**

Run: `pnpm lint`

Run: `pnpm typecheck`

Run: `pnpm test`

Run: `pnpm build`

Expected: every command exits 0.

- [x] **Step 3: Check patch hygiene**

Run: `git diff --check`

Run: `rg -n "[ \t]+$" packages apps content docs/superpowers/plans/2026-09-02-simulation-rules-and-time-foundation.md`

Expected: no whitespace errors or trailing spaces.

## Completion Gate

This batch is complete only when a world cannot start without a valid referenced rule file, the worker receives and persists an immutable matching lock, a mismatched current snapshot cannot restore, legacy snapshots migrate explicitly to version 3, and every displayed game date/time is a pure projection of Tick plus the locked `6`-seconds-per-Tick rule. No fatigue, memory, sound, or inventory behavior is implemented in this batch; their confirmed parameters are merely locked for the later subsystem plans.
