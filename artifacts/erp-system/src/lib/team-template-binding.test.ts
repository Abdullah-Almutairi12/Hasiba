import { describe, expect, it } from "vitest";
import type { TeamPerson } from "@workspace/api-client-react";
import { fromDraft, grantSource, inheritFrom, normalizePerson, personToInput, toDraft, toManual, toOverride } from "./team-access";
import { templateFormIssues, templateFormKey } from "./permission-templates";

const person: TeamPerson = {
  personId: 4, userId: null, status: "active", revision: 3, creationKey: "k1", name: "ريم", email: null, loginKinds: [], deniedActions: [],
  grants: [{ id: 9, resource: "inventory", branchId: 2, warehouseIds: [5], actions: ["inventory.read"], amountLimit: null, startsAt: null, endsAt: null, templateId: 11, templateRevision: 4, templateMode: "inherit" }],
};

describe("template binding metadata", () => {
  it("survives personToInput, normalizePerson and the saved draft round trip", () => {
    const input = personToInput(person);
    expect(input.grants[0]).toMatchObject({ templateId: 11, templateRevision: 4, templateMode: "inherit" });
    expect(normalizePerson(input).grants[0]).toMatchObject({ templateId: 11, templateRevision: 4, templateMode: "inherit" });
    const back = fromDraft(JSON.parse(JSON.stringify(toDraft(input, 4))));
    expect(back.person!.grants[0]).toMatchObject({ templateId: 11, templateRevision: 4, templateMode: "inherit" });
  });
  it("collapses incomplete bindings to manual instead of guessing", () => {
    const back = fromDraft({ person: { name: "x", grants: [{ resource: "pos", templateId: 3, templateMode: "inherit" }] } });
    expect(grantSource(back.person!.grants[0])).toBe("manual");
  });
  it("override is explicit and keeps the link; return to inheritance uses current revision and available actions only", () => {
    const g = personToInput(person).grants[0];
    const o = { ...g, ...toOverride(g, ["inventory.read", "inventory.cost.read"]) };
    expect(grantSource(o)).toBe("override");
    expect(o.templateId).toBe(11);
    const back = { ...o, ...inheritFrom({ id: 11, revision: 7, resource: "inventory", actions: ["inventory.read", "finance.post"] }, new Set(["inventory.read"])) };
    expect(back).toMatchObject({ templateMode: "inherit", templateRevision: 7, actions: ["inventory.read"] });
    expect(grantSource({ ...back, ...toManual() })).toBe("manual");
  });
});

describe("template form", () => {
  const catalog = [
    { key: "inventory.read", label: "", resource: "inventory", available: true },
    { key: "hr.payroll", label: "", resource: "inventory", available: false },
  ];
  it("rejects unavailable catalog actions and changes key on edit (resets preview)", () => {
    expect(templateFormIssues({ name: "a", resource: "inventory", actions: ["inventory.read", "hr.payroll"] }, catalog).join()).toContain("hr.payroll");
    expect(templateFormKey({ name: "a", resource: "inventory", actions: ["inventory.read"] })).not.toBe(templateFormKey({ name: "b", resource: "inventory", actions: ["inventory.read"] }));
  });
});
