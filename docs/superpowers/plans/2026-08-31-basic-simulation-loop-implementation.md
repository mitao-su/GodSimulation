# Basic Simulation Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first playable local-browser milestone in which model-driven agents make high-level decisions and a deterministic program executes movement, perception, door, refrigerator, and toilet behavior.

**Architecture:** A pnpm TypeScript monorepo separates the React/PixiJS browser, Fastify local host, and authoritative simulation worker. Packages communicate through Zod-validated DTOs; the pure simulation owns all mutable world state, while plugins only answer queries or propose effects and the model only proposes goals.

**Tech Stack:** Node.js 24, pnpm 10, TypeScript 7, React 19, Vite 8, PixiJS 8, Fastify 5, Zod 4, rot-js 2, better-sqlite3 13, Kysely 0.29, Vitest 4, Playwright 1.62.

**Spec:** `docs/superpowers/specs/2026-08-31-basic-simulation-loop-design.md`

## Global Constraints

- The simulation uses fixed `100ms` integer ticks; only `RUNNING` advances world time.
- Model calls happen only while the world is frozen for agent thinking.
- Technical failures use `TECHNICALLY_BLOCKED`, never a gameplay pause reason.
- `packages/simulation` imports no React, Fastify, SQLite, model SDK, or Node process API.
- Browser code imports `@god-sim/protocol`, never `@god-sim/simulation`.
- Plugins are trusted local ESM modules but cannot directly mutate `WorldState`.
- All cross-process and browser messages pass Zod parsing.
- No `utils`, `common`, `misc`, or catch-all `services` directories.
- No silent fallback after model, plugin, protocol, worker, or persistence failure.
- `free_model.local`, `.superpowers/`, `workspace/`, generated data, logs, and build output remain untracked.
- Automated tests use fixed decisions; real OpenRouter calls are manual smoke tests only.
- Every task follows red-green-refactor and ends with the listed focused verification before commit.

## Authoritative Cross-Package Types

- `packages/protocol` is the sole owner of IDs, commands, semantic events, model decision DTOs, technical failures, snapshots, IPC messages, and browser views.
- `packages/plugin-sdk` is the sole owner of plugin-facing capabilities, `BodySlot`, triggers, observable object data, and effect proposals.
- `packages/simulation` is the sole owner of mutable-in-memory world records, action plans, perception knowledge, and deterministic transition results.
- `packages/timeline` consumes protocol snapshots and events; it must not define a second `WorldSnapshot` or `DomainEvent` shape.
- A model proposal selects a program-offered `goalOptionId`. The program maps that ID to an immutable `Goal`; free-form model output cannot invent an entity or interaction.

---

### Task 1: Monorepo Foundation and Dependency Boundaries

**Files:**
- Modify: `.gitignore`
- Create: `.npmrc`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`
- Create: `.dependency-cruiser.cjs`
- Create: `vitest.config.ts`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/src/index.ts`
- Create: `apps/local-server/package.json`
- Create: `apps/local-server/tsconfig.json`
- Create: `apps/local-server/src/index.ts`
- Create: `apps/simulation-worker/package.json`
- Create: `apps/simulation-worker/tsconfig.json`
- Create: `apps/simulation-worker/src/index.ts`
- Create: `packages/protocol/package.json`
- Create: `packages/protocol/tsconfig.json`
- Create: `packages/protocol/src/index.ts`
- Create: `packages/simulation/package.json`
- Create: `packages/simulation/tsconfig.json`
- Create: `packages/simulation/src/index.ts`
- Create: `packages/plugin-sdk/package.json`
- Create: `packages/plugin-sdk/tsconfig.json`
- Create: `packages/plugin-sdk/src/index.ts`
- Create: `packages/cognition/package.json`
- Create: `packages/cognition/tsconfig.json`
- Create: `packages/cognition/src/index.ts`
- Create: `packages/timeline/package.json`
- Create: `packages/timeline/tsconfig.json`
- Create: `packages/timeline/src/index.ts`
- Create: `packages/model-gateway/package.json`
- Create: `packages/model-gateway/tsconfig.json`
- Create: `packages/model-gateway/src/index.ts`
- Create: `packages/sqlite-store/package.json`
- Create: `packages/sqlite-store/tsconfig.json`
- Create: `packages/sqlite-store/src/index.ts`
- Create: `plugins/spatial-objects/package.json`
- Create: `plugins/spatial-objects/tsconfig.json`
- Create: `plugins/spatial-objects/src/index.ts`
- Create: `plugins/home-objects/package.json`
- Create: `plugins/home-objects/tsconfig.json`
- Create: `plugins/home-objects/src/index.ts`
- Create: `plugins/starter-agents/package.json`
- Create: `plugins/starter-agents/tsconfig.json`
- Create: `plugins/starter-agents/src/index.ts`
- Test: `tests/architecture/dependency-boundaries.test.ts`

**Interfaces:**
- Produces workspace package names `@god-sim/*`, root scripts, strict shared compiler settings, and enforceable dependency rules.
- Later tasks import only package root entry points defined here.

- [ ] **Step 1: Write the failing architecture test**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("workspace boundaries", () => {
  it("keeps the web app independent from the simulation package", () => {
    const manifest = JSON.parse(readFileSync("apps/web/package.json", "utf8"));
    expect(manifest.dependencies?.["@god-sim/simulation"]).toBeUndefined();
    expect(manifest.dependencies?.["@god-sim/protocol"]).toBe("workspace:*");
  });
});
```

- [ ] **Step 2: Run the test and observe the missing workspace configuration**

Run: `pnpm exec vitest run tests/architecture/dependency-boundaries.test.ts`

Expected: FAIL because the root manifest and app manifests do not exist.

- [ ] **Step 3: Create the root configuration**

Use exact root scripts:

```json
{
  "name": "god-simulation",
  "private": true,
  "packageManager": "pnpm@10.34.5",
  "engines": { "node": ">=24.0.0" },
  "scripts": {
    "build": "pnpm -r build",
    "dev": "concurrently -k -n server,web \"pnpm --filter @god-sim/local-server dev\" \"pnpm --filter @god-sim/web dev\"",
    "lint": "eslint . && depcruise apps packages plugins --config .dependency-cruiser.cjs",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "typecheck": "pnpm -r typecheck"
  }
}
```

Set `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `composite`, and `strict` to `true` in `tsconfig.base.json`.

- [ ] **Step 4: Declare package dependencies and exports**

Each package exposes only its root entry point. Development and Vitest resolve `src/index.ts`; production application builds bundle workspace source into `dist`. Declare the dependency direction from the spec; in particular:

```json
{
  "name": "@god-sim/simulation",
  "type": "module",
  "dependencies": {
    "@god-sim/plugin-sdk": "workspace:*",
    "@god-sim/protocol": "workspace:*",
    "rot-js": "2.2.1"
  }
}
```

- [ ] **Step 5: Install and verify the foundation**

