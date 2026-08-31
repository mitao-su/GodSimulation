import { describe, expect, it } from "vitest";

import { ObservableObjectStateSchema } from "./observable-state";

describe("ObservableObjectStateSchema", () => {
  it("accepts a plugin-declared unavailable interaction", () => {
    expect(
      ObservableObjectStateSchema.parse({
        status: "busy",
        summary: "Fixture is busy",
        details: { holder: "bob" },
        interactionAvailability: [
          {
            interactionId: "use",
            available: false,
            reasonCode: "in_use",
            summary: "Fixture is already in use",
          },
        ],
      }),
    ).toMatchObject({
      interactionAvailability: [
        {
          interactionId: "use",
          available: false,
          reasonCode: "in_use",
        },
      ],
    });
  });
});
