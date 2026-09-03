import { createSimulationRulesLock } from "@god-sim/protocol";

import defaultRules from "../../content/rules/default.json" with { type: "json" };

export const testSimulationRulesLock = createSimulationRulesLock(defaultRules);
