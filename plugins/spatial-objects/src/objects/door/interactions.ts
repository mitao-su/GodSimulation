import { z } from "zod";

import type {
  EffectProposal,
  InteractionAvailability,
  InteractionDefinition,
} from "@god-sim/plugin-sdk";

import type { DoorState } from "./state";

const available: InteractionAvailability = { available: true };
const noArgumentsSchema = z.object({}).strict();
const emptyResultSchema = z.object({}).strict();
const noEffects = (): EffectProposal => ({ effects: [] });
const noFuseReceipt = () => null;

function unavailable(reasonCode: string, summary: string): InteractionAvailability {
  return { available: false, reasonCode, summary };
}

export const doorOpenInteraction: InteractionDefinition<DoorState> = {
  id: "open",
  displayName: "Open",
  trigger: "active_command",
  taskSlots: ["BODY"],
  parametersSchema: noArgumentsSchema,
  resolveDuration: () => ({ kind: "fixed", totalTicks: 3 }),
  eventIgnore: [],
  publicBehavior: { kind: "visible", label: "opening the door" },
  domainFailures: [
    { code: "already_open", summary: "The door is already open" },
    { code: "locked", summary: "The door is locked" },
  ],
  resultSchema: emptyResultSchema,
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
  fail: noEffects,
  cancel: noEffects,
  fuse: noFuseReceipt,
};

export const doorCloseInteraction: InteractionDefinition<DoorState> = {
  id: "close",
  displayName: "Close",
  trigger: "active_command",
  taskSlots: ["BODY"],
  parametersSchema: noArgumentsSchema,
  resolveDuration: () => ({ kind: "fixed", totalTicks: 3 }),
  eventIgnore: [],
  publicBehavior: { kind: "visible", label: "closing the door" },
  domainFailures: [
    { code: "already_closed", summary: "The door is already closed" },
  ],
  resultSchema: emptyResultSchema,
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
  fail: noEffects,
  cancel: noEffects,
  fuse: noFuseReceipt,
};

export const doorLockInteraction: InteractionDefinition<DoorState> = {
  id: "lock",
  displayName: "Lock",
  trigger: "active_command",
  taskSlots: ["BODY"],
  parametersSchema: noArgumentsSchema,
  resolveDuration: () => ({ kind: "fixed", totalTicks: 2 }),
  eventIgnore: [],
  publicBehavior: { kind: "visible", label: "locking the door" },
  domainFailures: [
    { code: "must_close_first", summary: "Close the door before locking it" },
    { code: "already_locked", summary: "The door is already locked" },
  ],
  resultSchema: emptyResultSchema,
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
  fail: noEffects,
  cancel: noEffects,
  fuse: noFuseReceipt,
};

export const doorUnlockInteraction: InteractionDefinition<DoorState> = {
  id: "unlock",
  displayName: "Unlock",
  trigger: "active_command",
  taskSlots: ["BODY"],
  parametersSchema: noArgumentsSchema,
  resolveDuration: () => ({ kind: "fixed", totalTicks: 2 }),
  eventIgnore: [],
  publicBehavior: { kind: "visible", label: "unlocking the door" },
  domainFailures: [
    { code: "already_unlocked", summary: "The door is not locked" },
  ],
  resultSchema: emptyResultSchema,
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
  fail: noEffects,
  cancel: noEffects,
  fuse: noFuseReceipt,
};

export const doorInteractions = [
  doorOpenInteraction,
  doorCloseInteraction,
  doorLockInteraction,
  doorUnlockInteraction,
] as const;
