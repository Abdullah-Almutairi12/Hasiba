/**
 * Pure-render tests for the morning intercompany imbalance digest.
 *
 * These cover only the message-shaping logic (`buildDigestEmail`) and
 * the deep-link resolver (`resolveAppBaseUrl`); the SMTP dispatch + DB
 * lookups are exercised end-to-end by the cron's integration runs and
 * by `intercompany-imbalances.test.ts`.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  buildDigestEmail,
  resolveAppBaseUrl,
  type OpenImbalanceSnapshot,
} from "./intercompany-imbalance-digest";

function snap(overrides: Partial<OpenImbalanceSnapshot>): OpenImbalanceSnapshot {
  return {
    id: 1,
    basis: "subtotal",
    sourceCompanyId: 10,
    sourceRef: "INV-1",
    targetCompanyId: 20,
    targetRef: "SUP-1",
    difference: "5.0000",
    ...overrides,
  };
}

describe("buildDigestEmail", () => {
  const names = new Map<number, string>([
    [10, "شركة الشمال"],
    [20, "شركة الجنوب"],
  ]);

  it("counts new rows, includes still-open carry-over, and deep-links /intercompany", () => {
    const out = buildDigestEmail({
      companyNames: ["شركة الشمال", "شركة الجنوب"],
      newRows: [snap({ id: 1 }), snap({ id: 2, basis: "open", difference: "12.5000" })],
      stillOpenCount: 3,
      companyNameById: names,
      baseUrl: "https://example.com",
    });
    expect(out.subject).toContain("2 اختلال جديد");
    expect(out.subject).toContain("شركة الشمال");
    expect(out.body).toContain("شركة الشمال");
    expect(out.body).toContain("INV-1");
    expect(out.body).toContain("[إجمالي]");
    expect(out.body).toContain("[رصيد]");
    expect(out.body).toContain("12.5000");
    expect(out.body).toContain("3 اختلال مفتوح من جلسات سابقة");
    expect(out.body).toContain("https://example.com/intercompany#tab=imbalances");
  });

  it("omits the still-open line when the carry-over count is zero", () => {
    const out = buildDigestEmail({
      companyNames: ["شركة الشمال"],
      newRows: [snap({})],
      stillOpenCount: 0,
      companyNameById: names,
      baseUrl: "",
    });
    expect(out.body).not.toContain("جلسات سابقة");
    expect(out.body).toContain("/intercompany#tab=imbalances");
  });

  it("renders a still-open-only digest when there are no new rows but carry-over remains", () => {
    const out = buildDigestEmail({
      companyNames: ["شركة الشمال", "شركة الجنوب"],
      newRows: [],
      stillOpenCount: 4,
      companyNameById: names,
      baseUrl: "https://example.com",
    });
    expect(out.subject).toContain("4 اختلال مفتوح");
    expect(out.subject).not.toContain("جديد");
    expect(out.body).toContain("لم يُكتشف أي اختلال جديد");
    expect(out.body).toContain("4 اختلال مفتوح");
    expect(out.body).not.toContain("الاختلالات الجديدة:");
    expect(out.body).toContain("https://example.com/intercompany#tab=imbalances");
  });

  it("truncates long lists and shows the overflow tail", () => {
    const many: OpenImbalanceSnapshot[] = Array.from({ length: 13 }, (_, i) =>
      snap({ id: i + 1, sourceRef: `INV-${i + 1}` }),
    );
    const out = buildDigestEmail({
      companyNames: ["A", "B"],
      newRows: many,
      stillOpenCount: 0,
      companyNameById: names,
      baseUrl: "",
    });
    expect(out.body).toContain("INV-10");
    expect(out.body).not.toContain("INV-11");
    expect(out.body).toContain("و3 اختلال إضافي");
  });

  it("renders per-imbalance resync/ignore action links when provided (Task 150)", () => {
    const links = new Map([
      [
        1,
        {
          imbalanceId: 1,
          resyncUrl: "https://example.com/intercompany/email-action?token=A&action=resync",
          ignoreUrl: "https://example.com/intercompany/email-action?token=B&action=ignore",
        },
      ],
    ]);
    const out = buildDigestEmail({
      companyNames: ["شركة الشمال"],
      newRows: [snap({ id: 1 }), snap({ id: 2 })],
      stillOpenCount: 0,
      companyNameById: names,
      baseUrl: "https://example.com",
      actionLinksByImbalanceId: links,
    });
    expect(out.body).toContain("إعادة المزامنة");
    expect(out.body).toContain("token=A&action=resync");
    expect(out.body).toContain("تجاهل الفرق");
    expect(out.body).toContain("token=B&action=ignore");
  });

  it("falls back to #id when a company name is missing", () => {
    const out = buildDigestEmail({
      companyNames: ["A", "B"],
      newRows: [snap({ sourceCompanyId: 999, targetCompanyId: 888 })],
      stillOpenCount: 0,
      companyNameById: new Map(),
      baseUrl: "",
    });
    expect(out.body).toContain("#999");
    expect(out.body).toContain("#888");
  });
});

describe("resolveAppBaseUrl", () => {
  const original = {
    PUBLIC_APP_URL: process.env.PUBLIC_APP_URL,
    REPLIT_DOMAINS: process.env.REPLIT_DOMAINS,
  };
  afterEach(() => {
    process.env.PUBLIC_APP_URL = original.PUBLIC_APP_URL;
    process.env.REPLIT_DOMAINS = original.REPLIT_DOMAINS;
  });

  it("prefers PUBLIC_APP_URL and strips trailing slash", () => {
    process.env.PUBLIC_APP_URL = "https://app.example.com/";
    delete process.env.REPLIT_DOMAINS;
    expect(resolveAppBaseUrl()).toBe("https://app.example.com");
  });

  it("falls back to the first REPLIT_DOMAINS entry", () => {
    delete process.env.PUBLIC_APP_URL;
    process.env.REPLIT_DOMAINS = "primary.replit.app,secondary.replit.app";
    expect(resolveAppBaseUrl()).toBe("https://primary.replit.app");
  });

  it("returns empty string when neither var is set", () => {
    delete process.env.PUBLIC_APP_URL;
    delete process.env.REPLIT_DOMAINS;
    expect(resolveAppBaseUrl()).toBe("");
  });
});
