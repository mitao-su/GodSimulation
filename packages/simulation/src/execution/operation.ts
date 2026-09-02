import type {
  Coordinate,
  EntityId,
  JsonObject,
  OperationCallId,
  OperationDuration,
  OperationId,
  TaskOptionId,
  TaskTrack,
} from "@god-sim/protocol";

interface OperationActionBase {
  readonly id: string;
  readonly durationTicks: number;
  readonly progressTicks: number;
}

export interface OperationMoveAction extends OperationActionBase {
  readonly kind: "move";
  readonly path: readonly Coordinate[];
}

export type OperationInteractionPurpose = "direct" | "automatic_traversal";

export interface OperationObjectInteractionAction extends OperationActionBase {
  readonly kind: "interact_object";
  readonly purpose: OperationInteractionPurpose;
  readonly targetEntityId: EntityId;
  readonly interactionId: string;
  readonly started: boolean;
}

export interface OperationWaitAction extends OperationActionBase {
  readonly kind: "wait";
}

export interface OperationObserveAction extends OperationActionBase {
  readonly kind: "observe";
  readonly targetEntityId: EntityId;
}

export type OperationAction =
  | OperationMoveAction
  | OperationObjectInteractionAction
  | OperationWaitAction
  | OperationObserveAction;

export interface OperationPlan {
  readonly actions: readonly OperationAction[];
  readonly currentActionIndex: number;
}

export interface OperationObservation {
  readonly entityId: EntityId;
  readonly kind: "object" | "agent";
  readonly summary: string;
}

export interface ActiveOperation {
  readonly callId: OperationCallId;
  readonly operationId: OperationId;
  readonly taskOptionId: TaskOptionId;
  readonly label: string;
  readonly taskSlots: readonly TaskTrack[];
  readonly arguments: JsonObject;
  readonly duration: OperationDuration;
  readonly startedAtTick: number;
  readonly progressTicks: number;
  readonly accumulatedObservations: readonly OperationObservation[];
  readonly observationDeliveryCursor: number;
  readonly plan: OperationPlan;
}
