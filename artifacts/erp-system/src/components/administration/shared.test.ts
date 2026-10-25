// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { writeEvidence, readAllEvidence, clearEvidence } from "@/components/administration/shared";

describe("administration finalize evidence", () => {
  beforeEach(() => localStorage.clear());
  it("persists per user across companies and survives until cleared", () => {
    const ev = { id: "h1", revision: 3, departure: "stay", at: "x", companyId: 7 };
    writeEvidence(5, ev);
    writeEvidence(6, { ...ev, id: "other" });
    expect(readAllEvidence(5)).toEqual([ev]);
    clearEvidence(5, ev);
    expect(readAllEvidence(5)).toEqual([]);
    expect(readAllEvidence(6)).toHaveLength(1);
  });
});
