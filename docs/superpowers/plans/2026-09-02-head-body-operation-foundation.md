# HEAD/BODY Operation Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy single-goal executor with a recoverable `HEAD/BODY` operation foundation in which two independent calls advance in parallel, synchronized calls share one identity, and any non-empty call completion freezes the world without disturbing its peer.

**Architecture:** Cross-process task and decision shapes live in `@god-sim/protocol`; executable operation contracts live in `@god-sim/plugin-sdk`; program-owned candidates, active calls, planning, validation, release, and execution live in `@god-sim/simulation`. The two task tracks reference active operations by `callId`; an operation owns one internal micro-step plan, locked arguments, duration, progress, and lifecycle. Snapshot envelope V3 remains current, while serialized world state gains an explicit internal state schema version and migrates the old `currentGoal/actionPlan/bodySlots` representation.

**Tech Stack:** TypeScript 6, Zod 4, Vitest, pnpm workspaces, Kysely/SQLite, React.

**Spec:** `docs/architecture/character-context-implementation-todo.md` sections 1 and 3, especially stage 1.

## Global Constraints

- `worldTick` remains the only writable game clock; starting a call does not advance it.
- The only task tracks are `HEAD` and `BODY`; `HANDS` must disappear from runtime definitions, snapshots, fixtures, and tests.
- Every decision contains both `head` and `body`; each selection is exactly `continue` or `replace(taskOptionId, arguments)`.
- Empty tasks are stable track state, do not create a `callId`, never complete, and never trigger a decision.
- A multi-track operation is one call referenced by both tracks and is entered, continued, replaced, completed, failed, or cancelled atomically.
- New calls are created at progress zero during release; object/resource effects begin only in a later running Tick.
- A fixed call locks a positive `totalTicks` and completes at `startedAtTick + totalTicks`; `move` is indeterminate.
- Existing door traversal remains an internal `move` micro-step. A locked traversal is learned and replanned under the same call identity.
- An object interaction is no longer allowed to hide an approach move; when the actor is not in interaction range the model receives a separate move candidate.
- All requested agents must have valid decisions before one atomic release batch can change any task.
- This batch does not implement `speak`, target-character operations, daily context, memory, clothing, inventory, or recall. Their checklist items remain unchecked rather than receiving placeholder behavior.
- Work is performed in the current user checkout. Do not create a worktree, commit, reset, or clean unrelated files.

---

### Task 1: Cross-Module Task, Duration, and Decision Contracts

**Files:**
- Create: `packages/protocol/src/execution/task-contract.ts`
- Modify: `packages/protocol/src/identity/ids.ts`
- Modify: `packages/protocol/src/json/json-value.ts`
- Modify: `packages/protocol/src/model/decision-contract.ts`
- Modify: `packages/protocol/src/model/decision-contract.test.ts`
- Modify: `packages/protocol/src/rules/simulation-rules.ts`
- Modify: `packages/protocol/src/rules/simulation-rules.test.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `content/rules/default.json`
- Modify: rule fixtures that construct `SimulationRulesLock`

**Interfaces:**
- Produces `TaskTrack = "HEAD" | "BODY"`, `OperationDuration`, `TaskOption`, `TaskSelection`, `TaskDecision`, `OperationId`, `OperationCallId`, and `TaskOptionId`.
- Produces strict JSON-object arguments and canonical task-slot validation shared by protocol, SDK, simulation, and snapshots.
- Replaces `goalOptions/currentGoal/GoalProposal` in current model requests with `taskOptions/activeTasks/TaskDecision`; legacy goal schemas remain exported only for old snapshot parsing.

- [x] **Step 1: Write failing protocol tests**

Add tests that name these breakages:

```ts
expect(TaskTrackSchema.safeParse("HANDS").success).toBe(false);
expect(OperationDurationSchema.parse({ kind: "fixed", totalTicks: 3 })).toEqual({
  kind: "fixed",
  totalTicks: 3,
});
expect(TaskDecisionSchema.safeParse({
  schemaVersion: 2,
  head: { kind: "continue" },
  reason: "missing body",
}).success).toBe(false);
expect(TaskDecisionSchema.safeParse({
  schemaVersion: 2,
  head: { kind: "replace", taskOptionId: "empty:head", arguments: {}, extra: true },
  body: { kind: "continue" },
  reason: "invalid extra field",
}).success).toBe(false);
```

Add a rule test proving `operations.move.ticksPerCell`, `operations.wait.defaultDurationTicks`, `operations.wait.maxDurationTicks`, and `operations.observe.durationTicks` are required and positive, with default values `2`, `600`, `600`, and `1`.

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
pnpm vitest run packages/protocol/src/model/decision-contract.test.ts packages/protocol/src/rules/simulation-rules.test.ts
```

