# Milestone Architecture Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove official-furniture knowledge from the simulation core, make every new memory traceable to a real Event, and persist each semantic world boundary as one atomic SQLite checkpoint.

**Architecture:** Public protocol and plugin capability types are defined first, then the deterministic simulation consumes only those capabilities. The worker holds a persistence barrier around semantic checkpoints, while the local server remains the sole SQLite writer and acknowledges a checkpoint only after one transaction has committed its Events and Snapshot.

**Tech Stack:** Node.js 24, pnpm 10, strict TypeScript 6, Zod 4, rot-js 2, better-sqlite3 13, Kysely 0.29, Vitest 4, Playwright 1.62.

**Spec:** `docs/superpowers/specs/2026-08-31-milestone-architecture-hardening-design.md`

## Global Constraints

- `WorldState` in the simulation worker remains the only writable current-world truth.
- Only `RUNNING` advances the fixed `100ms` integer world tick.
- Gameplay pause occurs only because an agent needs a decision; persistence waits are technical barriers, not thought.
- `packages/simulation` cannot inspect object definition IDs, furniture tags, private state fields, or official interaction IDs to choose behavior.
- Model code chooses only a program-offered high-level goal; it never executes movement or writes world state.
- New knowledge and memory references must resolve to committed or same-checkpoint Domain Events.
- Event and Snapshot writes for new sessions use one atomic checkpoint transaction; no per-tick persistence is added.
- Existing version-1 Snapshots remain readable and are explicitly marked legacy after restoration; old history is never rewritten or fabricated.
- Full prompts, API keys, authorization headers, render frames, path previews, and visibility intermediates are not persisted.
- Cross-package imports use package roots and follow the exact allow-list in the design specification.
- Every implementation task follows red-green-refactor and ends with a focused passing test command and a commit.
- Work is executed inline in this session because this project has explicitly chosen not to use subagents.

## File Responsibility Map

| Responsibility | Owning files |
| --- | --- |
| Versioned Event, Snapshot, checkpoint IPC shapes | `packages/protocol/src/events/`, `world/world-snapshot.ts`, `ipc/host-worker-message.ts` |
| Plugin-declared automatic traversal | `packages/plugin-sdk/src/object/object-definition.ts`, `plugin/define-plugin.ts` |
| Official door private state and traversal declaration | `plugins/spatial-objects/src/objects/door/` |
| Generic action planning and local route recovery | `packages/simulation/src/execution/` |
| Event-first subjective knowledge and memory | `packages/simulation/src/perception/`, `map/map-loader.ts`, `engine/tick-pipeline.ts` |
| Snapshot projection, compatibility restoration, causal validation | `packages/simulation/src/engine/snapshot-*.ts`, `world/world-state.ts` |
| Checkpoint preparation and acknowledgement | `packages/simulation/src/engine/simulation-engine.ts`, `apps/simulation-worker/src/runtime/world-session.ts` |
| Store-neutral checkpoint and model records | `packages/timeline/src/` |
| SQLite transaction and additive migration | `packages/sqlite-store/src/` |
| Single-writer queue, model metadata, checkpoint coordination | `apps/local-server/src/persistence/`, `decisions/`, `sessions/` |
| Workspace dependency enforcement | `.dependency-cruiser.cjs`, `tests/architecture/dependency-boundaries.test.ts` |
| End-to-end history audit | `scripts/audit-world-history.mjs`, scenario/integration/e2e tests |

---

### Task 1: Versioned Causal Protocol and Checkpoint Messages

**Files:**
- Create: `packages/protocol/src/events/perception-recorded.event.ts`
- Modify: `packages/protocol/src/events/action-failed.event.ts`
- Modify: `packages/protocol/src/events/domain-event.ts`
- Modify: `packages/protocol/src/identity/ids.ts`
- Modify: `packages/protocol/src/world/world-snapshot.ts`
- Modify: `packages/protocol/src/ipc/host-worker-message.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/src/events/domain-event.test.ts`
- Test: `packages/protocol/src/world/world-snapshot.test.ts`
- Test: `packages/protocol/src/ipc/host-worker-message.test.ts`

**Interfaces:**
- Produces `CheckpointIdSchema` and `CheckpointId`.
- Produces `PerceptionRecordedEventSchema` with `agentId`, `observationKind`, `summary`, and nullable `relatedEntityId`.
- Extends new `action_failed` payloads with `summary` and optional `entityId`, while parsing legacy rows that lack them.
- Produces a `WorldSnapshotSchema` union that reads version 1 and writes version 2 with `history` and `causalEventIds`.
- Exports `WorldSnapshotV1` and `WorldSnapshotV2` as the inferred types of the two versioned schemas.
- Produces `checkpoint_ready` and `checkpoint_committed` IPC messages. Legacy split-write variants remain parseable until all callers migrate in Task 8.

- [ ] **Step 1: Write failing Event tests**

```ts
it("accepts a perception as its own causal source", () => {
  const event = DomainEventSchema.parse({
    schemaVersion: 1,
    eventId: "event:starter-world:7",
    type: "perception_recorded",
    worldId: "starter-world",
    worldVersion: 3,
    worldTick: 2,
    sequence: 7,
    parentSequence: 6,
    causationId: "vision:alice:fridge-1",
    correlationId: "tick:2",
    agentId: "alice",
    observationKind: "vision",
    summary: "Bob is using the refrigerator",
    relatedEntityId: "fridge-1",
  });
  expect(event.type).toBe("perception_recorded");
});

it("keeps a perceived action failure diagnostic", () => {
  const event = actionFailedEvent({
    summary: "The passage cannot be opened",
    entityId: "passage-1",
  });
  expect(DomainEventSchema.parse(event)).toMatchObject({
    reasonCode: "sealed",
    summary: "The passage cannot be opened",
    entityId: "passage-1",
  });
});
```

- [ ] **Step 2: Run the focused Event test and verify red**

Run: `pnpm exec vitest run packages/protocol/src/events/domain-event.test.ts`

Expected: FAIL because `perception_recorded` is not part of `DomainEventSchema` and the action-failure fields are not defined.

- [ ] **Step 3: Implement the Event contracts**

```ts
export const PerceptionRecordedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal("perception_recorded"),
  agentId: AgentIdSchema,
  observationKind: z.enum([
    "vision",
    "hearing",
    "contact",
    "interaction",
    "body",
    "memory",
  ]),
  summary: z.string().min(1).max(500),
  relatedEntityId: EntityIdSchema.nullable(),
}).strict();

export const ActionFailedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal("action_failed"),
  agentId: AgentIdSchema,
  actionId: z.string().min(1),
  reasonCode: z.string().min(1).max(120),
  summary: z.string().min(1).max(500).optional(),
  entityId: EntityIdSchema.optional(),
  perceivedByAgent: z.boolean(),
}).strict();
```

