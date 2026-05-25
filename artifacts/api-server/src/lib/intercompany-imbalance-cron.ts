/**
 * Nightly intercompany imbalance scan.
 *
 * Walks every connected company "group" reachable through
 * `intercompany_links` and runs `scanImbalancesForCompanies` against
 * each one. New offenders are upserted into the review queue and any
 * previously-open rows that now agree are auto-resolved (the lib
 * already encapsulates both behaviours).
 *
 * A short audit_logs row is written per group describing what changed
 * so finance can see when the scan last ran without opening logs.
 * audit_logs.company_id is NOT NULL, so the row is stamped with the
 * lowest companyId in the group.
 *
 * Scheduling: first run ~90s after boot (gives the accounting init
 * tasks time to finish), then every 24 hours. The interval is
 * `.unref()`-ed so it doesn't block process shutdown.
 */

import { db, intercompanyLinksTable, auditLogsTable } from "@workspace/db";
import { logger } from "./logger";
import { scanImbalancesForCompanies } from "./intercompany-imbalances";
import {
  snapshotOpenImbalances,
  sendImbalanceDigestForGroup,
} from "./intercompany-imbalance-digest";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 90_000;

/**
 * Build connected-components over the undirected graph induced by
 * intercompany_links (source_company_id <-> target_company_id). Each
 * returned array is one tenant cluster that should be scanned together
 * — companies with no links are omitted because a single-company
 * "group" has nothing to reconcile.
 */
export async function getIntercompanyGroups(): Promise<number[][]> {
  const rows = await db
    .select({
      sourceCompanyId: intercompanyLinksTable.sourceCompanyId,
      targetCompanyId: intercompanyLinksTable.targetCompanyId,
    })
    .from(intercompanyLinksTable);

  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) ?? r;
    let cur = x;
    while (parent.get(cur) !== r) {
      const next = parent.get(cur) ?? cur;
      parent.set(cur, r);
      cur = next;
    }
    return r;
  };
  const union = (a: number, b: number): void => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const r of rows) union(r.sourceCompanyId, r.targetCompanyId);

  const groups = new Map<number, number[]>();
  for (const c of parent.keys()) {
    const root = find(c);
    const arr = groups.get(root) ?? [];
    arr.push(c);
    groups.set(root, arr);
  }
  return Array.from(groups.values())
    .filter((g) => g.length >= 2)
    .map((g) => Array.from(new Set(g)).sort((a, b) => a - b));
}

export interface NightlyScanSummary {
  groups: number;
  scanned: number;
  subtotal: number;
  open: number;
  resolved: number;
  failures: number;
  digestsSent: number;
  digestsSkipped: number;
}

export async function runNightlyImbalanceScan(): Promise<NightlyScanSummary> {
  const summary: NightlyScanSummary = {
    groups: 0,
    scanned: 0,
    subtotal: 0,
    open: 0,
    resolved: 0,
    failures: 0,
    digestsSent: 0,
    digestsSkipped: 0,
  };
  let groups: number[][];
  try {
    groups = await getIntercompanyGroups();
  } catch (err) {
    logger.error({ err }, "nightly intercompany scan: failed to load groups");
    return summary;
  }
  summary.groups = groups.length;
  for (const group of groups) {
    try {
      // Snapshot the open queue BEFORE the scan so we can classify
      // each post-scan open row as either "new overnight" (id not in
      // before-set) or "still open from a previous run".
      const before = await snapshotOpenImbalances(group).catch((err) => {
        logger.warn(
          { err, group },
          "nightly intercompany scan: pre-snapshot failed; digest will treat all open rows as new",
        );
        return [];
      });
      const result = await scanImbalancesForCompanies(group);
      summary.scanned += group.length;
      summary.subtotal += result.subtotal;
      summary.open += result.open;
      summary.resolved += result.resolved;
      const after = await snapshotOpenImbalances(group).catch((err) => {
        logger.warn(
          { err, group },
          "nightly intercompany scan: post-snapshot failed; skipping digest",
        );
        return [];
      });
      const digest = await sendImbalanceDigestForGroup({
        group,
        before,
        after,
      });
      if (digest.skipped) summary.digestsSkipped += 1;
      else summary.digestsSent += 1;
      // audit_logs.company_id is NOT NULL — stamp the row against the
      // lowest companyId in the group so the trail lives somewhere
      // queryable. userName="نظام" mirrors the convention used by
      // recordAudit() for system-initiated actions.
      try {
        await db.insert(auditLogsTable).values({
          userId: null,
          userName: "نظام",
          action: "scan_nightly",
          entity: "intercompany_imbalance",
          details:
            `group=[${group.join(",")}] ` +
            `subtotal=${result.subtotal} open=${result.open} resolved=${result.resolved}`,
          ipAddress: "cron",
          severity: "info",
          companyId: group[0]!,
        });
      } catch (err) {
        logger.warn({ err, group }, "nightly intercompany scan: audit insert failed");
      }
    } catch (err) {
      summary.failures += 1;
      logger.error({ err, group }, "nightly intercompany scan: group failed");
    }
  }
  logger.info(summary, "nightly intercompany imbalance scan complete");
  return summary;
}

let started = false;
export function startNightlyImbalanceScan(): void {
  if (started) return;
  started = true;
  setTimeout(() => {
    void runNightlyImbalanceScan();
    setInterval(() => void runNightlyImbalanceScan(), ONE_DAY_MS).unref();
  }, FIRST_RUN_DELAY_MS).unref();
}