Expected: FAIL because task contracts and operation timing rules do not exist.

- [x] **Step 3: Implement the strict protocol**

Use these exact domain shapes:

```ts
export const TaskTrackSchema = z.enum(["HEAD", "BODY"]);

export const OperationDurationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fixed"), totalTicks: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("indeterminate") }).strict(),
]);

export const TaskSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("continue") }).strict(),
  z.object({
    kind: z.literal("replace"),
    taskOptionId: TaskOptionIdSchema,
    arguments: JsonObjectSchema,
  }).strict(),
]);

export const TaskDecisionSchema = z.object({
  schemaVersion: z.literal(2),
  head: TaskSelectionSchema,
  body: TaskSelectionSchema,
  reason: z.string().min(1).max(500),
}).strict();
```

`TaskOption` is a strict discriminated union of `empty` and `operation`. Both carry one canonical non-empty `taskSlots` list and a JSON Schema argument description; operation options also carry `operationId`, while empty options accept only `{}`. `ActiveTasksContext` stores `{ HEAD, BODY }` call references plus a de-duplicated operation detail list.

- [x] **Step 4: Run protocol tests and typecheck the package**

Run:

```powershell
pnpm vitest run packages/protocol/src/model/decision-contract.test.ts packages/protocol/src/rules/simulation-rules.test.ts
pnpm --filter @god-sim/protocol typecheck
```

Expected: PASS.

### Task 2: Executable Operation Contract and Plugin Validation

**Files:**
- Create: `packages/plugin-sdk/src/operation/operation-contract.ts`
- Delete: `packages/plugin-sdk/src/capability/body-slot.ts`
- Modify: `packages/plugin-sdk/src/object/object-interaction.ts`
- Modify: `packages/plugin-sdk/src/plugin/define-plugin.ts`
- Modify: `packages/plugin-sdk/src/plugin/define-plugin.test.ts` or create a focused contract test
- Modify: `packages/plugin-sdk/src/index.ts`
- Modify: `plugins/spatial-objects/src/objects/door/interactions.ts`
- Modify: `plugins/home-objects/src/objects/refrigerator/interactions.ts`
- Modify: `plugins/home-objects/src/objects/toilet/interactions.ts`
- Modify: plugin tests and simulation fixtures

**Interfaces:**
- Consumes `TaskTrack`, `OperationDuration`, and JSON values from Task 1.
- Produces an operation metadata contract with `taskSlots`, `parametersSchema`, `resolveDuration`, `eventIgnore`, `publicBehavior`, `domainFailures`, `resultSchema`, `start`, `complete`, `fail`, `cancel`, and `fuse` declarations.
- Object interactions remain plugin lifecycle implementations but become valid operation definitions instead of legacy body-slot actions.

- [x] **Step 1: Write failing SDK and plugin tests**

Test that plugin registration rejects:

```ts
taskSlots: []
taskSlots: ["BODY", "HEAD"] // non-canonical order
taskSlots: ["BODY", "BODY"] // duplicate
publicBehavior: undefined
resolveDuration: undefined
```

Test that a valid `HEAD/BODY` definition is normalized once and that every migrated production interaction contains no `HANDS`.

- [x] **Step 2: Run focused tests and verify RED**

Run:

```powershell
pnpm vitest run packages/plugin-sdk plugins/spatial-objects plugins/home-objects
```

Expected: FAIL on missing operation metadata and remaining `HANDS` declarations.

- [x] **Step 3: Implement and migrate the SDK contract**

Use canonical track order `HEAD`, then `BODY`. The public behavior declaration is exactly one of:

```ts
type PublicBehaviorDeclaration =
  | { readonly kind: "hidden" }
  | { readonly kind: "visible"; readonly label: string };
```

`fuse` returns a read-only JSON payload or `null`; it cannot return effects. Lifecycle effect callbacks retain the current `EffectProposal` boundary. Migrate all former `HANDS` interactions to `BODY`; the refrigerator's old `HANDS+BODY` reservation becomes one `BODY` track, not a duplicated slot.