Run: `pnpm install`

Run: `pnpm test -- tests/architecture/dependency-boundaries.test.ts && pnpm typecheck && pnpm lint`

Expected: all commands exit 0 and dependency-cruiser reports no forbidden imports.

- [ ] **Step 6: Commit**

```bash
git add .gitignore .npmrc package.json pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs .dependency-cruiser.cjs vitest.config.ts apps packages plugins tests/architecture pnpm-lock.yaml
git commit -m "chore: establish workspace boundaries"
```

### Task 2: Versioned Protocol Contracts

**Files:**
- Create: `packages/protocol/src/identity/ids.ts`
- Create: `packages/protocol/src/json/json-value.ts`
- Create: `packages/protocol/src/world/world-mode.ts`
- Create: `packages/protocol/src/world/coordinate.ts`
- Create: `packages/protocol/src/world/technical-failure.ts`
- Create: `packages/protocol/src/world/world-snapshot.ts`
- Create: `packages/protocol/src/commands/command-envelope.ts`
- Create: `packages/protocol/src/commands/release-execution.command.ts`
- Create: `packages/protocol/src/commands/set-review-mode.command.ts`
- Create: `packages/protocol/src/commands/retry-decision.command.ts`
- Create: `packages/protocol/src/commands/stop-session.command.ts`
- Create: `packages/protocol/src/commands/world-command.ts`
- Create: `packages/protocol/src/queries/world-query.ts`
- Create: `packages/protocol/src/events/event-envelope.ts`
- Create: `packages/protocol/src/events/decision-requested.event.ts`
- Create: `packages/protocol/src/events/decision-accepted.event.ts`
- Create: `packages/protocol/src/events/world-released.event.ts`
- Create: `packages/protocol/src/events/interaction-arbitrated.event.ts`
- Create: `packages/protocol/src/events/object-state-changed.event.ts`
- Create: `packages/protocol/src/events/agent-need-changed.event.ts`
- Create: `packages/protocol/src/events/action-failed.event.ts`
- Create: `packages/protocol/src/events/observation-remembered.event.ts`
- Create: `packages/protocol/src/events/domain-event.ts`
- Create: `packages/protocol/src/model/decision-contract.ts`
- Create: `packages/protocol/src/ipc/host-worker-message.ts`
- Create: `packages/protocol/src/view-models/world-view.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/src/model/decision-contract.test.ts`
- Test: `packages/protocol/src/ipc/host-worker-message.test.ts`
- Test: `packages/protocol/src/world/world-snapshot.test.ts`

**Interfaces:**
- Produces branded string aliases `WorldId`, `AgentId`, `EntityId`, `RequestId`, `EventId`.
- Produces `WorldCommandSchema`, `WorldQuerySchema`, `DomainEventSchema`, `HostToWorkerMessageSchema`, `WorkerToHostMessageSchema`, `SubjectiveDecisionContextSchema`, `DecisionPromptInputSchema`, `GoalProposalSchema`, `ModelDecisionRequestSchema`, `ModelDecisionResultSchema`, `TechnicalFailureSchema`, `WorldSnapshotSchema`, and `WorldViewSchema`.
- All schemas export inferred TypeScript types with the same base name minus `Schema`.

- [ ] **Step 1: Write failing schema tests**

```ts
it("rejects a free-form goal instead of an offered option ID", () => {
  expect(() => GoalProposalSchema.parse({
    schemaVersion: 1,
    goal: { kind: "use_object", targetEntityId: "toilet-1", interactionId: "use" },
    reason: "urgent"
  })).toThrow();
});

it("requires world version identity on model results", () => {
  expect(() => HostToWorkerMessageSchema.parse({
    type: "decision_result",
    result: { requestId: "request-1" }
  })).toThrow();
});
```

- [ ] **Step 2: Run tests to verify missing schemas fail**

Run: `pnpm --filter @god-sim/protocol test`

Expected: FAIL with missing exports.

- [ ] **Step 3: Implement the goal contract**

```ts
export const GoalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("use_object"),
    targetEntityId: z.string().min(1),
    interactionId: z.string().min(1)
  }),
  z.object({ kind: z.literal("wait"), durationTicks: z.number().int().positive().max(600) }),
  z.object({ kind: z.literal("observe"), targetEntityId: z.string().min(1) })
]);

export const GoalOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  goal: GoalSchema
}).strict();

export const GoalProposalSchema = z.object({
  schemaVersion: z.literal(1),
  goalOptionId: z.string().min(1),
  reason: z.string().min(1).max(500)
}).strict();
```

Define one shared decision identity and reuse it in both request and result:

```ts
export const DecisionIdentitySchema = z.object({
  requestId: RequestIdSchema,
  agentId: AgentIdSchema,
  worldId: WorldIdSchema,
  worldVersion: z.number().int().nonnegative(),
  decisionCycleId: z.string().min(1),
  schemaVersion: z.literal(1),
  pluginLockHash: z.string().regex(/^[a-f0-9]{64}$/),
  retryOfRequestId: RequestIdSchema.optional()
}).strict();

export const ModelDecisionRequestSchema = DecisionIdentitySchema.extend({
  decisionReason: z.object({ code: z.string().min(1), summary: z.string().min(1) }).strict(),
  messages: z.array(z.object({
    role: z.enum(["system", "user"]),
    content: z.string().min(1)
  }).strict()).min(1),
  goalOptions: z.array(GoalOptionSchema).min(1)
}).strict();

export const ModelDecisionResultSchema = DecisionIdentitySchema.extend({
  proposal: GoalProposalSchema
}).strict();
```

`SubjectiveDecisionContextSchema` contains only body sensations, current goal/action progress, selected memories with source event IDs, current perceptions, and the decision reason. `DecisionPromptInputSchema` combines that context, the decision identity, and `goalOptions`; this is the only value simulation hands to cognition. It deliberately has no world object map, hidden plugin state, pathfinding grid, or other agents' private knowledge.

`worldVersion` is the frozen base version stored on that pending request. When several agents share a decision cycle, accepting one peer result does not invalidate another peer's identity; validation compares against the matching stored request, never just the latest top-level counter.

- [ ] **Step 4: Implement commands and events as discriminated unions**

Browser/host control command types are exactly `release_execution`, `set_review_mode`, `retry_decision`, and `stop_session`. Every command carries `commandId`, `worldId`, `expectedWorldVersion`, and `issuedAtRealTime` where the real timestamp is diagnostic only. `set_review_mode` carries `enabled`; `retry_decision` carries `requestId`. Agent `Action` objects create internal interaction requests inside `packages/simulation`; they are never accepted directly from the browser in this milestone.

`WorldQuerySchema` is a strict union of `get_world_view`, `visibility`, and `available_interactions`. Every query carries `queryId`, `worldId`, `expectedWorldVersion`, and `causationId`. Query handlers return data directly, never events, state updates, or database records.

