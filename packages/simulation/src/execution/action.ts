import type { Coordinate, EntityId, Goal } from "@god-sim/protocol";
import type { BodySlot } from "@god-sim/plugin-sdk";

interface ActionBase {
  readonly id: string;
  readonly goalId: string;
  readonly durationTicks: number;
  readonly progressTicks: number;
  readonly slots: readonly BodySlot[];
}

export interface MoveAction extends ActionBase {
  readonly kind: "move";
  readonly path: readonly Coordinate[];
}

export type ObjectInteractionPurpose = "goal" | "automatic_traversal";

export interface ObjectInteractionAction extends ActionBase {
  readonly kind: "interact_object";
  readonly purpose: ObjectInteractionPurpose;
  readonly targetEntityId: EntityId;
  readonly interactionId: string;
  readonly started: boolean;
}

export interface WaitAction extends ActionBase {
  readonly kind: "wait";
}

export interface ObserveAction extends ActionBase {
  readonly kind: "observe";
  readonly targetEntityId: EntityId;
}

export type RunningAction =
  | MoveAction
  | ObjectInteractionAction
  | WaitAction
  | ObserveAction;

export interface ActiveGoal {
  readonly id: string;
  readonly goal: Goal;
  readonly label: string;
}

export interface ActionPlan {
  readonly goalId: string;
  readonly goal: Goal;
  readonly actions: readonly RunningAction[];
  readonly currentActionIndex: number;
}

export interface ActionFailure {
  readonly code: string;
  readonly actionId: string;
  readonly entityId?: EntityId;
  readonly purpose?: ObjectInteractionPurpose;
  readonly summary: string;
}