- [x] **Step 4: Run SDK/plugin tests and package typechecks**

Run:

```powershell
pnpm vitest run packages/plugin-sdk plugins/spatial-objects plugins/home-objects
pnpm --filter @god-sim/plugin-sdk typecheck
pnpm --filter @god-sim/spatial-objects typecheck
pnpm --filter @god-sim/home-objects typecheck
```

Expected: PASS and `rg -n 'HANDS|BodySlot' packages plugins apps tests` finds no current runtime usage.

### Task 3: Program-Owned Operation Catalog and Semantic Candidate Boundary

**Files:**
- Create: `packages/simulation/src/execution/operation.ts`
- Create: `packages/simulation/src/execution/task-tracks.ts`
- Create: `packages/simulation/src/execution/operation-catalog.ts`
- Create: `packages/simulation/src/execution/operation-catalog.test.ts`
- Modify: `packages/simulation/src/world/plugin-registry.ts`
- Replace: `packages/simulation/src/decision/goal-option-provider.ts` with `task-option-provider.ts`
- Replace corresponding tests
- Modify: `packages/simulation/src/execution/action.ts`
- Replace: `packages/simulation/src/execution/goal-planner.ts` with `operation-planner.ts`
- Add focused planner tests

**Interfaces:**
- Produces `ActiveOperation`, `TaskTracks`, `OperationDefinition`, `OperationCatalog`, `buildTaskOptions`, and `planOperation`.
- Core operations are `core.wait` on `BODY`, `core.observe` on `HEAD`, and indeterminate `core.move` on `BODY`.
- Plugin object interaction IDs are stable from object definition ID plus interaction ID and use their declared `taskSlots`.

- [x] **Step 1: Write failing catalog tests**

Cover these observable behaviors with literal expectations:

```ts
expect(options.filter((option) => option.kind === "empty").map((option) => option.taskSlots))
  .toEqual([["HEAD"], ["BODY"]]);
expect(moveOption.operationId).toBe("core.move");
expect(moveOption.taskSlots).toEqual(["BODY"]);
expect(useOption).toBeUndefined(); // known target is not currently in interaction range
```

Move Alice into an interaction position and assert the plugin interaction appears while the redundant move candidate disappears. Assert observe appears only for a currently visible target. Assert the move plan contains traversal actions but an object interaction plan never contains a move action.

- [x] **Step 2: Run focused catalog/planner tests and verify RED**

Run:

```powershell
pnpm vitest run packages/simulation/src/execution/operation-catalog.test.ts packages/simulation/src/execution/operation-planner.test.ts
```

Expected: FAIL because only legacy goal options and chained goal plans exist.

- [x] **Step 3: Implement catalog, tracks, and planners**

Use this authoritative track state:

```ts
type TaskTrackState =
  | { readonly kind: "empty" }
  | { readonly kind: "operation"; readonly callId: OperationCallId };

type TaskTracks = Readonly<Record<TaskTrack, TaskTrackState>>;
```

An `ActiveOperation` stores one call identity, operation/option identity, canonical slots, parsed arguments, locked duration, `startedAtTick`, `progressTicks`, and one internal action plan. Core timing reads only the world's locked rules. `move` locks no path length or completion Tick; its current path is replaceable internal state under the same call.

- [x] **Step 4: Run catalog/planner tests and simulation typecheck**

Run:

```powershell
pnpm vitest run packages/simulation/src/execution/operation-catalog.test.ts packages/simulation/src/execution/operation-planner.test.ts
pnpm --filter @god-sim/simulation typecheck
```

Expected: PASS.

### Task 4: Active Operation World State and Snapshot Migration

**Files:**
- Modify: `packages/simulation/src/world/world-state.ts`
- Modify: `packages/simulation/src/map/map-loader.ts`
- Modify: `packages/simulation/src/engine/snapshot-projector.ts`
- Modify: `packages/simulation/src/engine/snapshot-restorer.ts`
- Modify: `packages/simulation/src/engine/snapshot-restorer.test.ts`
- Modify: `packages/simulation/src/testing/simulation-test-fixtures.ts`
- Modify: scenario snapshot helpers

**Interfaces:**
- Consumes `TaskTracks` and `ActiveOperation` from Task 3.
- Replaces each agent's `currentGoal/actionPlan/bodySlots` with `taskTracks` and `activeOperations: ReadonlyMap<OperationCallId, ActiveOperation>`.
- Produces serialized world state version `2`; missing version denotes the legacy single-goal state and is explicitly migrated.

