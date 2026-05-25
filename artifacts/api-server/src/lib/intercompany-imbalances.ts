/**
 * Phase 6 add-on — persisted intercompany pricing-policy mismatch queue.
 *
 * The consolidated PL/BS reports surface a red banner when a matched
 * intercompany_links pair's source and mirror amounts diverge — but
 * the finding is transient and lives only as long as the report tab
 * stays open. This module turns the finding into a durable review
 * queue so finance can triage with one-click resync/void/ignore.
 *
 * Design:
 *   - One row per (link_id, basis). `basis` is 'subtotal' for P&L-side
 *     differences and 'open' for BS-side outstanding AR/AP differences.
 *   - `recordImbalancesFromEliminations` upserts each imbalanced pair
 *     and auto-resolves any rows whose link was scanned-in but now
 *     agrees. Called best-effort from the consolidated report
 *     generators so every report run keeps the queue fresh.
 *   - `scanImbalancesForCompanies` runs both P&L and BS comparisons
 *     for an arbitrary scope — used by the on-demand "rescan" button
 *     on the imbalances tab and the future nightly job.
 */

import {
  db,
  intercompanyImbalancesTable,
  intercompanyLinksTable,
  companiesTable,
  alertsTable,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  EliminationEntry,
  fetchEliminationPairsForScope,
  buildEliminationEntriesPublic,
} from "./consolidated-reports";
import { logger } from "./logger";

export type ImbalanceBasis = "subtotal" | "open";

const TOLERANCE = 0.01;

/**
 * Upsert one open imbalance row per offending elimination entry. Any
 * row in `scope` that was *previously* open but whose link is now
 * either inside `eliminations` with agreement, or absent, is left
 * alone here — the caller invokes `autoResolveMissing` after recording
 * all bases to flip them to `resolved`.
 */
export async function recordImbalancesFromEliminations(
  eliminations: EliminationEntry[],
  basis: ImbalanceBasis,
  kindByLinkId: Map<number, string>,
): Promise<{ recorded: number; resolved: number; offendingLinkIds: number[] }> {
  const offenders = eliminations.filter(
    (e) => Math.abs(e.sourceAmount - e.targetAmount) > TOLERANCE,
  );

  // Snapshot the current queue rows for these (linkId, basis) keys so
  // we can tell, after the upsert, which offenders are genuinely new
  // (no row before, or row existed but was 'resolved' / 'ignored').
  // Only those should trigger a notification — re-detecting a row that
  // was already 'open' should not spam finance every time the report
  // is opened.
  const offendingLinkIds = offenders.map((o) => o.linkId);
  const preExistingStatusByLinkId = new Map<number, string>();
  if (offendingLinkIds.length > 0) {
    const existing = await db
      .select({
        linkId: intercompanyImbalancesTable.linkId,
        status: intercompanyImbalancesTable.status,
      })
      .from(intercompanyImbalancesTable)
      .where(
        and(
          eq(intercompanyImbalancesTable.basis, basis),
          inArray(intercompanyImbalancesTable.linkId, offendingLinkIds),
        ),
      );
    for (const r of existing) preExistingStatusByLinkId.set(r.linkId, r.status);
  }

  let recorded = 0;
  const newlyOpened: EliminationEntry[] = [];
  for (const e of offenders) {
    const diff = Number((e.sourceAmount - e.targetAmount).toFixed(4));
    const kind = kindByLinkId.get(e.linkId) ?? "sales_invoice";
    await db
      .insert(intercompanyImbalancesTable)
      .values({
        linkId: e.linkId,
        basis,
        kind,
        sourceCompanyId: e.sourceCompanyId,
        sourceRef: e.sourceRef,
        targetCompanyId: e.targetCompanyId,
        targetRef: e.targetRef,
        sourceAmount: e.sourceAmount.toFixed(4),
        targetAmount: e.targetAmount.toFixed(4),
        difference: diff.toFixed(4),
        status: "open",
      })
      .onConflictDoUpdate({
        target: [intercompanyImbalancesTable.linkId, intercompanyImbalancesTable.basis],
        // Only reopen `resolved` rows on re-detection; never override
        // a row finance has manually marked `ignored`.
        set: {
          kind,
          sourceCompanyId: e.sourceCompanyId,
          sourceRef: e.sourceRef,
          targetCompanyId: e.targetCompanyId,
          targetRef: e.targetRef,
          sourceAmount: e.sourceAmount.toFixed(4),
          targetAmount: e.targetAmount.toFixed(4),
          difference: diff.toFixed(4),
          lastSeenAt: new Date(),
          status: sql`CASE WHEN ${intercompanyImbalancesTable.status} = 'ignored' THEN 'ignored' ELSE 'open' END`,
          resolvedAt: sql`CASE WHEN ${intercompanyImbalancesTable.status} = 'ignored' THEN ${intercompanyImbalancesTable.resolvedAt} ELSE NULL END`,
        },
      });
    recorded += 1;
    const prev = preExistingStatusByLinkId.get(e.linkId);
    // Notify only when the row is genuinely new (no prior row) or
    // when a previously cleared row has now reopened. Rows that
    // finance has explicitly marked 'ignored' stay ignored by the
    // upsert above (the CASE keeps status='ignored'), so we must
    // NOT alert on them — otherwise every rescan would re-page
    // finance for known/parked items.
    if (prev === undefined || prev === "resolved") {
      newlyOpened.push(e);
    }
  }

  // Fire one in-app alert per company involved in each newly-opened
  // (or freshly re-opened) imbalance. The dashboard /dashboard/alerts
  // feed filters by `companyId`, so we stamp source + target so both
  // sides' finance teams see it in their own feed. Best-effort: a
  // failure here must not block the queue write itself.
  if (newlyOpened.length > 0) {
    try {
      const basisAr = basis === "subtotal" ? "ربح/خسارة" : "ميزانية";
      const alertRows = newlyOpened.flatMap((e) => {
        const diff = Number((e.sourceAmount - e.targetAmount).toFixed(2));
        const message =
          `تم رصد فرق بين ${e.sourceRef} و ${e.targetRef} ` +
          `بمقدار ${diff.toLocaleString("en-US")} (${basisAr}). ` +
          `راجع الطابور في /intercompany#tab=imbalances`;
        const title = `عدم تطابق بين الشركات: ${e.sourceRef} ↔ ${e.targetRef}`;
        const companyIds = new Set<number>([e.sourceCompanyId, e.targetCompanyId]);
        return Array.from(companyIds).map((cid) => ({
          type: "warning",
          title,
          message,
          companyId: cid,
        }));
      });
      if (alertRows.length > 0) {
        await db.insert(alertsTable).values(alertRows);
      }
    } catch (err) {
      // Notification failure must never break the queue write itself —
      // but do log so a silent notification outage is detectable.
      logger.error(
        { err, basis, count: newlyOpened.length },
        "failed to insert intercompany imbalance notification alerts",
      );
    }
  }

  // Auto-resolve: any link present in `eliminations` whose amounts now
  // agree, but had an open row for this basis, flips to 'resolved'.
  const agreeingLinkIds = eliminations
    .filter((e) => Math.abs(e.sourceAmount - e.targetAmount) <= TOLERANCE)
    .map((e) => e.linkId);
  let resolved = 0;
  if (agreeingLinkIds.length > 0) {
    const updated = await db
      .update(intercompanyImbalancesTable)
      .set({ status: "resolved", resolvedAt: new Date() })
      .where(
        and(
          eq(intercompanyImbalancesTable.basis, basis),
          eq(intercompanyImbalancesTable.status, "open"),
          inArray(intercompanyImbalancesTable.linkId, agreeingLinkIds),
        ),
      )
      .returning({ id: intercompanyImbalancesTable.id });
    resolved = updated.length;
  }
  return {
    recorded,
    resolved,
    offendingLinkIds: offenders.map((o) => o.linkId),
  };
}