Keep `ObservationRememberedEventSchema` in the union for old stored Events. Export the new Event from `packages/protocol/src/index.ts`.

- [ ] **Step 4: Write failing Snapshot and IPC tests**

```ts
it("marks a new causal snapshot as strict", () => {
  const parsed = WorldSnapshotSchema.parse({
    schemaVersion: 2,
    worldId: "starter-world",
    worldVersion: 8,
    worldTick: 42,
    lastEventSequence: 17,
    pluginLockHash: "b".repeat(64),
    history: { mode: "strict", causalFromSequence: 1 },
    causalEventIds: ["event:starter-world:3", "event:starter-world:17"],
    state: {},
  });
  expect(parsed.schemaVersion).toBe(2);
});

it("carries one atomic checkpoint and its acknowledgement", () => {
  const ready = WorkerToHostMessageSchema.parse({
    type: "checkpoint_ready",
    checkpointId: "checkpoint:starter-world:8:17",
    events: [decisionRequestedEvent(17)],
    snapshot: strictSnapshot(17),
  });
  const committed = HostToWorkerMessageSchema.parse({
    type: "checkpoint_committed",
    checkpointId: ready.checkpointId,
  });
  expect(committed.type).toBe("checkpoint_committed");
});
```

- [ ] **Step 5: Run Snapshot and IPC tests and verify red**

Run: `pnpm exec vitest run packages/protocol/src/world/world-snapshot.test.ts packages/protocol/src/ipc/host-worker-message.test.ts`

Expected: FAIL because version 2 and checkpoint messages are missing.

- [ ] **Step 6: Implement versioned Snapshots and checkpoint IPC**

```ts
export const WorldSnapshotV1Schema = WorldSnapshotBaseSchema.extend({
  schemaVersion: z.literal(1),
}).strict();

export const WorldSnapshotV2Schema = WorldSnapshotBaseSchema.extend({
  schemaVersion: z.literal(2),
  history: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("strict"), causalFromSequence: z.literal(1) }).strict(),
    z.object({
      mode: z.literal("legacy"),
      causalFromSequence: z.number().int().positive(),
    }).strict(),
  ]),
  causalEventIds: z.array(EventIdSchema),
}).strict();

export const WorldSnapshotSchema = z.discriminatedUnion("schemaVersion", [
  WorldSnapshotV1Schema,
  WorldSnapshotV2Schema,
]);

export type WorldSnapshotV1 = z.infer<typeof WorldSnapshotV1Schema>;
export type WorldSnapshotV2 = z.infer<typeof WorldSnapshotV2Schema>;
```

Define `CheckpointReadyMessageSchema` with a possibly empty `events` array and `WorldSnapshotV2Schema`; define `CheckpointCommittedMessageSchema` with only the checkpoint identity. Keep `event_batch`, `snapshot_ready`, and `request_snapshot` in the parsing unions through Task 7 so existing applications still compile, annotate them as legacy, and remove their production send/handle paths in Task 8.

- [ ] **Step 7: Verify and commit**

Run: `pnpm exec vitest run packages/protocol/src/events/domain-event.test.ts packages/protocol/src/world/world-snapshot.test.ts packages/protocol/src/ipc/host-worker-message.test.ts && pnpm --filter @god-sim/protocol typecheck`

```bash
git add packages/protocol
git commit -m "feat: define causal checkpoint protocol"
```

### Task 2: Plugin-Owned Automatic Traversal Capability

**Files:**
- Modify: `packages/plugin-sdk/src/object/object-definition.ts`
- Modify: `packages/plugin-sdk/src/plugin/define-plugin.ts`
- Test: `packages/plugin-sdk/src/plugin/define-plugin.test.ts`
- Modify: `plugins/spatial-objects/src/objects/door/definition.ts`
- Test: `plugins/spatial-objects/tests/door.test.ts`

**Interfaces:**
- Produces `AutomaticTraversalCapability { interactionId: string }` on `ObjectDefinition.traversal`.
- `definePlugin` rejects a traversal interaction ID not present in the same object definition.
- The official door exposes automatic traversal through `open`; its `open` and `locked` fields remain private to the plugin.

- [ ] **Step 1: Write the failing plugin validation test**

```ts
it("rejects a traversal capability that names no interaction", () => {
  const definition = {
    ...objectDefinition("test.object"),
    traversal: { interactionId: "open" },
  };
  expect(() => definePlugin(manifest, { objects: [definition], agents: [] }))
    .toThrow(/automatic traversal interaction open/i);
});
```

- [ ] **Step 2: Run the SDK test and verify red**

Run: `pnpm exec vitest run packages/plugin-sdk/src/plugin/define-plugin.test.ts`

Expected: FAIL because no traversal validation exists.

- [ ] **Step 3: Implement the capability and registration invariant**

```ts
export interface AutomaticTraversalCapability {
  readonly interactionId: string;
}

export interface ObjectDefinition<State = unknown> {
  // Existing fields remain unchanged.
  readonly traversal?: AutomaticTraversalCapability;
  readonly interactions: readonly InteractionDefinition<State>[];
}
```

```ts
for (const definition of registrations.objects) {
  JsonValueSchema.parse(definition.stateSchema.parse(definition.initialState()));
  if (
    definition.traversal &&
    !definition.interactions.some(
      (interaction) => interaction.id === definition.traversal?.interactionId,
    )
  ) {
    throw new Error(
      `Object ${definition.id} automatic traversal interaction ${definition.traversal.interactionId} is not registered`,
    );
  }
}
```

- [ ] **Step 4: Make the official door opt into the capability**

Add exactly this declaration to `doorDefinition`:

```ts
traversal: { interactionId: "open" },
```

Extend `door.test.ts` to assert that a locked door rejects `open` with `reasonCode: "locked"`, while the SDK-facing definition reveals only the interaction ID and never exposes a core-owned lock contract.

- [ ] **Step 5: Verify and commit**

Run: `pnpm exec vitest run packages/plugin-sdk/src/plugin/define-plugin.test.ts plugins/spatial-objects/tests/door.test.ts && pnpm --filter @god-sim/plugin-sdk typecheck && pnpm --filter @god-sim/spatial-objects typecheck`

```bash
git add packages/plugin-sdk plugins/spatial-objects
git commit -m "feat: let plugins declare automatic traversal"
```

### Task 3: Generic Object Actions and Capability-Based Routing