Event base fields are exactly `eventId`, `type`, `worldId`, `worldVersion`, `worldTick`, `sequence`, `parentSequence`, `causationId`, and `correlationId`. The first milestone variants are `decision_requested`, `decision_accepted`, `world_released`, `interaction_arbitrated`, `object_state_changed`, `agent_need_changed`, `action_failed`, and `observation_remembered`; each variant has a strict typed payload.

- [ ] **Step 5: Implement IPC and read-only views**

Define the missing shared envelopes before composing IPC:

```ts
export const TechnicalFailureSchema = z.object({
  id: z.string().min(1),
  category: z.enum(["configuration", "model", "plugin", "protocol", "persistence", "worker"]),
  message: z.string().min(1),
  requestId: RequestIdSchema.optional(),
  retryable: z.boolean(),
  occurredAtRealTime: z.string().datetime()
}).strict();

export const WorldSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  worldId: WorldIdSchema,
  worldVersion: z.number().int().nonnegative(),
  worldTick: z.number().int().nonnegative(),
  lastEventSequence: z.number().int().nonnegative(),
  pluginLockHash: z.string().regex(/^[a-f0-9]{64}$/),
  state: JsonValueSchema
}).strict();
```

`JsonValueSchema` is recursive and rejects `undefined`, functions, symbols, `Map`, `Set`, `Date`, `NaN`, and infinities. Simulation snapshot creation converts maps to sorted arrays; restoration parses both this envelope and every plugin state schema.

```ts
export const WorkerToHostMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("worker_ready"), protocolVersion: z.literal(1) }),
  z.object({ type: z.literal("decision_requested"), request: ModelDecisionRequestSchema }),
  z.object({ type: z.literal("decision_rejected"), result: DecisionIdentitySchema, reason: z.string().min(1) }),
  z.object({ type: z.literal("event_batch"), events: z.array(DomainEventSchema).min(1) }),
  z.object({ type: z.literal("snapshot_ready"), snapshot: WorldSnapshotSchema }),
  z.object({ type: z.literal("world_view"), view: WorldViewSchema }),
  z.object({ type: z.literal("technical_failure"), failure: TechnicalFailureSchema })
]);
```

`HostToWorkerMessageSchema` variants are exactly `initialize`, `world_command`, `decision_result`, `request_snapshot`, and `shutdown`. `initialize` carries the parsed world data, locked plugin metadata, review mode, and deterministic seed; `decision_result` carries `ModelDecisionResultSchema`.

`WorldViewSchema` contains only read-only display data: identity and revision, world version/tick/mode, review setting and pause reason, named zones, render entities with stable resource IDs and integer coordinates, agent summaries, pending decision summaries, recent semantic events, and an optional redacted technical failure. It contains no plugin state blob, hidden occupancy, or full agent knowledge.

- [ ] **Step 6: Verify and commit**

Run: `pnpm --filter @god-sim/protocol test && pnpm --filter @god-sim/protocol typecheck`

```bash
git add packages/protocol
git commit -m "feat: define versioned simulation protocol"
```

### Task 3: Plugin SDK and Official Definitions

**Files:**
- Create: `packages/plugin-sdk/src/plugin/plugin-manifest.ts`
- Create: `packages/plugin-sdk/src/plugin/define-plugin.ts`
- Create: `packages/plugin-sdk/src/capability/body-slot.ts`
- Create: `packages/plugin-sdk/src/trigger/trigger-source.ts`
- Create: `packages/plugin-sdk/src/effect/effect-proposal.ts`
- Create: `packages/plugin-sdk/src/object/object-definition.ts`
- Create: `packages/plugin-sdk/src/object/object-interaction.ts`
- Create: `packages/plugin-sdk/src/object/observable-state.ts`
- Create: `packages/plugin-sdk/src/agent/agent-definition.ts`
- Create: `packages/plugin-sdk/src/prompt/prompt-contributor.ts`
- Create: `packages/plugin-sdk/src/memory/memory-extractor.ts`
- Modify: `packages/plugin-sdk/src/index.ts`
- Create: `plugins/spatial-objects/plugin.json`
- Create: `plugins/spatial-objects/src/objects/wall/definition.ts`
- Create: `plugins/spatial-objects/src/objects/wall/state.ts`
- Create: `plugins/spatial-objects/src/objects/wall/observable-state.ts`
- Create: `plugins/spatial-objects/src/objects/door/definition.ts`
- Create: `plugins/spatial-objects/src/objects/door/state.ts`
- Create: `plugins/spatial-objects/src/objects/door/interactions.ts`
- Create: `plugins/spatial-objects/src/objects/door/observable-state.ts`
- Modify: `plugins/spatial-objects/src/index.ts`
- Create: `plugins/home-objects/plugin.json`
- Create: `plugins/home-objects/src/objects/refrigerator/definition.ts`
- Create: `plugins/home-objects/src/objects/refrigerator/state.ts`
- Create: `plugins/home-objects/src/objects/refrigerator/interactions.ts`
- Create: `plugins/home-objects/src/objects/refrigerator/observable-state.ts`
- Create: `plugins/home-objects/src/objects/toilet/definition.ts`
- Create: `plugins/home-objects/src/objects/toilet/state.ts`
- Create: `plugins/home-objects/src/objects/toilet/interactions.ts`
- Create: `plugins/home-objects/src/objects/toilet/observable-state.ts`
- Modify: `plugins/home-objects/src/index.ts`
- Create: `plugins/starter-agents/plugin.json`
- Create: `plugins/starter-agents/src/agents/alice.ts`
- Create: `plugins/starter-agents/src/agents/bob.ts`
- Modify: `plugins/starter-agents/src/index.ts`
- Test: `packages/plugin-sdk/src/plugin/define-plugin.test.ts`
- Test: `plugins/spatial-objects/tests/door.test.ts`
- Test: `plugins/home-objects/tests/refrigerator.test.ts`
- Test: `plugins/home-objects/tests/toilet.test.ts`

**Interfaces:**
- Produces `definePlugin(manifest, registrations): GamePlugin`.
- Produces generic `ObjectDefinition<State>` and `InteractionDefinition<State>`.
- Produces immutable `InteractionContext`, `QueryContext`, `EffectProposal`, `ObservableObjectState`, `BodySlot`, and `TriggerSource`.
- Official plugin packages export a `GamePlugin` from their root only.

- [ ] **Step 1: Write failing purity and multi-interaction tests**

```ts
it("proposes opening a door without mutating the supplied state", () => {
  const state = Object.freeze({ open: false, locked: false });
  const result = doorOpen.complete(frozenDoorContext(state));
  expect(result.effects).toContainEqual({
    type: "replace_object_state",
    entityId: "door-1",
    expectedObjectVersion: 0,
    state: { open: true, locked: false }
  });
  expect(state).toEqual({ open: false, locked: false });
});

it("proposes a need change when toilet use completes", () => {
  const result = toiletUse.complete(frozenToiletContext({ bladder: 82 }));
  expect(result.effects).toContainEqual({
    type: "set_agent_need",
    agentId: "alice",
    need: "bladder",
    value: 5
  });
});
```

