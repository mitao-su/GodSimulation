import type {
  AgentId,
  ContinuousVisualState,
  MovementTrajectory,
  NearbyObservation,
  PerceptionNow,
  SoundPropagationInput,
  SoundPropagationResult,
} from "@god-sim/protocol";

/** W2 实现轨消费的窄接口；不暴露 WorldState 或插件私有外观。 */
export interface L2PerceptionPort {
  projectNow(agentId: AgentId): PerceptionNow;
  projectContinuous(agentId: AgentId): ContinuousVisualState;
  collectTrajectoryObservations(
    agentId: AgentId,
    trajectory: MovementTrajectory,
  ): readonly NearbyObservation[];
}

export interface L2AuditionPort {
  propagateSound(input: SoundPropagationInput): SoundPropagationResult;
}