**Files:**
- Modify: `packages/simulation/src/execution/action.ts`
- Modify: `packages/simulation/src/execution/path-planner.ts`
- Modify: `packages/simulation/src/execution/goal-planner.ts`
- Modify: `packages/simulation/src/execution/action-runner.ts`
- Modify: `packages/simulation/src/execution/local-recovery.ts`
- Modify: `packages/simulation/src/interaction/interaction-router.ts`
- Modify: `packages/simulation/src/engine/tick-pipeline.ts`
- Modify: `packages/simulation/src/engine/snapshot-restorer.ts`
- Modify: `packages/simulation/src/engine/snapshot-restorer.test.ts`
- Modify: `packages/simulation/src/engine/view-projector.ts`
- Modify: `apps/web/src/features/world-map/render-projection.ts`
- Test: `packages/simulation/src/execution/path-planner.test.ts`
- Test: `packages/simulation/src/execution/action-runner.test.ts`
- Test: `tests/scenarios/locked-door-recovery.test.ts`
- Test: `apps/web/src/features/world-map/render-projection.test.ts`

**Interfaces:**
- Replaces furniture-specific object action kinds with `ObjectInteractionAction.kind = "interact_object"` and `purpose = "goal" | "automatic_traversal"`.
- Replaces `knownLockedDoorIds` with `knownTraversalBlockers: ReadonlyMap<EntityId, KnownTraversalBlocker>`.
- `findPath` treats an unknown blocking object as tentatively passable only when its plugin declares traversal.
- `recoverBlockedPlan` excludes the experienced object and either replans or returns `needs_decision`.

- [ ] **Step 1: Replace the locked-door scenario with an anonymous passage fixture**

Build a test object whose private state is `{ sealed: boolean; raised: boolean }`, whose tags are `[]`, and whose traversal interaction is `raise`. Assert the planned kinds and purposes:

```ts
expect(result.plan.actions.map((action) =>
  action.kind === "interact_object" ? `${action.kind}:${action.purpose}` : action.kind,
)).toEqual([
  "move",
  "interact_object:automatic_traversal",
  "move",
  "interact_object:goal",
]);
```

Assert that a failed `raise` records the passage in `knownTraversalBlockers`, finds an alternate route when present, and returns `needs_decision` only when every known route is blocked.

- [ ] **Step 2: Run traversal and action tests and verify red**

Run: `pnpm exec vitest run tests/scenarios/locked-door-recovery.test.ts packages/simulation/src/execution/path-planner.test.ts packages/simulation/src/execution/action-runner.test.ts`

Expected: FAIL because the core still checks the `door` tag and furniture-specific action kinds.

- [ ] **Step 3: Introduce the generic action and navigation knowledge**

```ts
export interface ObjectInteractionAction extends ActionBase {
  readonly kind: "interact_object";
  readonly purpose: "goal" | "automatic_traversal";
  readonly targetEntityId: EntityId;
  readonly interactionId: string;
  readonly started: boolean;
}

export interface KnownTraversalBlocker {
  readonly entityId: EntityId;
  readonly observedObjectVersion: number;
  readonly reasonCode: string;
  readonly sourceEventId: EventId;
}

export interface AgentNavigationKnowledge {
  readonly knownTraversalBlockers: ReadonlyMap<EntityId, KnownTraversalBlocker>;
}
```

All goal interactions use `purpose: "goal"`. A traversal action obtains its `interactionId`, duration, and body slots from `definition.traversal` and the matching `InteractionDefinition`.

Update the current serialized-action schema to accept `interact_object` and its required `purpose`, so Snapshots produced after this task restore without waiting for Task 5. Task 5 then adds the separate version-1 legacy-action parser and conversion.

- [ ] **Step 4: Make path passability depend only on public capabilities**

Use this rule for each object occupying a candidate cell:

```ts
if (knowledge.knownTraversalBlockers.has(object.id)) return false;
const definition = registry.getObject(object.definitionId)?.definition;
const blocks = spatial.objectBlocksMovement(object.id, agentId);
if (!blocks) continue;
if (definition?.traversal) continue;
return false;
```

When creating path actions, inspect actual blockers at each path cell. Insert `interact_object/automatic_traversal` for each blocking object with a traversal capability, sorted by entity ID. Never inspect its state shape or tags.

- [ ] **Step 5: Preserve failure purpose and verify traversal completion**

Add `purpose?: ObjectInteractionAction["purpose"]` to internal `ActionFailure`. Copy the current action purpose into failures from `canStart`, arbitration, commit, and completion. After an automatic traversal interaction completes, call the public movement query again; if its object still blocks, return:

```ts
{
  code: "automatic_traversal_still_blocked",
  actionId,
  entityId,
  purpose: "automatic_traversal",
  summary: `${entityId} still blocks movement after ${interactionId}`,
}
```

Remove the `locked` to `locked_door` translation and every `tags.includes("door")` branch from simulation production code.

- [ ] **Step 6: Update view projection without furniture action enums**

For `AgentSummaryView.actionLabel`, resolve `interact_object` through the registered interaction `displayName`; use `"Interact"` only if a restored legacy action has no matching definition. In the web render projection, map `status === "interact_object"` to the existing `interact` animation.

- [ ] **Step 7: Verify and commit**

Run: `pnpm exec vitest run tests/scenarios/locked-door-recovery.test.ts packages/simulation/src/execution/path-planner.test.ts packages/simulation/src/execution/action-runner.test.ts packages/simulation/src/engine/snapshot-restorer.test.ts apps/web/src/features/world-map/render-projection.test.ts && pnpm --filter @god-sim/simulation typecheck`

Run: `rg -n 'tags\.includes\("door"\)|knownLockedDoorIds|locked_door|"(open|close|lock|unlock|use)_object"' packages/simulation/src apps/web/src -g '*.ts'`

Expected: tests pass. Any remaining `"use_object"` match is only the protocol-facing high-level Goal branch in `goal-planner.ts`; no match is an internal action kind or a furniture-specific rule. The other searched terms return no production match.

```bash
git add packages/simulation apps/web tests/scenarios/locked-door-recovery.test.ts
git commit -m "refactor: route traversal through plugin capabilities"
```

### Task 4: Event-First Perception, Knowledge, and Failure Memory