- [x] **Step 1: Write failing state and restore tests**

Add tests proving a new agent has two empty tracks and no calls, a running snapshot round-trips two independent calls, and both tracks of a synchronized call restore to the same `callId`. Add a legacy-state fixture with `currentGoal/actionPlan/bodySlots` and assert it becomes one `legacy.goal` compatibility call without losing the current action, elapsed progress, or remaining actions. Add a frozen legacy decision fixture and assert its offered goals and accepted single-goal proposal become task options plus a complete two-track decision.

- [x] **Step 2: Run restore tests and verify RED**

Run:

```powershell
pnpm vitest run packages/simulation/src/engine/snapshot-restorer.test.ts packages/simulation/src/map/map-loader.test.ts
```

Expected: FAIL because serialized agents still require legacy fields.

- [x] **Step 3: Implement versioned state serialization and migration**

Serialize maps as sorted arrays and validate all invariants on restore:

- every active track references an existing call owned by that agent;
- every call is referenced by exactly its declared `taskSlots`;
- no call is duplicated;
- fixed calls retain the locked positive `totalTicks` and do not rerun duration resolution;
- progress is nonnegative and cannot exceed a fixed duration;
- legacy `HANDS` is mapped only as part of the one-time legacy state migration and never emitted again;
- a running legacy plan becomes an indeterminate `legacy.goal` call whose canonical slots cover every remaining internal action; prior action durations plus current progress determine elapsed progress and `startedAtTick` without inventing a second clock;
- a frozen legacy request is rebuilt with compatibility task options, and an accepted single-goal proposal selects its compatibility option on every required track while all other tracks continue.

`legacy.goal` is restorer-only: the current candidate provider never offers it, but the operation runner can finish a restored internal plan and emit normal lifecycle records.

- [x] **Step 4: Run restore tests and snapshot-focused integration tests**

Run:

```powershell
pnpm vitest run packages/simulation/src/engine/snapshot-restorer.test.ts packages/protocol/src/world/world-snapshot.test.ts tests/integration/local-server-restart.test.ts
```

Expected: PASS.

### Task 5: Complete Decision Validation and Atomic Batch Release

**Files:**
- Modify: `packages/cognition/src/decision/goal-proposal-validator.ts` and rename exports to task decision terminology
- Modify: `packages/cognition/src/context/cognition-context.ts`
- Modify: `packages/cognition/src/memory/relevant-memory-selector.ts`
- Modify: `packages/cognition/src/prompt/prompt-assembler.ts`
- Modify: corresponding cognition tests
- Modify: `packages/simulation/src/decision/decision-gate.ts`
- Modify: `packages/simulation/src/decision/release-policy.ts`
- Modify: corresponding simulation tests
- Modify: `packages/simulation/src/engine/simulation-engine.ts`

**Interfaces:**
- Produces `preflightTaskDecision` and an atomic `releaseDecisionCycle(world, registry)` transition that returns world plus lifecycle events.
- `continue` preserves exact call object identity and progress; `replace` validates the stored program-owned option, parses arguments, checks fixed candidate bindings and availability, resolves duration once, and creates deterministic calls.

- [x] **Step 1: Write failing decision and release tests**

Test all of the following independently:

- omitting either track is rejected by Schema;
- a `HEAD` option submitted on `BODY` is rejected with the world object unchanged;
- an empty replacement creates no call;
- a synchronized option selected on one track only is rejected;
- synchronized selections require the same option and normalized arguments;
- replacing either half of an existing synchronized call requires replacing both halves;
- the first accepted agent decision does not change tasks;
- final release creates all agents' calls in one transition at progress zero;
- one invalid agent makes the entire batch leave every agent unchanged.

- [x] **Step 2: Run decision/release tests and verify RED**

Run:

```powershell
pnpm vitest run packages/simulation/src/decision/decision-gate.test.ts packages/simulation/src/decision/release-policy.test.ts packages/cognition/src/decision/goal-proposal-validator.test.ts
```

Expected: FAIL because the model and release policy still select one goal and clear all legacy slots.

- [x] **Step 3: Implement prompt, validation, and release transaction**

The model response format is exactly:

```json
{
  "schemaVersion": 2,
  "head": { "kind": "continue" },
  "body": {
    "kind": "replace",
    "taskOptionId": "task-option:alice:wait",
    "arguments": { "durationTicks": 600 }
  },
  "reason": "brief reason"
}
```

