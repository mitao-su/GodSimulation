import { z } from "zod";

export const CoordinateSchema = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
  })
  .strict();

export type Coordinate = z.infer<typeof CoordinateSchema>;

export const FacingSchema = z.enum(["north", "east", "south", "west"]);
export type Facing = z.infer<typeof FacingSchema>;
