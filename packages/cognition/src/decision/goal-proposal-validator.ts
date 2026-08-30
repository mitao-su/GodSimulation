import {
  GoalOptionSchema,
  GoalProposalSchema,
  type Goal,
  type GoalOption,
  type GoalProposal,
} from "@god-sim/protocol";

export function resolveGoalProposal(
  proposalValue: GoalProposal,
  offeredGoalValues: readonly GoalOption[],
): Goal {
  const proposal = GoalProposalSchema.parse(proposalValue);
  const offeredGoals = offeredGoalValues.map((option) => GoalOptionSchema.parse(option));
  const duplicateIds = offeredGoals.filter(
    (option, index) => offeredGoals.findIndex((candidate) => candidate.id === option.id) !== index,
  );
  if (duplicateIds.length > 0) throw new Error(`Duplicate offered goal ID ${duplicateIds[0]!.id}`);
  const original = offeredGoalValues.find((option) => option.id === proposal.goalOptionId);
  if (!original) throw new Error(`Goal option ${proposal.goalOptionId} was not offered`);
  return original.goal;
}

