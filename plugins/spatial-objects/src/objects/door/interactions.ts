import type {
  InteractionAvailability,
  InteractionDefinition,
} from "@god-sim/plugin-sdk";

import type { DoorState } from "./state";

const available: InteractionAvailability = { available: true };

function unavailable(reasonCode: string, summary: string): InteractionAvailability {
  return { available: false, reasonCode, summary };
}

export const doorOpenInteraction: InteractionDefinition<DoorState> = {
  id: "open",
  displayName: "Open",
  trigger: "active_command",
  durationTicks: 3,
  slots: ["HANDS"],
  canStart(state) {
    if (state.open) return unavailable("already_open", "The door is already open");
    if (state.locked) return unavailable("locked", "The door is locked");
    return available;
  },
  complete(state, context) {
    return {
      effects: [
        {
          type: "replace_object_state",
          entityId: context.object.entityId,
          expectedObjectVersion: context.object.version,
          state: { ...state, open: true },
        },
      ],
    };
  },
};

export const doorCloseInteraction: InteractionDefinition<DoorState> = {
  id: "close",
  displayName: "Close",
  trigger: "active_command",
  durationTicks: 3,
  slots: ["HANDS"],
  canStart(state) {
    return state.open ? available : unavailable("already_closed", "The door is already closed");
  },
  complete(state, context) {
    return {
      effects: [
        {
          type: "replace_object_state",
          entityId: context.object.entityId,
          expectedObjectVersion: context.object.version,
          state: { ...state, open: false },
        },
      ],
    };
  },
};

export const doorLockInteraction: InteractionDefinition<DoorState> = {
  id: "lock",
  displayName: "Lock",
  trigger: "active_command",
  durationTicks: 2,
  slots: ["HANDS"],
  canStart(state) {
    if (state.open) return unavailable("must_close_first", "Close the door before locking it");
    return state.locked ? unavailable("already_locked", "The door is already locked") : available;
  },
  complete(state, context) {
    return {
      effects: [
        {
          type: "replace_object_state",
          entityId: context.object.entityId,
          expectedObjectVersion: context.object.version,
          state: { ...state, locked: true },
        },
      ],
    };
  },
};

export const doorUnlockInteraction: InteractionDefinition<DoorState> = {
  id: "unlock",
  displayName: "Unlock",
  trigger: "active_command",
  durationTicks: 2,
  slots: ["HANDS"],
  canStart(state) {
    return state.locked ? available : unavailable("already_unlocked", "The door is not locked");
  },
  complete(state, context) {
    return {
      effects: [
        {
          type: "replace_object_state",
          entityId: context.object.entityId,
          expectedObjectVersion: context.object.version,
          state: { ...state, locked: false },
        },
      ],
    };
  },
};

export const doorInteractions = [
  doorOpenInteraction,
  doorCloseInteraction,
  doorLockInteraction,
  doorUnlockInteraction,
] as const;
