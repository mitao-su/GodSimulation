import type {
  L2ItemAppearanceSnapshotFields,
  L2VisualSnapshotFields,
} from "@god-sim/protocol";

/**
 * L2 的保存格式端口只描述字段片段。W2-X 负责把它接入线上快照并统一升级版本。
 */
export interface L2ItemAppearanceSnapshotSerializationPort<RuntimeState> {
  serializeItemAppearance(runtime: RuntimeState): L2ItemAppearanceSnapshotFields;
  deserializeItemAppearance(
    fields: L2ItemAppearanceSnapshotFields,
    runtime: RuntimeState,
  ): RuntimeState;
}

export interface L2VisualSnapshotSerializationPort<RuntimeState> {
  serializeVisual(runtime: RuntimeState): L2VisualSnapshotFields;
  deserializeVisual(fields: L2VisualSnapshotFields, runtime: RuntimeState): RuntimeState;
}