**Files:**
- Modify: `packages/simulation/src/map/map-loader.ts`
- Modify: `packages/simulation/src/perception/agent-knowledge.ts`
- Modify: `packages/simulation/src/perception/observable-state.ts`
- Modify: `packages/simulation/src/perception/visibility-system.ts`
- Replace: `packages/simulation/src/perception/immediate-memory.ts`
- Create: `packages/simulation/src/perception/perception-recorder.ts`
- Modify: `packages/simulation/src/engine/tick-pipeline.ts`
- Modify: `packages/simulation/src/engine/simulation-engine.ts`
- Modify: `packages/simulation/src/engine/snapshot-restorer.ts`
- Modify: `packages/simulation/src/testing/simulation-test-fixtures.ts`
- Test: `packages/simulation/src/map/map-loader.test.ts`
- Test: `packages/simulation/src/perception/visibility-system.test.ts`
- Test: `tests/scenarios/perceived-refrigerator-conflict.test.ts`
- Test: `tests/scenarios/locked-door-recovery.test.ts`
- Test: `tests/scenarios/starter-home-load.test.ts`
- Create: `tests/scenarios/causal-memory.test.ts`

**Interfaces:**
- `loadWorldDefinition` produces `{ world, initialPerceptions }`; the returned world starts with empty subjective knowledge and no fabricated Event IDs.
- `collectPerceptionCandidates` performs read-only visibility/observation work and returns candidates without Event identity.
- `recordPerceptionCandidates` appends `perception_recorded` Events first, then writes their IDs into knowledge and memory.
- Every new `action_failed` Event produces an interaction memory; automatic-traversal failure also produces a `KnownTraversalBlocker` from that same Event.

- [ ] **Step 1: Write failing causal-memory tests**

```ts
it("uses real startup events for every initial memory and known object", () => {
  const engine = starterEngine({ reviewRequired: true });
  const eventIds = new Set(engine.drainEvents().map((event) => event.eventId));
  const snapshotState = engine.createSnapshot().state as {
    agents: Array<{
      memories: Array<{ sourceEventId: string }>;
      knowledge: { objects: Array<{ sourceEventId: string }> };
    }>;
  };
  for (const agent of snapshotState.agents) {
    for (const memory of agent.memories) expect(eventIds.has(memory.sourceEventId)).toBe(true);
    for (const object of agent.knowledge.objects) {
      expect(eventIds.has(object.sourceEventId)).toBe(true);
    }
  }
});

it("remembers a failed interaction from its action_failed event", () => {
  const result = runRejectedTraversal();
  const failure = result.events.find((event) => event.type === "action_failed")!;
  expect(result.world.agents.get("alice" as never)?.memories).toContainEqual(
    expect.objectContaining({ sourceEventId: failure.eventId, observationKind: "interaction" }),
  );
});
```

- [ ] **Step 2: Run the causal-memory tests and verify red**

Run: `pnpm exec vitest run tests/scenarios/causal-memory.test.ts packages/simulation/src/map/map-loader.test.ts packages/simulation/src/perception/visibility-system.test.ts`

Expected: FAIL because initial and visual source IDs are currently synthesized before Events exist.

- [ ] **Step 3: Separate world loading from subjective initialization**

```ts
export type InitialPerceptionSeed =
  | {
      readonly kind: "memory";
      readonly agentId: AgentId;
      readonly memoryId: string;
      readonly summary: string;
    }
  | {
      readonly kind: "known_object";
      readonly agentId: AgentId;
      readonly entityId: EntityId;
      readonly displayName: string;
      readonly position: Coordinate;
      readonly summary: string;
    };

export interface LoadedWorldDefinition {
  readonly world: WorldState;
  readonly initialPerceptions: readonly InitialPerceptionSeed[];
}
```

The loader validates all references but initializes each agent with `createEmptyKnowledge(zoneId)` and `memories: []`. It returns deterministic seeds sorted by agent, seed kind, and entity/memory ID.

Update every direct loader caller in this task to use the explicit half it needs: simulation construction consumes both `loaded.world` and `loaded.initialPerceptions`; restoration uses `loaded.world` only as a map/plugin baseline; test helpers and route-planning scenarios use `loaded.world`. No caller silently drops initialization seeds on a production creation path.

- [ ] **Step 4: Record perception only after allocating its Event**

```ts
export interface PerceptionCandidate {
  readonly agentId: AgentId;
  readonly observationKind: ObservationKind;
  readonly summary: string;
  readonly relatedEntityId: EntityId | null;
  readonly subject:
    | { readonly kind: "memory"; readonly memoryId: string }
    | { readonly kind: "object"; readonly value: ObservedObjectValue }
    | { readonly kind: "agent"; readonly value: ObservedAgentValue };
}

export function recordPerceptionCandidates(
  worldInput: WorldState,
  candidates: readonly PerceptionCandidate[],
  metadata: (candidate: PerceptionCandidate) => EventMetadata,
): { readonly world: WorldState; readonly events: readonly DomainEvent[]; readonly changes: readonly KnowledgeChange[] };
```

For every candidate, call `appendDomainEvent` with `type: "perception_recorded"`; only then create `KnownObjectState`, `KnownAgentState`, or `ImmediateMemory` using `written.event.eventId`. Seeing another agent creates the same real Event path as seeing an object.

- [ ] **Step 5: Make visual scans read-only and stable**

`collectPerceptionCandidates` compares plugin `observe(...)` output with prior knowledge and emits no candidate when status, summary, observable details, and position are unchanged. If a visible object has a remembered traversal blocker, remove it only when that object produces a new visible-change candidate; a hidden authoritative version change leaves the blocker intact.

- [ ] **Step 6: Record action failure before recovery**

In `runTickPipeline`, replace the current failure loop with this order:

```ts
const recorded = recordActionFailures(world, failures);
world = recorded.world;
events.push(...recorded.events);

const perception = refreshAllPerceptions(world, registry);
world = perception.world;
events.push(...perception.events);

const recovery = recoverFailures(world, registry, recorded.failures);
```

`recordActionFailures` writes `summary` and optional `entityId`, appends one interaction memory using the Event ID, and creates a traversal blocker with the current object version only when `failure.purpose === "automatic_traversal"`.

Keep the existing body-threshold order unchanged: append `agent_need_changed` first, then form the body memory from that Event ID. Add an assertion in `causal-memory.test.ts` that an urgent-bladder memory resolves to its `agent_need_changed` Event.

- [ ] **Step 7: Verify and commit**

Run: `pnpm exec vitest run tests/scenarios/causal-memory.test.ts tests/scenarios/perceived-refrigerator-conflict.test.ts tests/scenarios/locked-door-recovery.test.ts tests/scenarios/starter-home-load.test.ts packages/simulation/src/map/map-loader.test.ts packages/simulation/src/perception/visibility-system.test.ts && pnpm --filter @god-sim/simulation test && pnpm --filter @god-sim/simulation typecheck`

Run: `rg -n 'event:initial|event:initial-knowledge|event:observation' packages/simulation/src -g '*.ts'`

Expected: tests pass and the search returns no fabricated source Event IDs.