- [ ] **Step 2: Run tests and observe missing definitions**

Run: `pnpm --filter @god-sim/plugin-sdk test && pnpm --filter @god-sim/spatial-objects test && pnpm --filter @god-sim/home-objects test`

- [ ] **Step 3: Implement the SDK surface**

```ts
export interface ObjectDefinition<State> {
  readonly id: string;
  readonly version: string;
  readonly stateVersion: number;
  readonly displayName: string;
  readonly tags: readonly string[];
  readonly stateSchema: z.ZodType<State>;
  readonly initialState: () => State;
  readonly resourceId: string;
  readonly placement: PlacementCapability;
  readonly movement?: MovementCapability<State>;
  readonly vision?: VisionCapability<State>;
  readonly occupancy?: OccupancyCapability<State>;
  readonly interactions: readonly InteractionDefinition<State>[];
  readonly observe: (state: Readonly<State>, context: ObservationContext) => ObservableObjectState;
}

export interface InteractionDefinition<State> {
  readonly id: string;
  readonly trigger: "active_command";
  readonly durationTicks: number;
  readonly slots: readonly BodySlot[];
  canStart(state: Readonly<State>, context: InteractionContext): InteractionAvailability;
  complete(state: Readonly<State>, context: InteractionContext): EffectProposal;
}
```

`BodySlot` is exactly `"HEAD" | "HANDS" | "BODY"`. `TriggerSource` is exactly `"system_query" | "active_command" | "position_change" | "perception_change" | "state_threshold" | "scheduled"`. The milestone actively uses all except generic plugin-defined `position_change`; the type and router entry still exist for future objects.

`EffectProposal` is a strict discriminated union of `replace_object_state`, `set_agent_need`, `reserve_occupancy`, `release_occupancy`, and `emit_perceptible_result`. Every state effect carries its target and expected instance version. Use readonly inputs and new state values in proposals; no mutator callback receives `WorldState`.

- [ ] **Step 4: Implement wall, door, refrigerator, toilet, Alice, and Bob definitions**

Door state is `{ open: boolean; locked: boolean }`. Refrigerator state is `{ occupiedBy: AgentId | null }`. Toilet state is `{ occupiedBy: AgentId | null }`. Agent definitions contain persona text, initial memory entries, and animation resource IDs but no position or runtime needs.

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter @god-sim/plugin-sdk test && pnpm --filter @god-sim/spatial-objects test && pnpm --filter @god-sim/home-objects test && pnpm typecheck`

```bash
git add packages/plugin-sdk plugins/spatial-objects plugins/home-objects plugins/starter-agents
git commit -m "feat: add extensible object and agent plugins"
```

### Task 4: Map Loading and Deterministic World State

**Files:**
- Create: `packages/simulation/src/map/map-definition.ts`
- Create: `packages/simulation/src/map/map-loader.ts`
- Create: `packages/simulation/src/map/zone-index.ts`
- Create: `packages/simulation/src/world/world-state.ts`
- Create: `packages/simulation/src/world/entity-store.ts`
- Create: `packages/simulation/src/world/world-clock.ts`
- Create: `packages/simulation/src/world/spatial-index.ts`
- Create: `packages/simulation/src/world/deterministic-random.ts`
- Create: `content/worlds/starter-home/world.json`
- Test: `packages/simulation/src/map/map-loader.test.ts`
- Test: `packages/simulation/src/world/world-clock.test.ts`
- Test: `packages/simulation/src/world/deterministic-random.test.ts`

**Interfaces:**
- Produces `loadWorldDefinition(input, pluginRegistry): WorldState`.
- Produces `advanceWorldClock(state): WorldState`, which advances only `RUNNING` worlds by one tick.
- Produces `SpatialIndex` queries for blockers, occluders, interaction positions, and occupants.
- `WorldState` contains no framework, process, database, or model client.

- [ ] **Step 1: Write failing frozen-clock and invalid-map tests**

```ts
it.each(["THINKING", "READY_FOR_RELEASE", "TECHNICALLY_BLOCKED"] as const)(
  "does not advance while %s",
  (mode) => expect(advanceWorldClock(world({ mode, tick: 12 })).tick).toBe(12)
);