/**
 * Best-effort wrapper used by `generateConsolidatedPL` /
 * `generateConsolidatedBS`. Swallows + logs errors so a queue write
 * failure never breaks the user-facing report.
 */
export async function recordImbalancesSafe(
  eliminations: EliminationEntry[],
  basis: ImbalanceBasis,
  kindByLinkId: Map<number, string>,
  logger: { error: (obj: unknown, msg?: string) => void },
): Promise<void> {
  try {
    await recordImbalancesFromEliminations(eliminations, basis, kindByLinkId);
  } catch (err) {
    logger.error({ err, basis }, "failed to persist intercompany imbalances");
  }
}

/**
 * Run both PL-style (subtotal) and BS-style (open) imbalance scans
 * across the given company scope, persisting findings and
 * auto-resolving cleared ones. Used by the on-demand rescan button
 * and a future nightly cron.
 */
export async function scanImbalancesForCompanies(
  companyIds: number[],
): Promise<{ subtotal: number; open: number; resolved: number }> {
  if (companyIds.length < 2) {
    return { subtotal: 0, open: 0, resolved: 0 };
  }
  const { pairs } = await fetchEliminationPairsForScope(companyIds);
  const kindByLinkId = new Map<number, string>();
  for (const p of pairs) kindByLinkId.set(p.linkId, "sales_invoice");
  const subtotalEntries = buildEliminationEntriesPublic(pairs, "subtotal");
  const openEntries = buildEliminationEntriesPublic(pairs, "open");
  const sub = await recordImbalancesFromEliminations(
    subtotalEntries,
    "subtotal",
    kindByLinkId,
  );
  const opn = await recordImbalancesFromEliminations(
    openEntries,
    "open",
    kindByLinkId,
  );
  return {
    subtotal: sub.recorded,
    open: opn.recorded,
    resolved: sub.resolved + opn.resolved,
  };
}