```bash
git add packages/simulation tests/scenarios
git commit -m "feat: derive subjective memory from real events"
```

### Task 5: Strict Causal Snapshots with Legacy Restoration

**Files:**
- Modify: `packages/simulation/src/world/world-state.ts`
- Modify: `packages/simulation/src/engine/snapshot-projector.ts`
- Modify: `packages/simulation/src/engine/snapshot-restorer.ts`
- Create: `packages/simulation/src/engine/snapshot-causality.ts`
- Modify: `packages/simulation/src/engine/snapshot-restorer.test.ts`
- Create: `packages/simulation/src/engine/snapshot-causality.test.ts`
- Modify: `packages/simulation/src/index.ts`

**Interfaces:**
- `WorldState.history` is `{ mode: "strict"; causalFromSequence: 1 }` for new worlds and `{ mode: "legacy"; causalFromSequence: number }` after loading version 1.
- `projectWorldSnapshot` always writes version 2 and a sorted unique `causalEventIds` list.
- `restoreWorldSnapshot` accepts both versions, maps legacy action/knowledge fields into current in-memory types, and never claims old fabricated references are strict.
- `assertSnapshotCausality(snapshot)` verifies deterministic reference format and range before IPC emission.

- [ ] **Step 1: Write failing strict and legacy restoration tests**

```ts
it("projects every strict subjective source into causalEventIds", () => {
  const snapshot = engine.createSnapshot();
  expect(snapshot.schemaVersion).toBe(2);
  if (snapshot.schemaVersion !== 2) return;
  expect(snapshot.history).toEqual({ mode: "strict", causalFromSequence: 1 });
  expect(new Set(snapshot.causalEventIds)).toEqual(allSubjectiveSourceIds(snapshot.state));
});

it("restores a v1 locked-door snapshot as legacy generic traversal knowledge", () => {
  const restored = restoreSimulation({ snapshot: legacySnapshot(), worldDefinition, plugins });
  const next = restored.createSnapshot();
  expect(next).toMatchObject({
    schemaVersion: 2,
    history: { mode: "legacy", causalFromSequence: legacySnapshot().lastEventSequence + 1 },
  });
});
```

- [ ] **Step 2: Run snapshot tests and verify red**

Run: `pnpm exec vitest run packages/simulation/src/engine/snapshot-restorer.test.ts packages/simulation/src/engine/snapshot-causality.test.ts`

Expected: FAIL because only version 1 is projected and legacy action kinds are still the current schema.

- [ ] **Step 3: Add history identity to the authoritative state**

```ts
export type WorldHistory =
  | { readonly mode: "strict"; readonly causalFromSequence: 1 }
  | { readonly mode: "legacy"; readonly causalFromSequence: number };

export interface WorldState {
  // Existing fields remain unchanged.
  readonly history: WorldHistory;
}
```

Newly loaded worlds use strict history. Version-1 restoration uses `causalFromSequence = snapshot.lastEventSequence + 1`. Version-2 restoration copies and validates the stored history descriptor.

- [ ] **Step 4: Project a version-2 causal envelope**

Collect source IDs from known objects, known agents, memories, and traversal blockers. For strict history, include every source ID. For legacy history, include only deterministic IDs whose sequence is at least `causalFromSequence`. Sort by parsed Event sequence and then ID.

```ts
return WorldSnapshotV2Schema.parse({
  schemaVersion: 2,
  worldId: world.id,
  worldVersion: world.version,
  worldTick: world.tick,
  lastEventSequence: world.lastEventSequence,
  pluginLockHash: world.pluginLockHash,
  history: world.history,
  causalEventIds,
  state: serializeWorldState(world),
});
```

- [ ] **Step 5: Restore current and legacy state without leaking legacy types**

Use separate Zod schemas for legacy and current serialized actions/knowledge. Map old object actions as follows:

```ts
const legacyPurpose = action.kind === "open_object"
  ? "automatic_traversal"
  : "goal";
return {
  ...action,
  kind: "interact_object" as const,
  purpose: legacyPurpose,
};
```

Map each old `knownLockedDoorIds` entry to a `KnownTraversalBlocker` with `reasonCode: "legacy_locked_door"`, the restored object version, and a legacy-only source ID. These IDs are excluded from `causalEventIds` by the legacy history boundary.

- [ ] **Step 6: Enforce causal consistency before persistence**

`assertSnapshotCausality` checks uniqueness; each `causalEventId` must equal `event:${snapshot.worldId}:${positiveSequence}`; each sequence must be between `history.causalFromSequence` and `lastEventSequence`; strict snapshots must list all subjective source IDs. Throw an explicit error naming the invalid agent/reference.

- [ ] **Step 7: Verify and commit**

Run: `pnpm exec vitest run packages/simulation/src/engine/snapshot-restorer.test.ts packages/simulation/src/engine/snapshot-causality.test.ts && pnpm --filter @god-sim/simulation typecheck`

```bash
git add packages/simulation
git commit -m "feat: write causally verifiable snapshots"
```

### Task 6: Atomic Timeline Store, Additive Migration, and Model Identity

**Files:**
- Modify: `packages/timeline/src/timeline-store.ts`
- Modify: `packages/timeline/src/model-call-record.ts`
- Modify: `packages/timeline/src/index.ts`
- Modify: `packages/sqlite-store/src/database-schema.ts`
- Create: `packages/sqlite-store/src/migrations/002-architecture-hardening.ts`
- Modify: `packages/sqlite-store/src/sqlite-timeline-store.ts`
- Modify: `packages/sqlite-store/src/sqlite-timeline-store.test.ts`
- Test: `packages/sqlite-store/src/migrations/002-architecture-hardening.test.ts`

**Interfaces:**
- Produces `WorldCheckpoint` and `TimelineStore.commitCheckpoint(checkpoint)`. The split methods remain deprecated compatibility members until application callers migrate in Task 8.
- `ModelCallRecord` requires `protocolSchemaVersion`, `decisionCycleId`, `pluginLockHash`, and `decisionReasonCode`.
- Migration 002 adds nullable columns for legacy rows and a nullable `checkpoint_id` on old Snapshot rows.
- `commitCheckpoint` is idempotent for identical input and rejects any same-identity content conflict.

- [ ] **Step 1: Replace store tests with atomic-checkpoint behavior**

