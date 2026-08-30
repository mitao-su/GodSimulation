import { describe, expect, it } from "vitest";

import { createEmptyBodySlots, releaseBodySlots, reserveBodySlots } from "./body-slots";

describe("body slots", () => {
  it("reserves requested slots without mutating existing reservations", () => {
    const empty = createEmptyBodySlots();
    const moving = reserveBodySlots(empty, "move-1", ["BODY"]);

    expect(moving).toEqual({
      accepted: true,
      slots: { HEAD: null, HANDS: null, BODY: "move-1" },
    });
    expect(empty).toEqual({ HEAD: null, HANDS: null, BODY: null });
  });

  it("rejects a second action that needs an occupied slot", () => {
    const moving = reserveBodySlots(createEmptyBodySlots(), "move-1", ["BODY"]);
    if (!moving.accepted) throw new Error("Expected first reservation to succeed");

    expect(reserveBodySlots(moving.slots, "wait-1", ["BODY"])).toEqual({
      accepted: false,
      occupiedSlots: ["BODY"],
    });
  });

  it("releases only slots owned by the completing action", () => {
    const slots = { HEAD: null, HANDS: "open-1", BODY: "move-1" } as const;
    expect(releaseBodySlots(slots, "open-1")).toEqual({
      HEAD: null,
      HANDS: null,
      BODY: "move-1",
    });
  });
});
