import type { OperationCallId, TaskTrack } from "@god-sim/protocol";

export type TaskTrackState =
  | { readonly kind: "empty" }
  | { readonly kind: "operation"; readonly callId: OperationCallId };

export type TaskTracks = Readonly<Record<TaskTrack, TaskTrackState>>;

export function createEmptyTaskTracks(): TaskTracks {
  return {
    HEAD: { kind: "empty" },
    BODY: { kind: "empty" },
  };
}

export function operationCallIdsInTrackOrder(
  tracks: TaskTracks,
): readonly OperationCallId[] {
  const result: OperationCallId[] = [];
  for (const track of ["HEAD", "BODY"] as const) {
    const state = tracks[track];
    if (
      state.kind === "operation" &&
      !result.some((callId) => callId === state.callId)
    ) {
      result.push(state.callId);
    }
  }
  return result;
}
