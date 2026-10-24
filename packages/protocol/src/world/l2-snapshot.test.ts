import { describe, expect, it } from "vitest";

import { L2SnapshotFieldsSchema } from "./l2-snapshot";

describe("L2 snapshot fragments", () => {
  it("round-trips item, appearance, and visual fragments without changing the online version", () => {
    const fields = {
      itemAppearance: {
        items: [],
        agents: [],
      },
      visual: {
        agents: [],
      },
    } as const;
    expect(L2SnapshotFieldsSchema.parse(fields)).toEqual(fields);
  });
});