```ts
it("rolls back events when snapshot insertion fails", async () => {
  const store = await createSqliteTimelineStore({
    filename: ":memory:",
    checkpointFailpoint(phase) {
      if (phase === "after_events_before_snapshot") throw new Error("snapshot unavailable");
    },
  });
  await expect(store.commitCheckpoint(checkpointAt(2))).rejects.toThrow("snapshot unavailable");
  await expect(store.loadLatest("starter-world" as never)).resolves.toEqual({
    snapshot: null,
    events: [],
  });
});

it("accepts an exact checkpoint replay and rejects changed payload", async () => {
  const checkpoint = checkpointAt(2);
  await store.commitCheckpoint(checkpoint);
  await store.commitCheckpoint(checkpoint);
  await expect(store.commitCheckpoint(conflictingCheckpoint(checkpoint))).rejects
    .toThrow(/checkpoint|history conflict/i);
});
```

- [ ] **Step 2: Run SQLite tests and verify red**

Run: `pnpm exec vitest run packages/sqlite-store/src/sqlite-timeline-store.test.ts packages/sqlite-store/src/migrations/002-architecture-hardening.test.ts`

Expected: FAIL because `commitCheckpoint`, migration 002, and model identity columns do not exist.

- [ ] **Step 3: Narrow the timeline interface**

```ts
export interface WorldCheckpoint {
  readonly checkpointId: CheckpointId;
  readonly events: readonly DomainEvent[];
  readonly snapshot: WorldSnapshotV2;
}

export interface TimelineStore {
  commitCheckpoint(checkpoint: WorldCheckpoint): Promise<void>;
  /** @deprecated New world history must use commitCheckpoint. Removed in Task 8. */
  appendEvents(events: readonly DomainEvent[]): Promise<void>;
  /** @deprecated New world history must use commitCheckpoint. Removed in Task 8. */
  saveSnapshot(snapshot: WorldSnapshot): Promise<void>;
  savePluginLock(record: PluginLockRecord): Promise<void>;
  saveModelCall(record: ModelCallRecord): Promise<void>;
  recordFailure(worldId: WorldId, failure: TechnicalFailure): Promise<void>;
  loadLatest(worldId: WorldId): Promise<RestoredTimeline>;
  close(): Promise<void>;
}
```

Update `ModelCallRecord` with the four required causal identity fields and keep full prompt/request bodies absent.

- [ ] **Step 4: Add the non-destructive migration**

Use `db.introspection.getTables()` to inspect existing columns before each `alterTable(...).addColumn(...)`. Add:

```text
snapshots.checkpoint_id TEXT NULL
model_calls.protocol_schema_version INTEGER NULL
model_calls.decision_cycle_id TEXT NULL
model_calls.plugin_lock_hash TEXT NULL
model_calls.decision_reason_code TEXT NULL
```

Create a unique index on `snapshots(checkpoint_id)`; SQLite permits multiple legacy `NULL` values. Run migration 001 then 002 on every store open. The migration test creates a version-001 database with old rows, opens the new store twice, and verifies all old payload JSON remains byte-for-byte unchanged.

- [ ] **Step 5: Implement one checkpoint transaction**

Inside one Kysely transaction:

1. Parse the checkpoint and confirm every Event uses the Snapshot world ID.
2. Confirm input Event order, sequence, and parent sequence are continuous.
3. Compare existing rows for exact idempotent replay or require the new batch to begin at the durable tail plus one.
4. Insert/compare Events.
5. Invoke the optional test failpoint `after_events_before_snapshot`.
6. Insert/compare the Snapshot by `checkpoint_id` and world version.
7. Verify database max Event sequence equals `snapshot.lastEventSequence`.
8. Verify every `snapshot.causalEventIds` value exists in the same world's Event rows.

Any mismatch throws before commit. Do not use `INSERT OR REPLACE`.

- [ ] **Step 6: Persist the new model columns**

Add all four values to inserts and exact-replay comparison. Old rows remain nullable in `DatabaseSchema`; new `ModelCallRecord` callers always supply non-null values.

- [ ] **Step 7: Verify and commit**

Run: `pnpm exec vitest run packages/sqlite-store/src/sqlite-timeline-store.test.ts packages/sqlite-store/src/migrations/002-architecture-hardening.test.ts && pnpm --filter @god-sim/timeline typecheck && pnpm --filter @god-sim/sqlite-store typecheck`

```bash
git add packages/timeline packages/sqlite-store
git commit -m "feat: commit world checkpoints atomically"
```

### Task 7: Simulation Checkpoint Preparation

**Files:**
- Modify: `packages/simulation/src/engine/simulation-engine.ts`
- Create: `packages/simulation/src/engine/simulation-checkpoint.test.ts`

**Interfaces:**
- `SimulationEngine.prepareCheckpoint()` returns a stable `SimulationCheckpoint` without discarding Events.
- `SimulationEngine.acknowledgeCheckpoint(checkpointId)` clears exactly the prepared Event prefix.
- The legacy `drainEvents()` method remains available only until Worker migration in Task 8, keeping this engine-only commit buildable.

- [ ] **Step 1: Write failing engine checkpoint tests**

```ts
it("keeps events until the matching checkpoint is acknowledged", () => {
  const engine = starterEngine({ reviewRequired: true });
  const first = engine.prepareCheckpoint();
  expect(engine.prepareCheckpoint()).toEqual(first);
  expect(engine.acknowledgeCheckpoint("checkpoint:wrong" as never).accepted).toBe(false);
  expect(engine.prepareCheckpoint()).toEqual(first);
  expect(engine.acknowledgeCheckpoint(first.checkpointId).accepted).toBe(true);
});
```

- [ ] **Step 2: Run engine and worker tests and verify red**

Run: `pnpm exec vitest run packages/simulation/src/engine/simulation-checkpoint.test.ts`

Expected: FAIL because the engine cannot yet prepare or acknowledge a stable checkpoint.

- [ ] **Step 3: Implement stable checkpoint preparation in the engine**

```ts
export interface SimulationCheckpoint {
  readonly checkpointId: CheckpointId;
  readonly events: readonly DomainEvent[];
  readonly snapshot: WorldSnapshotV2;
}

prepareCheckpoint(): SimulationCheckpoint;
acknowledgeCheckpoint(checkpointId: CheckpointId): BufferResult;
```

Cache one prepared checkpoint. Its ID is `checkpoint:${worldId}:${worldVersion}:${lastEventSequence}`. `prepareCheckpoint` calls `assertSnapshotCausality`; `acknowledgeCheckpoint` accepts only the cached ID, removes only the captured Event count, and clears the cache. Keep `drainEvents()` as a deprecated wrapper during this task; Task 8 removes it after the Worker no longer calls it.

- [ ] **Step 4: Verify and commit**

Run: `pnpm exec vitest run packages/simulation/src/engine/simulation-checkpoint.test.ts && pnpm --filter @god-sim/simulation test && pnpm --filter @god-sim/simulation typecheck`

