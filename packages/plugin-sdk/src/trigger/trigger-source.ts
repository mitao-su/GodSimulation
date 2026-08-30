import { z } from "zod";

export const TriggerSourceSchema = z.enum([
  "system_query",
  "active_command",
  "position_change",
  "perception_change",
  "state_threshold",
  "scheduled",
]);

export type TriggerSource = z.infer<typeof TriggerSourceSchema>;
