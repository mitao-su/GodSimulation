import { describe, expect, it } from "vitest";

import type {
  L2ItemAppearanceSnapshotFields,
  L2VisualSnapshotFields,
} from "@god-sim/protocol";

import type {
  L2ItemAppearanceSnapshotSerializationPort,
  L2VisualSnapshotSerializationPort,
} from "./l2-snapshot-contract";

describe("L2 snapshot serialization ports", () => {
  it("keep item and visual fragments independently round-trippable", () => {
    type Runtime = {
      readonly items: L2ItemAppearanceSnapshotFields;
      readonly visual: L2VisualSnapshotFields;
    };
    const itemPort: L2ItemAppearanceSnapshotSerializationPort<Runtime> = {
      serializeItemAppearance: (runtime) => runtime.items,
      deserializeItemAppearance: (fields, runtime) => ({ ...runtime, items: fields }),
    };
    const visualPort: L2VisualSnapshotSerializationPort<Runtime> = {
      serializeVisual: (runtime) => runtime.visual,
      deserializeVisual: (fields, runtime) => ({ ...runtime, visual: fields }),
    };
    const runtime: Runtime = {
      items: { items: [], agents: [] },
      visual: { agents: [] },
    };
    const restored = visualPort.deserializeVisual(
      visualPort.serializeVisual(runtime),
      itemPort.deserializeItemAppearance(itemPort.serializeItemAppearance(runtime), runtime),
    );
    expect(restored).toEqual(runtime);
  });
});

