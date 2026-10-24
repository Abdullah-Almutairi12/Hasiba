import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parsePatchBody } from "./patch-body";

const create = z.object({
  name: z.string(),
  amount: z.number().min(0).default(0),
  isActive: z.boolean().default(true),
  note: z.string().nullable().optional(),
  steps: z.array(z.object({ role: z.string(), minAmount: z.number().default(0) })).default([]),
});
const patch = create.partial();

describe("partial updates preserve omitted fields across Zod generations", () => {
  it("does not persist creation defaults for an empty patch", () => {
    expect(parsePatchBody(patch, {})).toEqual({});
  });
  it("preserves explicit false, zero, null and empty text", () => {
    expect(parsePatchBody(patch, { isActive: false, amount: 0, note: null, name: "" }))
      .toEqual({ isActive: false, amount: 0, note: null, name: "" });
  });
  it("does not reactivate or replace existing limits and steps when only a name changes", () => {
    const old = { name: "old", isActive: false, amount: 900, steps: [{ role: "manager", minAmount: 20 }] };
    expect({ ...old, ...parsePatchBody(patch, { name: "new" }) }).toEqual({ ...old, name: "new" });
  });
  it("validates nested objects and retains defaults inside explicitly supplied replacements", () => {
    expect(parsePatchBody(patch, { steps: [{ role: "manager" }] }))
      .toEqual({ steps: [{ role: "manager", minAmount: 0 }] });
  });
  it("still rejects invalid provided fields and non-object input, while stripping unknown keys", () => {
    for (const input of [{ amount: -1 }, { isActive: "false" }, null, []]) {
      expect(() => parsePatchBody(patch, input)).toThrow(z.ZodError);
    }
    expect(parsePatchBody(patch, { unrecognized: true })).toEqual({});
  });
});
