import {
  AppearanceDescriptionSchema,
  BodyFactsSchema,
  CharacterAppearanceStateSchema,
  ExternallyVisibleAppearanceSchema,
  type BodyFacts,
  type CharacterAppearanceState,
  type ExternallyVisibleAppearance,
} from "@god-sim/protocol";

export interface AppearanceStateDefinition {
  readonly bodyFacts: BodyFacts;
  readonly appearance: CharacterAppearanceState;
}

export function assertAppearanceState(value: AppearanceStateDefinition): void {
  BodyFactsSchema.parse(value.bodyFacts);
  CharacterAppearanceStateSchema.parse(value.appearance);
  AppearanceDescriptionSchema.parse(value.appearance.description);
}

export function projectExternallyVisibleAppearance(
  value: AppearanceStateDefinition,
): ExternallyVisibleAppearance {
  const appearance = CharacterAppearanceStateSchema.parse(value.appearance);
  return ExternallyVisibleAppearanceSchema.parse(appearance.description.externallyVisible);
}
