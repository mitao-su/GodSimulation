import type { BodySlot } from "@god-sim/plugin-sdk";

export type BodySlotReservations = Readonly<Record<BodySlot, string | null>>;

export function createEmptyBodySlots(): BodySlotReservations {
  return { HEAD: null, HANDS: null, BODY: null };
}

export type SlotReservationResult =
  | { readonly accepted: true; readonly slots: BodySlotReservations }
  | { readonly accepted: false; readonly occupiedSlots: readonly BodySlot[] };

export function reserveBodySlots(
  current: BodySlotReservations,
  actionId: string,
  requested: readonly BodySlot[],
): SlotReservationResult {
  const occupiedSlots = requested.filter(
    (slot) => current[slot] !== null && current[slot] !== actionId,
  );
  if (occupiedSlots.length > 0) return { accepted: false, occupiedSlots };

  const next = { ...current };
  for (const slot of requested) next[slot] = actionId;
  return { accepted: true, slots: next };
}

export function releaseBodySlots(
  current: BodySlotReservations,
  actionId: string,
): BodySlotReservations {
  return {
    HEAD: current.HEAD === actionId ? null : current.HEAD,
    HANDS: current.HANDS === actionId ? null : current.HANDS,
    BODY: current.BODY === actionId ? null : current.BODY,
  };
}
