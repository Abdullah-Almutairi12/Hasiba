import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("scoped manager entry", () => {
  it("allows /team-setup (server rights checked in page) but not general /settings", () => {
    const app = readFileSync(`${process.cwd()}/src/App.tsx`, "utf8");
    const line = app.split("\n").find((l) => l.includes("const SCOPED_PATHS"))!;
    expect(line).toContain('"/team-setup"');
    expect(line).not.toContain('"/settings"');
    const layout = readFileSync(`${process.cwd()}/src/components/layout.tsx`, "utf8");
    expect(layout).toContain('user?.role === "scoped" ? "/settings/users" : "/settings"');
  });
});