```bash
git add packages/simulation
git commit -m "feat: prepare stable simulation checkpoints"
```

### Task 8: Worker Barrier, Local Single-Writer Coordination, and Decision Metadata

**Files:**
- Modify: `packages/simulation/src/engine/simulation-engine.ts`
- Modify: `tests/scenarios/causal-memory.test.ts`
- Modify: `apps/simulation-worker/src/runtime/world-session.ts`
- Modify: `apps/simulation-worker/src/runtime/world-session.test.ts`
- Modify: `apps/simulation-worker/src/ipc/worker-message-handler.ts`
- Modify: `apps/simulation-worker/src/ipc/worker-message-handler.test.ts`
- Modify: `apps/simulation-worker/src/bootstrap/start-simulation-worker.ts`
- Modify: `apps/simulation-worker/src/bootstrap/start-simulation-worker.test.ts`
- Modify: `apps/local-server/src/persistence/persistence-writer.ts`
- Modify: `apps/local-server/src/persistence/persistence-writer.test.ts`
- Modify: `apps/local-server/src/decisions/decision-request-coordinator.ts`
- Modify: `apps/local-server/src/decisions/decision-request-coordinator.test.ts`
- Modify: `apps/local-server/src/sessions/session-coordinator.ts`
- Modify: `apps/local-server/src/sessions/session-coordinator.test.ts`
- Modify: `apps/local-server/src/sessions/worker-supervisor.ts`
- Modify: `apps/local-server/src/bootstrap/start-local-server.ts`
- Test: `tests/integration/local-process-loop.test.ts`
- Test: `tests/integration/local-server-restart.test.ts`
- Test: `tests/integration/worker-failure.test.ts`

**Interfaces:**
- `PersistenceWriter.commitCheckpoint(checkpoint)` queues the whole immutable checkpoint as one retry unit.
- `WorldSession` suppresses model requests, running ticks, and final shutdown until checkpoint acknowledgement.
- `SessionCoordinator` acknowledges only a successful commit and retains the failed checkpoint ID until explicit retry.
- `DecisionRequestCoordinator` copies all causal identity fields from `ModelDecisionRequest` into every model-call record.
- Startup restores only the latest complete Snapshot; any Event tail after it remains an explicit legacy-history error.

- [ ] **Step 1: Write failing writer and coordinator tests**

```ts
it("retries a failed checkpoint as one unchanged operation", async () => {
  await expect(writer.commitCheckpoint(checkpointAt(4))).rejects.toThrow("disk unavailable");
  diskAvailable = true;
  await writer.retryFailed();
  expect(attempts).toEqual([checkpointAt(4), checkpointAt(4)]);
});

it("does not start model work before the thinking checkpoint is acknowledged", async () => {
  worker.emit(checkpointReady(initialCheckpoint()));
  await vi.waitFor(() => expect(store.commitCheckpoint).toHaveBeenCalledOnce());
  expect(provider.decide).not.toHaveBeenCalled();
  worker.emit(decisionRequested(aliceRequest()));
  await vi.waitFor(() => expect(provider.decide).toHaveBeenCalledOnce());
});
```

Add a release test that holds `commitCheckpoint` unresolved and asserts the worker receives no acknowledgement and the latest world tick remains unchanged.

- [ ] **Step 2: Run local-server tests and verify red**

Run: `pnpm exec vitest run apps/simulation-worker/src/runtime/world-session.test.ts apps/simulation-worker/src/ipc/worker-message-handler.test.ts apps/local-server/src/persistence/persistence-writer.test.ts apps/local-server/src/decisions/decision-request-coordinator.test.ts apps/local-server/src/sessions/session-coordinator.test.ts`

Expected: FAIL because the Worker has no acknowledgement barrier, the writer still queues Events and Snapshots separately, and the coordinator requests Snapshots after views.

- [ ] **Step 3: Put semantic boundaries behind the Worker barrier**

`WorldSession` emits `checkpoint_ready` at these exact boundaries:

- initial or new `THINKING`, before publishing `decision_requested` messages;
- transition to `RUNNING`, before another tick;
- non-persistence `TECHNICALLY_BLOCKED` when serializable;
- normal shutdown when the latest state is not already durable.

Keep `#pendingCheckpoint` and `#lastCommittedCheckpointId`. While pending, `tick()` returns without advancing. On matching `checkpoint_committed`, acknowledge the engine, then publish pending model requests, allow running ticks, or invoke the deferred shutdown callback.

When `WorldSession.block(failure)` receives `category: "persistence"` with a pending checkpoint, update the technical-failure state and View but do not prepare a second checkpoint. `WorkerMessageHandler` defers `#onShutdown` until the final acknowledgement, and process startup still flushes all IPC sends before disconnecting.

Remove `SimulationEngine.drainEvents()` and update `causal-memory.test.ts` to read `prepareCheckpoint().events`.

- [ ] **Step 4: Replace split persistence operations**

Expose `commitCheckpoint`, `savePluginLock`, `saveModelCall`, and `recordFailure`. Remove `appendEvents` and `saveSnapshot` from `PersistenceWriter`, `TimelineStore`, and `SqliteTimelineStore` now that all application callers migrate in this task. Keep the existing serialized Promise tail and blocked retry queue; one checkpoint closure is one queue item, so retry cannot split its payload.

- [ ] **Step 5: Coordinate checkpoint acknowledgement and retry**

On `checkpoint_ready`:

```ts
try {
  await this.#persistence.commitCheckpoint(message);
  await this.#worker.send({
    type: "checkpoint_committed",
    checkpointId: message.checkpointId,
  });
} catch (error) {
  this.#failedCheckpointId = message.checkpointId;
  throw error;
}
```

Remove `#snapshotKeys` and `#requestFreezeSnapshot`. During explicit persistence retry, call `retryFailed()`, acknowledge `#failedCheckpointId`, clear it, then send the existing `retry_technical_failure` command. If acknowledgement fails, publish a non-retryable worker failure rather than pretending the checkpoint is durable.

- [ ] **Step 6: Persist complete model-call identity**

Supply these exact fields in both success and failure records:

```ts
protocolSchemaVersion: request.schemaVersion,
decisionCycleId: request.decisionCycleId,
pluginLockHash: request.pluginLockHash,
decisionReasonCode: request.decisionReason.code,
```

Keep `requestId`, `retryOfRequestId`, selected goal, reason, model ID, latency, and real timestamp. Do not add prompt messages or authorization data.

When the Worker emits `decision_rejected`, retain the already-written gateway-accepted model row and write the existing structured protocol failure diagnostic keyed by the same `requestId`. Add a test proving the row is not rewritten to imply world adoption; only a later `decision_accepted` Domain Event proves adoption.