it("rejects an object whose definition is not registered", () => {
  expect(() => loadWorldDefinition(mapWithObject("missing.object"), registry())).toThrow(
    /missing\.object/
  );
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @god-sim/simulation test -- world-clock map-loader`

- [ ] **Step 3: Implement immutable world records and deterministic services**

```ts
export interface WorldState {
  readonly id: WorldId;
  readonly version: number;
  readonly tick: number;
  readonly mode: WorldMode;
  readonly reviewRequired: boolean;
  readonly randomState: number;
  readonly agents: ReadonlyMap<AgentId, AgentState>;
  readonly objects: ReadonlyMap<EntityId, ObjectInstance>;
  readonly decisionCycle: DecisionCycle | null;
  readonly technicalFailure: TechnicalFailure | null;
}
```

World transitions return a new top-level state and copy only changed maps. Plugin states are parsed at load time and after every committed effect.

- [ ] **Step 4: Create the starter-home map**

Use a `16` pixel tile grid, named `living-room`, `kitchen`, `bathroom`, and `bedroom` zones, one door between public and private space, one refrigerator, one toilet, and spawn points for Alice and Bob. Use stable IDs in every reference.

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter @god-sim/simulation test -- map-loader world-clock deterministic-random && pnpm --filter @god-sim/simulation typecheck`

```bash
git add packages/simulation/src/map packages/simulation/src/world content/worlds/starter-home/world.json
git commit -m "feat: load deterministic world maps"
```

### Task 5: Query Routing and Atomic Effects

**Files:**
- Create: `packages/simulation/src/interaction/interaction-router.ts`
- Create: `packages/simulation/src/interaction/effect-arbiter.ts`
- Create: `packages/simulation/src/interaction/effect-committer.ts`
- Create: `packages/simulation/src/interaction/domain-event-factory.ts`
- Test: `packages/simulation/src/interaction/interaction-router.test.ts`
- Test: `packages/simulation/src/interaction/effect-committer.test.ts`

**Interfaces:**
- Produces `queryObject(world, query): ObjectQueryResult` with no state mutation.
- Produces `proposeInteraction(world, request): EffectProposal`.
- Produces `commitProposal(world, proposal): CommitResult` where `CommitResult` is accepted with a new state and events, or rejected with a structured reason and unchanged original state.
- Produces `arbitrateInteractionBatch(world, requests): readonly ArbitratedInteraction[]` before any same-tick interaction proposal is committed.

- [ ] **Step 1: Write failing query-purity and atomicity tests**

```ts
it("does not change a world during a visibility query", () => {
  const before = starterWorld();
  queryObject(before, visibilityQuery("wall-1", "alice"));
  expect(before).toEqual(starterWorld());
});

it("rejects every effect when one effect is invalid", () => {
  const before = starterWorld();
  const result = commitProposal(before, proposalWithOneInvalidEffect());
  expect(result).toEqual({ accepted: false, reason: expect.any(Object), world: before });
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --filter @god-sim/simulation test -- interaction-router effect-committer`

- [ ] **Step 3: Implement candidate routing and full pre-validation**

The arbiter validates all effect targets, schemas, distances, occupancy ownership, required slots, and expected object versions before applying any effect. It first orders different arrival ticks chronologically. Contenders for the same exclusive resource on the same tick are ordered by a value from the world's deterministic random state; the value and winner are recorded in `InteractionArbitratedEvent`. Action collection order and agent map iteration order cannot decide the winner.

- [ ] **Step 4: Implement commit and event creation**

Never mutate the proposal or old world. Increment `world.version` once per accepted transaction and assign consecutive event sequence values in commit order.

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter @god-sim/simulation test -- interaction && pnpm --filter @god-sim/simulation typecheck`

```bash
git add packages/simulation/src/interaction
git commit -m "feat: arbitrate plugin effects atomically"
```

### Task 6: Goals, Body Slots, Pathing, and Local Recovery

**Files:**
- Create: `packages/simulation/src/execution/body-slots.ts`
- Create: `packages/simulation/src/execution/action.ts`
- Create: `packages/simulation/src/execution/action-runner.ts`
- Create: `packages/simulation/src/execution/path-planner.ts`
- Create: `packages/simulation/src/execution/goal-planner.ts`
- Create: `packages/simulation/src/execution/local-recovery.ts`
- Test: `packages/simulation/src/execution/body-slots.test.ts`
- Test: `packages/simulation/src/execution/path-planner.test.ts`
- Test: `tests/scenarios/locked-door-recovery.test.ts`

**Interfaces:**
- Produces `planGoal(world, agentId, goal, knowledge): ActionPlanResult`.
- Produces `advanceActions(world): ActionAdvanceResult`.
- Produces `recoverBlockedPlan(world, agentId, failure): RecoveryResult`.
- Path planning consumes `AgentKnowledge`; action execution checks authoritative `WorldState`.

- [ ] **Step 1: Write failing door behavior tests**

```ts
it("adds an automatic open action for a known unlocked door", () => {
  const plan = planGoal(worldWithClosedDoor(false), "alice", useToiletGoal(), aliceKnowledge());
  expect(plan.actions.map((action) => action.kind)).toEqual([
    "move", "open_object", "move", "use_object"
  ]);
});

it("reroutes without requesting thought when another known route exists", () => {
  const result = recoverBlockedPlan(twoRouteWorld(), "alice", lockedDoorFailure());
  expect(result.kind).toBe("replanned");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm test -- locked-door-recovery body-slots path-planner`

- [ ] **Step 3: Implement slot reservations and recoverable actions**

```ts
export interface RunningAction {
  readonly id: string;
  readonly goalId: string;
  readonly kind: "move" | "open_object" | "close_object" | "lock_object" | "unlock_object" | "use_object" | "wait";
  readonly slots: readonly BodySlot[];
  readonly startedAtTick: number;
  readonly durationTicks: number;
  readonly progressTicks: number;
  readonly preconditions: readonly ActionPrecondition[];
}
```

Movement progress is integer ticks. Preserve every unaffected action object when another agent enters a decision cycle.

- [ ] **Step 4: Implement known-map A* and authoritative execution checks**

Use rot-js `AStar` through `PathPlanner`; the passability callback reads agent knowledge. At each next step, authoritative collision and door state are checked before commit. Locked-door feedback updates only that agent's knowledge, then calls `recoverBlockedPlan`.

- [ ] **Step 5: Verify and commit**

Run: `pnpm test -- body-slots path-planner locked-door-recovery && pnpm typecheck`

```bash
git add packages/simulation/src/execution tests/scenarios/locked-door-recovery.test.ts
git commit -m "feat: execute goals with local path recovery"
```

### Task 7: Perception, Knowledge, Memory, and Decision Gate

**Files:**
- Create: `packages/simulation/src/perception/visibility-system.ts`
- Create: `packages/simulation/src/perception/observable-state.ts`
- Create: `packages/simulation/src/perception/agent-knowledge.ts`
- Create: `packages/simulation/src/perception/immediate-memory.ts`
- Create: `packages/simulation/src/decision/plan-conflict-detector.ts`
- Create: `packages/simulation/src/decision/decision-gate.ts`
- Create: `packages/simulation/src/decision/release-policy.ts`
- Test: `packages/simulation/src/perception/visibility-system.test.ts`
- Test: `tests/scenarios/perceived-refrigerator-conflict.test.ts`
- Test: `packages/simulation/src/decision/release-policy.test.ts`

**Interfaces:**
- Produces `refreshPerception(world, agentId): PerceptionUpdate`.
- Produces `detectPlanConflict(agent, perceptionChanges): PlanConflict | null`.
- Produces `requestDecisions(world, requests): WorldTransition`.
- Produces `applyReleasePolicy(world): WorldTransition`.

- [ ] **Step 1: Write the failing finite-perception scenario**

```ts
it("does not reveal refrigerator occupancy through an occluding wall", () => {
  const hidden = refreshPerception(fridgeConflictWorld({ wallBlocks: true }), "alice");
  expect(hidden.knowledge.objects.get("fridge-1")?.occupiedBy).not.toBe("bob");
  expect(hidden.decisionRequested).toBe(false);
});

it("requests thought after Alice actually sees the conflicting occupancy", () => {
  const visible = refreshPerception(fridgeConflictWorld({ wallBlocks: false }), "alice");
  expect(visible.knowledge.objects.get("fridge-1")?.occupiedBy).toBe("bob");
  expect(visible.decisionRequested).toBe(true);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm test -- perceived-refrigerator-conflict visibility-system release-policy`

- [ ] **Step 3: Implement visibility and plugin-owned observable state**

Use rot-js field-of-view with opacity supplied by the spatial query router. Only query `definition.observe` for visible or directly contacted entities. Store each knowledge entry with `sourceEventId`, `observedAtTick`, and `observationKind`.

- [ ] **Step 4: Implement conflict and release decisions**

Request thought only when a changed observation invalidates a current goal and there is no single deterministic local recovery, when `recoverBlockedPlan` returns `needs_decision`, when a high-level goal finishes, or when an urgent need threshold is crossed. Review mode waits at `READY_FOR_RELEASE`; automatic mode releases only when every request in the cycle has an accepted proposal.

- [ ] **Step 5: Verify and commit**

Run: `pnpm test -- perception decision perceived-refrigerator-conflict && pnpm typecheck`

```bash
git add packages/simulation/src/perception packages/simulation/src/decision tests/scenarios/perceived-refrigerator-conflict.test.ts
git commit -m "feat: gate decisions on subjective perception"
```

### Task 8: Simulation Engine and Full Headless Loop

**Files:**
- Create: `packages/simulation/src/engine/tick-pipeline.ts`
- Create: `packages/simulation/src/engine/simulation-engine.ts`
- Create: `packages/simulation/src/engine/view-projector.ts`
- Modify: `packages/simulation/src/index.ts`
- Create: `tests/scenarios/fixtures/fixed-decision-provider.ts`
- Create: `tests/scenarios/basic-loop.test.ts`
- Create: `tests/scenarios/bladder-toilet-loop.test.ts`
- Create: `tests/scenarios/pause-preserves-actions.test.ts`

**Interfaces:**
- Produces `createSimulation(options): SimulationEngine`.
- `SimulationEngine` exposes `dispatch(command)`, `acceptDecision(adoptedDecision)`, `tick()`, `getView()`, `getPendingDecisionInputs()`, `drainEvents()`, and `createSnapshot()`.
- `getPendingDecisionInputs()` returns protocol-owned subjective context plus offered goal options. The worker passes those values to cognition; simulation and cognition never import each other.
- `acceptDecision` consumes a simulation-owned `AdoptedDecision` containing the exact stored request identity, resolved program-owned goal, and model reason. It revalidates identity and current world capability before buffering the goal.
- The engine exposes data, not timers; Simulation Worker owns real scheduling.

- [ ] **Step 1: Write the failing full-loop test**

```ts
it("freezes, adopts decisions, runs, perceives conflict, and freezes again", () => {
  const engine = starterEngine({ reviewRequired: true });
  expect(engine.getView().mode).toBe("THINKING");
  acceptInitialGoals(engine, { alice: useFridgeGoal(), bob: useFridgeGoal() });
  expect(engine.getView().mode).toBe("READY_FOR_RELEASE");
  engine.dispatch(releaseCommand(engine));
  runUntil(engine, (view) => view.pauseReason?.code === "perceived_goal_conflict");
  expect(engine.getView().mode).toBe("THINKING");
  expect(engine.getView().worldTick).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm test -- basic-loop bladder-toilet-loop`

- [ ] **Step 3: Implement the fixed tick order**

The exact order is: validate queued commands, commit adopted external decisions, advance clock, advance needs, advance actions, collect and arbitrate same-tick interaction intents, commit accepted effects, refresh changed perceptions, update immediate memories, perform local recovery, request new decisions for completed or invalidated goals, project the view, emit an event batch.

- [ ] **Step 4: Implement bladder threshold and toilet completion**

Bladder increments only in `RUNNING`, emits an immediate sensation only when crossing configured levels, and requests a decision at the urgent threshold. Toilet completion commits the plugin's `set_agent_need` proposal and releases its occupant.

- [ ] **Step 5: Verify and commit**

Run: `pnpm test -- basic-loop bladder-toilet-loop pause-preserves-actions locked-door-recovery perceived-refrigerator-conflict && pnpm --filter @god-sim/simulation typecheck`

```bash
git add packages/simulation tests/scenarios
git commit -m "feat: complete deterministic headless loop"
```

### Task 9: Cognition and Model Gateway

**Files:**
- Create: `packages/cognition/src/context/cognition-context.ts`
- Create: `packages/cognition/src/memory/relevant-memory-selector.ts`
- Create: `packages/cognition/src/prompt/prompt-budget.ts`
- Create: `packages/cognition/src/prompt/prompt-assembler.ts`
- Create: `packages/cognition/src/decision/goal-proposal-validator.ts`
- Modify: `packages/cognition/src/index.ts`
- Create: `packages/model-gateway/src/config/model-config.ts`
- Create: `packages/model-gateway/src/decision-provider.ts`
- Create: `packages/model-gateway/src/openrouter/openrouter-decision-provider.ts`
- Create: `packages/model-gateway/src/fixed/fixed-decision-provider.ts`
- Modify: `packages/model-gateway/src/index.ts`
- Test: `packages/cognition/src/prompt/prompt-assembler.test.ts`
- Test: `packages/cognition/src/decision/goal-proposal-validator.test.ts`
- Test: `packages/model-gateway/src/openrouter/openrouter-decision-provider.test.ts`

**Interfaces:**
- Produces `assembleDecisionRequest(identity, context, agentDefinition): ModelDecisionRequest`.
- Produces `resolveGoalProposal(proposal, offeredGoals): Goal`; it rejects unknown option IDs and returns the immutable program-owned goal for a valid ID.
- Produces `DecisionProvider.decide(request, signal): Promise<GoalProposal>`. The local-server coordinator wraps the proposal with the request identity to create `ModelDecisionResult`.

- [ ] **Step 1: Write failing prompt isolation and output validation tests**

```ts
it("does not include hidden world facts", () => {
  const request = assembleDecisionRequest(aliceContextWithoutFridgeSight(), aliceDefinition);
  expect(request.messages.join("\n")).not.toContain("occupied by Bob");
});

it("rejects a syntactically valid option ID outside the offered set", () => {
  expect(() => resolveGoalProposal(useFridgeProposal(), [waitGoalOption()])).toThrow(
    /not offered/
  );
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @god-sim/cognition test && pnpm --filter @god-sim/model-gateway test`

- [ ] **Step 3: Implement ordered prompt sections and memory selection**

Assemble exactly: core rules, persona, body state, current goal, relevant memories, current perception, offered goals, current decision reason, then the JSON response schema. Reject plugin prompt sections that request an order before core rules.

- [ ] **Step 4: Implement the providers**

The OpenRouter provider reads a passed `ModelConfig`; it never reads files itself. Use `fetch` with `AbortSignal`, parse only the returned assistant content, and redact authorization headers from thrown diagnostics. The fixed provider maps `requestId` or `(agentId, decisionReason.code)` to deterministic `goalOptionId` values and verifies that the selected ID exists in `request.goalOptions`.

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter @god-sim/cognition test && pnpm --filter @god-sim/model-gateway test && pnpm typecheck`

```bash
git add packages/cognition packages/model-gateway
git commit -m "feat: isolate cognition and model decisions"
```

### Task 10: Timeline Contracts and SQLite Persistence

**Files:**
- Create: `packages/timeline/src/model-call-record.ts`
- Create: `packages/timeline/src/plugin-lock-record.ts`
- Create: `packages/timeline/src/timeline-store.ts`
- Modify: `packages/timeline/src/index.ts`
- Create: `packages/sqlite-store/src/database-schema.ts`
- Create: `packages/sqlite-store/src/migrations/001-initial.ts`
- Create: `packages/sqlite-store/src/sqlite-timeline-store.ts`
- Modify: `packages/sqlite-store/src/index.ts`
- Test: `packages/sqlite-store/src/sqlite-timeline-store.test.ts`

**Interfaces:**
- Produces `TimelineStore.appendEvents`, `saveSnapshot`, `savePluginLock`, `saveModelCall`, `recordFailure`, `loadLatest`, and `close`.
- Produces `createSqliteTimelineStore({ filename }): TimelineStore`.
- `appendEvents` consumes protocol `DomainEvent`; `saveSnapshot` consumes protocol `WorldSnapshot`; neither package declares replacement shapes.
- The timeline package contains no SQL and the SQLite package contains no simulation decisions.

- [ ] **Step 1: Write a failing transaction and restore test**

```ts
it("restores a snapshot and all later semantic events in order", async () => {
  const store = createSqliteTimelineStore({ filename: ":memory:" });
  await store.saveSnapshot(snapshotAt(12));
  await store.appendEvents([eventAt(13, 1), eventAt(13, 2)]);
  const restored = await store.loadLatest("starter-world");
  expect(restored).toEqual({ snapshot: snapshotAt(12), events: [eventAt(13, 1), eventAt(13, 2)] });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @god-sim/sqlite-store test`

- [ ] **Step 3: Implement the narrow store interface and migration**

Use tables `worlds`, `plugin_locks`, `events`, `snapshots`, `model_calls`, and `technical_failures`. Store event and snapshot payloads as versioned JSON, with indexed `(world_id, sequence)` and `(world_id, world_version)` columns. One Kysely transaction writes each event batch.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter @god-sim/sqlite-store test && pnpm --filter @god-sim/sqlite-store typecheck`

```bash
git add packages/timeline packages/sqlite-store
git commit -m "feat: persist semantic world history"
```

### Task 11: Simulation Worker and Local Server

**Files:**
- Create: `apps/simulation-worker/src/runtime/plugin-loader.ts`
- Create: `apps/simulation-worker/src/runtime/plugin-lock.ts`
- Create: `apps/simulation-worker/src/runtime/world-session.ts`
- Create: `apps/simulation-worker/src/ipc/worker-message-handler.ts`
- Create: `apps/simulation-worker/src/bootstrap/start-simulation-worker.ts`
- Modify: `apps/simulation-worker/src/index.ts`
- Create: `apps/local-server/src/config/local-config.ts`
- Create: `apps/local-server/src/sessions/worker-supervisor.ts`
- Create: `apps/local-server/src/sessions/session-coordinator.ts`
- Create: `apps/local-server/src/decisions/decision-request-coordinator.ts`
- Create: `apps/local-server/src/persistence/persistence-writer.ts`
- Create: `apps/local-server/src/transport/http-routes.ts`
- Create: `apps/local-server/src/transport/world-websocket.ts`
- Create: `apps/local-server/src/transport/static-web.ts`
- Create: `apps/local-server/src/bootstrap/start-local-server.ts`
- Modify: `apps/local-server/src/index.ts`
- Test: `apps/simulation-worker/src/runtime/plugin-lock.test.ts`
- Test: `apps/local-server/src/sessions/session-coordinator.test.ts`
- Test: `tests/integration/local-process-loop.test.ts`
- Test: `tests/integration/worker-failure.test.ts`
- Test: `tests/integration/websocket-reconnect.test.ts`

**Interfaces:**
- Worker owns one `SimulationEngine` and emits only parsed `WorkerToHostMessage` values.
- Local server exposes `GET /api/health`, `GET /api/world`, `POST /api/commands`, and `GET /api/events` as WebSocket upgrade. A production start also serves `apps/web/dist`; Vite development proxies `/api` and WebSocket traffic to the local server.
- `SessionCoordinator` is the only application object that coordinates worker, model provider, persistence writer, and clients; it contains no world rules.

- [ ] **Step 1: Write the failing process loop and stale response tests**

```ts
it("keeps world tick frozen while two decisions are pending", async () => {
  const app = await testLocalApp({ provider: deferredDecisionProvider() });
  const before = await app.worldView();
  expect(before.mode).toBe("THINKING");
  await app.waitRealMilliseconds(150);
  expect((await app.worldView()).worldTick).toBe(before.worldTick);
});

it("rejects a result for an older world version", async () => {
  const worker = await testWorker();
  expect(await worker.send(staleDecisionResult())).toMatchObject({ type: "decision_rejected" });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm test -- plugin-lock session-coordinator local-process-loop worker-failure websocket-reconnect`

- [ ] **Step 3: Implement worker startup and plugin locking**

Resolve plugin entry paths from explicit local configuration, hash built entry files with SHA-256, validate manifests, create the engine, and start a real-time interval that calls `engine.tick()` only when running. Validate every IPC message at both sender and receiver.

- [ ] **Step 4: Implement model, persistence, and browser coordination**

Start model requests concurrently per decision cycle. On failure, keep accepted peer results, persist a redacted failure, publish a technical decision error, and wait for `retry_decision`. Persist each semantic event batch before acknowledging the next critical boundary.

- [ ] **Step 5: Implement Fastify transport and structured development logs**

Use newline-delimited JSON logs under ignored `data/logs`. The logger redacts `authorization`, `apiKey`, and known secret values. WebSocket clients receive the latest full view on connect and subsequent view revisions; their messages are commands only.

- [ ] **Step 6: Verify and commit**

Run: `pnpm test -- plugin-lock session-coordinator local-process-loop worker-failure websocket-reconnect && pnpm --filter @god-sim/simulation-worker typecheck && pnpm --filter @god-sim/local-server typecheck`

```bash
git add apps/simulation-worker apps/local-server tests/integration
git commit -m "feat: run simulation through local host"
```

### Task 12: Licensed Assets and Starter World Rendering

**Files:**
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `plugins/home-objects/assets/pixel-16-interiors/tiles.png`
- Create: `plugins/home-objects/assets/pixel-16-interiors/furniture.png`
- Create: `plugins/home-objects/assets/pixel-16-interiors/carpets.png`
- Create: `plugins/home-objects/assets/asset-manifest.json`
- Create: `plugins/starter-agents/assets/memao/alice.png`
- Create: `plugins/starter-agents/assets/memao/bob.png`
- Create: `plugins/starter-agents/assets/animation-manifest.json`
- Create: `apps/web/src/features/world-map/render-projection.ts`
- Create: `apps/web/src/features/world-map/pixi-world-renderer.ts`
- Create: `apps/web/src/features/world-map/world-map.tsx`
- Test: `apps/web/src/features/world-map/render-projection.test.ts`
- Test: `tests/assets/asset-manifests.test.ts`

**Interfaces:**
- Asset manifests map stable resource IDs to source files, source rectangles, anchors, and animation frame sequences.
- `projectWorldView(view): readonly RenderEntity[]` is the only conversion from protocol views to Pixi render data.
- Pixi renderer consumes render data and emits selection IDs; it never sends world mutations.

- [ ] **Step 1: Write failing asset and render projection tests**

```ts
it("uses stable IDs instead of source file paths in world views", () => {
  expect(projectWorldView(worldViewFixture())[0]).toMatchObject({
    entityId: "alice",
    resourceId: "starter-agents.memao.alice"
  });
});

it("keeps every frame rectangle inside its source image", async () => {
  const result = await validateAssetManifests();
  expect(result.errors).toEqual([]);
});
```

- [ ] **Step 2: Run tests and verify missing assets fail**

Run: `pnpm test -- render-projection asset-manifests`

- [ ] **Step 3: Copy only selected authorized assets**

Copy from the user-provided staging paths:

```text
workspace/2026年8月31日/Pixel 16 Interiors/interiors/tiles (floor and walls).png
workspace/2026年8月31日/Pixel 16 Interiors/interiors/furniture set and decorations.png
workspace/2026年8月31日/Pixel 16 Interiors/interiors/carpets.png
workspace/2026年8月31日/MemaoCharacterSpritePack/Sprite1.png
workspace/2026年8月31日/MemaoCharacterSpritePack/Sprite2.png
```

Do not copy ZIP archives or unused packs. Record Sleeping Robot Games/Memao and the Pixel 16 Interiors source information supplied with the assets, plus the maintainer's project-specific permission confirmation.

- [ ] **Step 4: Implement manifests and Pixi rendering**

Build one continuous home from the tile, carpet, and furniture sheets; the files under `interiors/mock` are visual references only and are not shipped. Logical floors, wall edges, doors, occupied cells, and interaction positions remain explicit in `world.json` rather than inferred from pixels. Slice each Memao sheet as an `8x8` grid of `48x48` frames. Set Pixi textures to nearest-neighbor and anchor character sprites at bottom center.

- [ ] **Step 5: Verify and commit**

Run: `pnpm test -- render-projection asset-manifests && pnpm --filter @god-sim/web typecheck`

```bash
git add THIRD_PARTY_NOTICES.md plugins/home-objects/assets plugins/starter-agents/assets apps/web/src/features/world-map tests/assets
git commit -m "feat: render starter world with licensed assets"
```

### Task 13: Director Workbench Browser UI

**Files:**
- Create: `apps/web/index.html`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app/app.tsx`
- Create: `apps/web/src/app/app-shell.tsx`
- Create: `apps/web/src/app/app.css`
- Create: `apps/web/src/transport/world-client.ts`
- Create: `apps/web/src/features/agent-list/agent-list.tsx`
- Create: `apps/web/src/features/agent-inspector/agent-inspector.tsx`
- Create: `apps/web/src/features/decision-review/decision-review.tsx`
- Create: `apps/web/src/features/event-strip/event-strip.tsx`
- Test: `apps/web/src/app/app.test.tsx`
- Test: `apps/web/src/transport/world-client.test.ts`

**Interfaces:**
- `WorldClient` exposes `subscribe(listener)`, `send(command)`, `connect()`, and `disconnect()`.
- App components consume only `WorldView` and callback commands.
- Selection is browser-local and keyed by stable entity ID.

- [ ] **Step 1: Write failing UI behavior tests**

```tsx
it("shows the thinking reason and disables release before decisions are ready", () => {
  render(<App client={fakeWorldClient(thinkingView())} />);
  expect(screen.getByText("角色思考中")).toBeVisible();
  expect(screen.getByRole("button", { name: "放行世界" })).toBeDisabled();
});

it("sends a release command when ready", async () => {
  const client = fakeWorldClient(readyView());
  render(<App client={client} />);
  await userEvent.click(screen.getByRole("button", { name: "放行世界" }));
  expect(client.sentCommands).toContainEqual(expect.objectContaining({ type: "release_execution" }));
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @god-sim/web test`

- [ ] **Step 3: Implement the approved A layout**

Build the persistent top bar, left agent list, central map, right inspector tabs, and bottom event/release strip. Use Lucide React icons for map tools and release/retry controls. The first route is the game itself; create no landing page.

- [ ] **Step 4: Implement commands and error states**

Space triggers release only from `READY_FOR_RELEASE`. The review toggle sends `set_review_mode`. Technical decision errors show agent, error category, request ID, and a retry button; never replace the error with a successful-looking idle state.

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter @god-sim/web test && pnpm --filter @god-sim/web typecheck && pnpm --filter @god-sim/web build`

```bash
git add apps/web
git commit -m "feat: add director workbench interface"
```

### Task 14: End-to-End Milestone Verification

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/basic-loop.spec.ts`
- Create: `tests/e2e/bladder-toilet.spec.ts`
- Create: `tests/e2e/review-mode.spec.ts`
- Create: `tests/e2e/technical-retry.spec.ts`
- Create: `tests/e2e/canvas-pixels.ts`
- Create: `scripts/start-test-app.mjs`
- Create: `README.md`
- Modify: root `package.json`

**Interfaces:**
- Test startup injects the fixed decision provider through `GOD_SIM_DECISION_PROVIDER=fixed`.
- Production development startup defaults to OpenRouter only when valid local configuration exists; absence produces an explicit technical configuration error.

- [ ] **Step 1: Write the failing browser milestone test**

```ts
test("runs the perception-conflict decision loop", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("角色思考中")).toBeVisible();
  await expect(page.getByText("Alice")).toBeVisible();
  await page.getByRole("button", { name: "放行世界" }).click();
  await expect(page.getByText(/冰箱.*Bob.*使用/)).toBeVisible();
  await expect(page.getByText("角色思考中")).toBeVisible();
  expect(await countNonBackgroundCanvasPixels(page)).toBeGreaterThan(1000);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm test:e2e -- tests/e2e/basic-loop.spec.ts`

- [ ] **Step 3: Implement deterministic test startup and user documentation**

Document `pnpm install`, `pnpm dev`, the full local URL, review mode, fixed-provider test mode, OpenRouter config keys, data/log locations, and the explicit non-goals from the milestone. Do not print or document the actual key from `free_model.local`.

- [ ] **Step 4: Run full verification**

Run: `pnpm lint`

Run: `pnpm typecheck`

Run: `pnpm test`

Run: `pnpm build`

Run: `pnpm test:e2e`

Expected: every command exits 0; Playwright verifies both `1280x720` and `960x720`, no console errors, no overlapping primary controls, nonblank canvas pixels, review-gated release, perceived refrigerator conflict, and explicit retry.

- [ ] **Step 5: Run the real-model smoke test**

Start the app with `free_model.local`, verify the world remains at the same tick throughout the real response wait, accept one valid goal, and stop. Record only pass/fail, response latency, model ID, and request ID; do not record the key or authorization header.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts tests/e2e scripts/start-test-app.mjs README.md package.json
git commit -m "test: verify first playable milestone"
```

## Completion Gate

The milestone is complete only when every Task 14 command passes from a fresh checkout, the real-model smoke test succeeds or reports an external provider failure without corrupting state, and the 13-step acceptance scenario in the design spec is demonstrated from the browser. A partial UI, headless-only engine, or successful model request without finite perception and rethinking is not completion.