Preflight every requested agent before applying cancellation effects or creating calls. Apply cancellation effects and new track/call state to immutable candidate world values; if any effect or invariant fails, discard the candidate world and preserve the frozen input. Do not reserve object occupancy while releasing.

- [x] **Step 4: Run decision/release tests and cognition/simulation typechecks**

Run:

```powershell
pnpm vitest run packages/simulation/src/decision packages/cognition/src
pnpm --filter @god-sim/cognition typecheck
pnpm --filter @god-sim/simulation typecheck
```

Expected: PASS.

### Task 6: Parallel Operation Execution, Completion Fuse, and Local Move Recovery

**Files:**
- Replace: `packages/simulation/src/execution/action-runner.ts` with operation-aware execution while retaining internal action helpers
- Modify: `packages/simulation/src/execution/action-runner.test.ts`
- Modify: `packages/simulation/src/execution/local-recovery.ts`
- Modify: `packages/simulation/src/decision/plan-conflict-detector.ts`
- Modify: `packages/simulation/src/engine/tick-pipeline.ts`
- Create: `packages/protocol/src/events/operation-started.event.ts`
- Create: `packages/protocol/src/events/operation-terminated.event.ts`
- Modify: `packages/protocol/src/events/domain-event.ts`
- Modify: protocol event tests and exports
- Add scenario tests for dual-track execution

**Interfaces:**
- Advances each agent's unique active calls once per running Tick in canonical `HEAD`, then `BODY` order; a shared call advances only once.
- Returns typed completed, failed, and interaction lifecycle records keyed by `callId`.
- Emits one operation start and one terminal event per call. Completion clears only that call's tracks and requests a decision for its owner.

- [x] **Step 1: Write failing runner and scenario tests**

Create two independent calls for Alice: a fixed `HEAD` observe call of one Tick and a fixed `BODY` wait call of three Ticks. After one Tick assert:

```ts
expect(world.mode).toBe("THINKING");
expect(alice.taskTracks.HEAD).toEqual({ kind: "empty" });
expect(alice.taskTracks.BODY).toEqual({ kind: "operation", callId: bodyCallId });
expect(alice.activeOperations.get(bodyCallId)?.progressTicks).toBe(1);
```

After releasing with `HEAD replace(empty)` and `BODY continue`, assert the body call ID, arguments, duration, progress, and internal plan are unchanged. Add a synchronized call test proving it advances and terminates once. Add fixed-duration boundary tests at `startedAtTick + totalTicks` and frozen-world tests proving repeated engine ticks during THINKING do not change progress.

For move, assert a locked traversal records the blocker, replans under the same `callId`, preserves elapsed progress, and only fails the top-level call when no alternate path exists.

- [x] **Step 2: Run focused execution/scenario tests and verify RED**

Run:

```powershell
pnpm vitest run packages/simulation/src/execution/action-runner.test.ts tests/scenarios/pause-preserves-actions.test.ts tests/scenarios/locked-door-recovery.test.ts tests/scenarios/head-body-parallel.test.ts
```

Expected: FAIL because execution advances only one legacy action plan and completion clears the whole goal.

- [x] **Step 3: Implement parallel execution and lifecycle events**

Increment operation progress once for each Tick in which it actually executes. For object interactions, the start/arbitration Tick counts toward fixed duration so a call released at Tick `T` completes exactly at `T + totalTicks`. Preserve current deterministic conflict arbitration. A top-level domain failure terminates only its call; an unexpected definition, effect, or invariant error leaves the call active and routes to the existing technical block.

The move recovery path replaces only the call's internal plan and known blocker state. It must not create a new call, reset `startedAtTick`, reset `progressTicks`, or request a decision when an alternate path exists.

- [x] **Step 4: Run execution scenarios and simulation typecheck**

Run:

```powershell
pnpm vitest run packages/simulation/src/execution tests/scenarios
pnpm --filter @god-sim/simulation typecheck
```

Expected: PASS.

### Task 7: Model Gateway, Persistence, Worker, and View Projection

