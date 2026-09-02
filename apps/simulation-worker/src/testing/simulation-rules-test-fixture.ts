import { SimulationRulesLockSchema } from "@god-sim/protocol";

import defaultRules from "../../../../content/rules/default.json" with { type: "json" };

export const testSimulationRulesLock = SimulationRulesLockSchema.parse({
  hash: "c".repeat(64),
  rules: defaultRules,
});
