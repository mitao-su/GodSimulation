import { createSimulationRulesLock } from "@god-sim/protocol";

import defaultRules from "../../content/rules/default.json" with { type: "json" };

// 场景 fixture 使用较大视野以保持跨房间行为测试的既有覆盖；生产规则仍锁定为 1 格。
export const testSimulationRulesLock = createSimulationRulesLock({
  ...defaultRules,
  perception: { visionRadius: 6 },
});