**Files:**
- Modify: `packages/model-gateway/src/decision-provider.ts`
- Modify: `packages/model-gateway/src/fixed/fixed-decision-provider.ts`
- Modify: `packages/model-gateway/src/openrouter/openrouter-decision-provider.ts`
- Modify: gateway tests
- Modify: `apps/local-server/src/decisions/decision-request-coordinator.ts`
- Modify: coordinator tests
- Modify: `packages/timeline/src/model-call-record.ts`
- Create: `packages/sqlite-store/src/migrations/003-task-decisions.ts`
- Modify: `packages/sqlite-store/src/database-schema.ts`
- Modify: `packages/sqlite-store/src/sqlite-timeline-store.ts`
- Modify: SQLite tests
- Modify: `apps/simulation-worker/src/runtime/world-session.ts`
- Modify: worker tests
- Modify: `packages/protocol/src/events/decision-accepted.event.ts`
- Modify: `packages/protocol/src/view-models/world-view.ts`
- Modify: `packages/simulation/src/engine/view-projector.ts`
- Modify: `apps/web/src/features/agent-list/agent-list.tsx`
- Modify: `apps/web/src/features/agent-inspector/agent-inspector.tsx`
- Modify: web tests

**Interfaces:**
- Providers return `TaskDecision`; OpenRouter receives a strict JSON Schema requiring both tracks.
- Model-call audit persists the complete accepted task decision JSON rather than pretending one `goalOptionId` represents it; migration preserves the legacy column for old rows.
- World view exposes stable `headTask` and `bodyTask` summaries and de-duplicates a synchronized call.

- [x] **Step 1: Write failing adapter, persistence, and projection tests**

Assert the OpenRouter JSON Schema requires `head`, `body`, and `reason`; fixed providers return a complete decision by selecting configured per-track choices; coordinator rejects unoffered or wrong-track choices before persistence; SQLite round-trips exact decision JSON; and the web inspector displays separate `HEAD` and `BODY` tasks.

- [x] **Step 2: Run focused tests and verify RED**

Run:

```powershell
pnpm vitest run packages/model-gateway apps/local-server/src/decisions packages/sqlite-store apps/simulation-worker/src/runtime apps/web/src
```

Expected: FAIL on the legacy one-goal result and audit/view shapes.

- [x] **Step 3: Implement adapters and projections**

Persist `task_decision_json` as canonical `JSON.stringify(TaskDecisionSchema.parse(value))`; old `goal_option_id` remains nullable for legacy rows and is not populated by new decisions. Worker validation passes the complete stored proposal to the engine instead of looking up one goal. In the view, an empty track has `label: null`; an active track reports call ID, operation ID, label, duration kind, and progress. Public web text uses `头部任务` and `身体任务`.

- [x] **Step 4: Run adapter/package tests and typechecks**

Run:

```powershell
pnpm vitest run packages/model-gateway apps/local-server/src/decisions packages/sqlite-store apps/simulation-worker/src/runtime apps/web/src
pnpm typecheck
```

Expected: PASS.

### Task 8: Integration Migration, Checklist Accounting, and Full Verification

**Files:**
- Modify: scenario and integration fixtures that still construct one-goal decisions
- Modify: `docs/architecture/character-context-implementation-todo.md`
- Modify: this plan's checkboxes as execution progresses

**Interfaces:**
- Produces end-to-end behavior through local process, restart, checkpoint, review-mode, and deterministic scenarios.
- Leaves incomplete stage-1 items unchecked and records the exact next dependency rather than claiming the whole context architecture is complete.

- [x] **Step 1: Migrate remaining tests through public APIs**

Replace helpers such as `adoptGoal` with a helper that submits a complete head/body decision. Scenario selectors choose a move operation before a remote object interaction, then choose the interaction after the move completion fuse. Do not mutate snapshot JSON directly except in explicit migration tests.

- [x] **Step 2: Run the complete test suite**

Run:

```powershell
pnpm test
```

Expected: all tests pass with no failures.

- [x] **Step 3: Update architecture checklist status using test evidence**

Check only implemented bullets: `TaskTrack`, removal of `HANDS`, dual-track references, canonical slots, empty tasks, operation duration, indeterminate move, semantic planner boundary, atomic dual-track release, all-agent readiness, parallel completion preservation, locked-duration persistence, and updated gateway/view. Keep `speak`, target-character delivery, correction loops, full conversation results, inventory, and other deferred lifecycle behavior unchecked unless this plan added explicit passing tests for them.

- [x] **Step 4: Run final quality gates**

Run fresh, in order:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: every command exits `0`. Existing bundle-size warnings are acceptable; new warnings or errors are not.
