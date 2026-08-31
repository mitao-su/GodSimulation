import {
  GoalOptionSchema,
  type AgentId,
  type EntityId,
  type GoalOption,
} from "@god-sim/protocol";

import type { PluginRegistry } from "../world/plugin-registry";
import type { AgentState, WorldState } from "../world/world-state";

function occupiedByKnownOther(agent: AgentState, entityId: EntityId): boolean {
  const known = agent.knowledge.objects.get(entityId)?.observable;
  if (typeof known !== "object" || known === null || Array.isArray(known)) return false;
  const occupant = "occupiedBy" in known ? known.occupiedBy : null;
  return typeof occupant === "string" && occupant !== agent.id;
}

export function buildGoalOptions(
  world: WorldState,
  registry: PluginRegistry,
  agentId: AgentId,
): readonly GoalOption[] {
  const agent = world.agents.get(agentId);
  if (!agent) throw new Error(`Unknown agent instance: ${agentId}`);

  const options: GoalOption[] = [
    GoalOptionSchema.parse({
      id: `goal-option:${agentId}:wait`,
      label: "Wait",
      goal: { kind: "wait", durationTicks: 600 },
    }),
  ];

  for (const knownObject of [...agent.knowledge.objects.values()].sort((left, right) =>
    left.entityId.localeCompare(right.entityId),
  )) {
    const object = world.objects.get(knownObject.entityId);
    if (!object) continue;
    const definition = registry.getObject(object.definitionId)?.definition;
    if (!definition || definition.interactions.length === 0) continue;
    options.push(
      GoalOptionSchema.parse({
        id: `goal-option:${agentId}:${object.id}:observe`,
        label: `Observe ${definition.displayName}`,
        goal: { kind: "observe", targetEntityId: object.id },
      }),
    );
    if (occupiedByKnownOther(agent, object.id)) continue;
    for (const interaction of definition.interactions) {
      if (interaction.trigger !== "active_command") continue;
      options.push(
        GoalOptionSchema.parse({
          id: `goal-option:${agentId}:${object.id}:${interaction.id}`,
          label: interaction.displayName,
          goal: {
            kind: "use_object",
            targetEntityId: object.id,
            interactionId: interaction.id,
          },
        }),
      );
    }
  }

  return options;
}
