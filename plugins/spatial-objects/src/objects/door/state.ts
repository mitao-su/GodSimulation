import { z } from "zod";

export const DoorStateSchema = z.object({ open: z.boolean(), locked: z.boolean() }).strict();
export type DoorState = z.infer<typeof DoorStateSchema>;
