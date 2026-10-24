import { z } from "zod";

/**
 * PATCH changes only explicitly supplied fields. Zod 4 applies defaults inside
 * optional fields, unlike the previous generation. Keep validation (including
 * nested defaults in supplied objects), but never persist omitted create defaults.
 */
export function parsePatchBody<Shape extends z.ZodRawShape, Config extends z.core.$ZodObjectConfig>(
  schema: z.ZodObject<Shape, Config>,
  input: unknown,
) {
  const parsed = schema.parse(input);
  for (const key of Object.keys(parsed)) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) Reflect.deleteProperty(parsed, key);
  }
  return parsed;
}