export interface ImbalanceRow {
  id: number;
  linkId: number;
  basis: ImbalanceBasis;
  kind: string;
  sourceCompanyId: number;
  sourceCompanyName: string | null;
  sourceRef: string;
  targetCompanyId: number;
  targetCompanyName: string | null;
  targetRef: string;
  sourceAmount: number;
  targetAmount: number;
  difference: number;
  status: "open" | "resolved" | "ignored";
  detectedAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  linkStatus: string;
  direction: "outbound" | "inbound";
}

/**
 * List imbalances involving `companyId` (either as source OR target).
 * `statuses` filters by status — defaults to ['open'] so the queue
 * shows only actionable items.
 */
export async function listImbalancesForCompany(
  companyId: number,
  statuses: Array<"open" | "resolved" | "ignored"> = ["open"],
): Promise<ImbalanceRow[]> {
  const rows = await db
    .select({
      id: intercompanyImbalancesTable.id,
      linkId: intercompanyImbalancesTable.linkId,
      basis: intercompanyImbalancesTable.basis,
      kind: intercompanyImbalancesTable.kind,
      sourceCompanyId: intercompanyImbalancesTable.sourceCompanyId,
      sourceRef: intercompanyImbalancesTable.sourceRef,
      targetCompanyId: intercompanyImbalancesTable.targetCompanyId,
      targetRef: intercompanyImbalancesTable.targetRef,
      sourceAmount: intercompanyImbalancesTable.sourceAmount,
      targetAmount: intercompanyImbalancesTable.targetAmount,
      difference: intercompanyImbalancesTable.difference,
      status: intercompanyImbalancesTable.status,
      detectedAt: intercompanyImbalancesTable.detectedAt,
      lastSeenAt: intercompanyImbalancesTable.lastSeenAt,
      resolvedAt: intercompanyImbalancesTable.resolvedAt,
      linkStatus: intercompanyLinksTable.status,
      sourceCompanyName: sql<string | null>`(select name from ${companiesTable} where id = ${intercompanyImbalancesTable.sourceCompanyId})`,
      targetCompanyName: sql<string | null>`(select name from ${companiesTable} where id = ${intercompanyImbalancesTable.targetCompanyId})`,
    })
    .from(intercompanyImbalancesTable)
    .innerJoin(
      intercompanyLinksTable,
      eq(intercompanyLinksTable.id, intercompanyImbalancesTable.linkId),
    )
    .where(
      and(
        inArray(intercompanyImbalancesTable.status, statuses),
        sql`(${intercompanyImbalancesTable.sourceCompanyId} = ${companyId} OR ${intercompanyImbalancesTable.targetCompanyId} = ${companyId})`,
      ),
    )
    .orderBy(desc(intercompanyImbalancesTable.lastSeenAt))
    .limit(500);
  return rows.map((r) => ({
    id: r.id,
    linkId: r.linkId,
    basis: r.basis as ImbalanceBasis,
    kind: r.kind,
    sourceCompanyId: r.sourceCompanyId,
    sourceCompanyName: r.sourceCompanyName,
    sourceRef: r.sourceRef,
    targetCompanyId: r.targetCompanyId,
    targetCompanyName: r.targetCompanyName,
    targetRef: r.targetRef,
    sourceAmount: Number(r.sourceAmount),
    targetAmount: Number(r.targetAmount),
    difference: Number(r.difference),
    status: r.status as "open" | "resolved" | "ignored",
    detectedAt: r.detectedAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    linkStatus: r.linkStatus,
    direction: r.sourceCompanyId === companyId ? "outbound" : "inbound",
  }));
}

/**
 * Mutate an imbalance row's status. `allowedCompanyIds` MUST be the
 * set of companies the actor has access to via `user_companies`; the
 * row is only updated when its source OR target company is in that
 * set, preventing cross-tenant IDOR via guessed ids.
 */
export async function setImbalanceStatus(
  id: number,
  status: "open" | "resolved" | "ignored",
  resolvedBy: number | null,
  notes: string | null,
  allowedCompanyIds: number[],
): Promise<boolean> {
  if (allowedCompanyIds.length === 0) return false;
  const updated = await db
    .update(intercompanyImbalancesTable)
    .set({
      status,
      resolvedAt: status === "open" ? null : new Date(),
      resolvedBy: status === "open" ? null : resolvedBy,
      notes: notes ?? undefined,
    })
    .where(
      and(
        eq(intercompanyImbalancesTable.id, id),
        sql`(${intercompanyImbalancesTable.sourceCompanyId} IN (${sql.join(
          allowedCompanyIds.map((c) => sql`${c}`),
          sql`, `,
        )}) OR ${intercompanyImbalancesTable.targetCompanyId} IN (${sql.join(
          allowedCompanyIds.map((c) => sql`${c}`),
          sql`, `,
        )}))`,
      ),
    )
    .returning({ id: intercompanyImbalancesTable.id });
  return updated.length > 0;
}
