import { z } from "zod";

export const BodySlotSchema = z.enum(["HEAD", "HANDS", "BODY"]);
export type BodySlot = z.infer<typeof BodySlotSchema>;