- [ ] **Step 7: Update process integration and shutdown**

`ProcessWorkerSupervisor.stop()` sends `shutdown` and waits for the child to disconnect after its final checkpoint acknowledgement path. `SessionCoordinator.stop()` waits for decision tasks, asks the worker to stop, handles the resulting checkpoint, waits for persistence idle, then closes the store. Verify a normal running shutdown restores to the exact final Snapshot and leaves zero Event tail.

- [ ] **Step 8: Verify and commit**

Run: `pnpm exec vitest run apps/simulation-worker/src/runtime/world-session.test.ts apps/simulation-worker/src/ipc/worker-message-handler.test.ts apps/simulation-worker/src/bootstrap/start-simulation-worker.test.ts apps/local-server/src/persistence/persistence-writer.test.ts apps/local-server/src/decisions/decision-request-coordinator.test.ts apps/local-server/src/sessions/session-coordinator.test.ts tests/integration/local-process-loop.test.ts tests/integration/local-server-restart.test.ts tests/integration/worker-failure.test.ts`

```bash
git add packages/simulation packages/timeline packages/sqlite-store apps/simulation-worker apps/local-server tests/scenarios/causal-memory.test.ts tests/integration
git commit -m "feat: coordinate atomic world persistence"
```

### Task 9: Dependency Enforcement, Full Causal Audit, and Milestone Regression

**Files:**
- Modify: `.dependency-cruiser.cjs`
- Modify: `tests/architecture/dependency-boundaries.test.ts`
- Modify: `tests/scenarios/basic-loop.test.ts`
- Modify: `tests/scenarios/bladder-toilet-loop.test.ts`
- Modify: `tests/scenarios/pause-preserves-actions.test.ts`
- Modify: `tests/scenarios/perceived-refrigerator-conflict.test.ts`
- Modify: `tests/scenarios/technical-failure-retry.test.ts`
- Modify: `tests/e2e/basic-loop.spec.ts`
- Modify: `tests/e2e/bladder-toilet.spec.ts`
- Modify: `tests/e2e/review-mode.spec.ts`
- Modify: `tests/e2e/technical-retry.spec.ts`
- Create: `scripts/audit-world-history.mjs`
- Create: `tests/integration/history-audit.test.ts`
- Modify: `package.json`

**Interfaces:**
- Dependency Cruiser enforces the exact allow-list from design section 9 for both source paths and `@god-sim/*` aliases.
- `pnpm audit:history -- <database-file>` reports SQLite integrity, checkpoint/Event tail agreement, and missing causal Event IDs without printing model prompts or secrets.
- Headless, process, browser, and real-model paths all use the same checkpoint architecture.

- [ ] **Step 1: Strengthen the failing architecture test**

Represent the allowed production dependencies exactly:

```ts
const allowed = {
  "@god-sim/protocol": [],
  "@god-sim/plugin-sdk": ["@god-sim/protocol"],
  "@god-sim/simulation": ["@god-sim/plugin-sdk", "@god-sim/protocol"],
  "@god-sim/cognition": ["@god-sim/plugin-sdk", "@god-sim/protocol"],
  "@god-sim/timeline": ["@god-sim/protocol"],
  "@god-sim/model-gateway": ["@god-sim/protocol"],
  "@god-sim/sqlite-store": ["@god-sim/protocol", "@god-sim/timeline"],
} as const;

for (const [name, expected] of Object.entries(allowed)) {
  expect(workspaceDependencies(manifestFor(name)).sort()).toEqual([...expected].sort());
}
```

Also assert the three app dependency sets and that plugin production dependencies contain only protocol and plugin-sdk.

- [ ] **Step 2: Run architecture checks and verify red**

Run: `pnpm exec vitest run tests/architecture/dependency-boundaries.test.ts && pnpm exec depcruise apps packages plugins --config .dependency-cruiser.cjs --output-type err`

Expected: at least the incomplete allow-list configuration is exposed before the rules are expanded.

- [ ] **Step 3: Encode the complete forbidden-import matrix**

For each workspace source root, add one rule whose `to.path` matches every disallowed workspace path and package alias. Retain `no-circular`, `packages-do-not-import-apps`, and `no-workspace-deep-imports`. Exclude test files only from the official-plugin composition restriction; production `packages/simulation/src` must never import `@god-sim/spatial-objects`, `home-objects`, or `starter-agents`.

- [ ] **Step 4: Add an executable history audit**

The script opens the supplied SQLite file read-only and exits nonzero unless:

```text
PRAGMA integrity_check = ok
latest version-2 Snapshot last_event_sequence = MAX(events.sequence)
every ID in latest Snapshot causalEventIds exists in events for that world
no duplicate world/sequence or event_id rows exist
```

Emit counts and IDs only. Add `"audit:history": "node scripts/audit-world-history.mjs"` to root scripts. The integration test builds a valid temporary database through `TimelineStore`, confirms exit 0, deletes one causal Event through a raw test connection, and confirms exit nonzero with `missing causal event`.

- [ ] **Step 5: Run all deterministic regression layers**

Run: `pnpm lint`

Run: `pnpm typecheck`

Run: `pnpm test`

Run: `pnpm build`

Run: `pnpm test:e2e`

Expected: every command exits 0. Scenario coverage must still prove automatic passage, alternate-route recovery, no hidden occupancy knowledge, perception-triggered replanning, urgent-bladder toilet completion, preserved peer progress, review gating, and explicit technical retry.

- [ ] **Step 6: Run the browser and real-model acceptance audit**

Start a new database with the local free-model configuration. Capture the tick immediately before the real request and immediately after the result; they must be equal. Release one accepted goal, run until the next semantic boundary, stop normally, then run:

```bash
pnpm audit:history -- data/god-simulation-architecture-smoke-20260831.sqlite
```

Expected: integrity `ok`, Event tail equals Snapshot tail, and missing causal Event count is `0`. Do not print or commit the key, prompt bodies, authorization header, generated database, WAL files, or logs.

- [ ] **Step 7: Commit the final regression layer**

```bash
git add .dependency-cruiser.cjs package.json scripts/audit-world-history.mjs tests
git commit -m "test: enforce hardened milestone architecture"
```

## Completion Gate

The architecture hardening is complete only when all nine task commits exist, every listed focused test and full root verification command passes, the new real-model database passes the causal audit with zero missing references, and production searches prove the simulation core contains no furniture tag/private-field/action-enum decisions. Version-1 development data must still parse as legacy; any original Event tail after its Snapshot remains an explicit startup error rather than being deleted or guessed.
