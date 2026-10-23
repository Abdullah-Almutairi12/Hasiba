import { describe, expect, it } from "vitest";
import { isPublishedBootstrapPassword } from "./bootstrap-password";

describe("published bootstrap password gate", () => {
  it("rejects the formerly public seed password regardless of identity", () => {
    const published = ["admin", "123"].join("");
    expect(isPublishedBootstrapPassword(published)).toBe(true);
  });
  it("does not ban rotated passwords or demo identities by name", () => {
    expect(isPublishedBootstrapPassword("Synthetic-Rotated-741!")).toBe(false);
    expect(isPublishedBootstrapPassword("")).toBe(false);
  });
});
