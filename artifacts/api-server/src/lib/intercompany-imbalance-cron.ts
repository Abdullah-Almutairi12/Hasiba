/**
 * Periodic intercompany imbalance scan + per-group digest dispatcher.
 *
 * Walks every connected company "group" reachable through
 * `intercompany_links` and runs `scanImbalancesForCompanies` against
 * each one. New offenders are upserted into the review queue and any
 * previously-open rows that now agree are auto-resolved (the lib
 * already encapsulates both behaviours).
 *
 * Scheduling (Task #151): the cron used to fire on a fixed 24h
 * interval tied to server boot time. It now ticks every
 * `TICK_INTERVAL_MS` (default 5 minutes) and, for each group, consults
 * `intercompany_digest_group_prefs` to decide whether the digest
 * should be dispatched on this tick (configured local hour/minute,
 * allowed weekdays, no send earlier today). The scan itself is still
 * run alongside the dispatch so the email reflects fresh state.
 *
 * For groups whose prefs say "not yet" we additionally run a refresh
 * scan once per day so the in-app queue stays current even if the
 * digest is paused — guarded by an in-memory map keyed by anchor +
 * local-date so we don't re-scan on every tick.
 *
 * Resilience (task #153):
 *   - Per-group errors are isolated and recorded as `scan_failed`
 *     audit rows so the front-end stale/failure banner can detect
 *     them; the scan continues with the remaining groups.
 *   - The whole scan run is wrapped in a catastrophic-failure catch
 *     that records a tenant-wide `scan_failed` audit row, then a
 *     retry mechanism re-runs with exponential backoff (5min, 15min)
 *     before logging a permanent failure.
 *
 * A short audit_logs row is written per group after each dispatch
 * describing what changed so finance can see when the scan last ran
 * without opening logs. The first tick fires ~90s after boot (gives
 * the accounting init tasks time to finish); the interval is
 * `.unref()`-ed so it doesn't block process shutdown.
 */

import {
  db,
  intercompanyLinksTable,
  auditLogsTable,
  companiesTable,
} from "@workspace/db";
import { asc } from "drizzle-orm";
import { logger } from "./logger";
import { scanImbalancesForCompanies } from "./intercompany-imbalances";
import {
  snapshotOpenImbalances,
  sendImbalanceDigestForGroup,
} from "./intercompany-imbalance-digest";
import {
  loadGroupPrefsMap,
  shouldDispatchNow,
  type GroupPrefsView,
} from "./intercompany-digest-prefs";

const TICK_INTERVAL_MS = Number(process.env.INTERCOMPANY_DIGEST_TICK_MS ?? 5 * 60 * 1000);
const FIRST_RUN_DELAY_MS = 90_000;

/**
 * Exponential-backoff delays between retry attempts when the whole
 * scan crashes (5 minutes, then 15 minutes). After the final attempt
 * fails the run is marked as a permanent failure for the day and the
 * next attempt is the next scheduled tick.
 */
const RETRY_DELAYS_MS: readonly number[] = [5 * 60_000, 15 * 60_000];

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

/**
 * Pick a stable, low company id to stamp catastrophic-failure audit
 * rows against when we have no group context. `audit_logs.company_id`
 * is NOT NULL, so a catastrophic failure that hits before any group
 * loads still needs *some* tenant scope. Returns `null` only if the
 * companies table is empty (no tenants exist yet).
 */
async function firstCompanyIdForFailureAudit(): Promise<number | null> {
  try {
    const [row] = await db
      .select({ id: companiesTable.id })
      .from(companiesTable)
      .orderBy(asc(companiesTable.id))
      .limit(1);
    return row?.id ?? null;
  } catch (err) {
    logger.warn({ err }, "nightly intercompany scan: companies lookup failed");
    return null;
  }
}

/**
 * Best-effort insert of a `scan_failed` audit row. The front-end
 * stale-scan banner queries `audit_logs` for the latest
 * `scan_nightly` / `scan_failed` row per tenant, so writing this is
 * what makes a silent failure visible. Wrapped in its own try/catch
 * because if the audit insert itself throws we don't want to mask
 * the original error.
 */
async function recordScanFailedAudit(
  companyId: number,
  err: unknown,
  scope: "group" | "run" | "permanent",
  extra: Record<string, string | number | readonly number[]> = {},
): Promise<void> {
  try {
    const message = err instanceof Error ? err.message : String(err);
    const truncated = message.length > 400 ? `${message.slice(0, 400)}…` : message;
    const extraParts = Object.entries(extra).map(([k, v]) =>
      Array.isArray(v) ? `${k}=[${v.join(",")}]` : `${k}=${String(v)}`,
    );
    await db.insert(auditLogsTable).values({
      userId: null,
      userName: "نظام",
      action: "scan_failed",
      entity: "intercompany_imbalance",
      details: [`scope=${scope}`, ...extraParts, `error="${truncated}"`].join(" "),
      ipAddress: "cron",
      severity: scope === "permanent" ? "critical" : "warning",
      companyId,
    });
  } catch (auditErr) {
    logger.error(
      { auditErr, originalError: err, companyId, scope },
      "nightly intercompany scan: scan_failed audit insert failed",
    );
  }
}

/** Local-date key (YYYY-MM-DD) in the group's configured tz. */
function todayKey(prefs: GroupPrefsView, now: Date): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: prefs.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = Object.fromEntries(
      fmt.formatToParts(now).map((p) => [p.type, p.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

// Memoise per-anchor "we already scanned today" to avoid scanning on
// every 5-minute tick when the digest is paused or has already gone
// out. Cleared on process restart, which is fine — worst case we
// re-scan a couple of extra times after a deploy.
const lastScannedOn = new Map<number, string>();

async function processGroup(
  group: number[],
  prefs: GroupPrefsView,
  summary: NightlyScanSummary,
  options: { forceDispatch: boolean },
): Promise<void> {
  const anchor = group[0]!;
  const now = new Date();
  const dayKey = todayKey(prefs, now);
  const dispatch =
    options.forceDispatch || shouldDispatchNow(prefs, now);
  const alreadyScannedToday = lastScannedOn.get(anchor) === dayKey;

  // Cheap path: nothing to do this tick.
  if (!dispatch && alreadyScannedToday) {
    summary.digestsSkipped += 1;
    return;
  }

  try {
    const before = await snapshotOpenImbalances(group).catch((err) => {
      logger.warn(
        { err, group },
        "intercompany_scan: pre-snapshot failed; digest will treat all open rows as new",
      );
      return [];
    });
    const result = await scanImbalancesForCompanies(group);
    summary.scanned += group.length;
    summary.subtotal += result.subtotal;
    summary.open += result.open;
    summary.resolved += result.resolved;
    lastScannedOn.set(anchor, dayKey);

    if (dispatch) {
      const after = await snapshotOpenImbalances(group).catch((err) => {
        logger.warn(
          { err, group },
          "intercompany_scan: post-snapshot failed; skipping digest",
        );
        return [];
      });
      const digest = await sendImbalanceDigestForGroup({
        group,
        before,
        after,
        prefs,
      });
      if (digest.skipped) summary.digestsSkipped += 1;
      else summary.digestsSent += 1;
    } else {
      summary.digestsSkipped += 1;
    }

    try {
      await db.insert(auditLogsTable).values({
        userId: null,
        userName: "نظام",
        action: dispatch ? "scan_nightly" : "scan_refresh",
        entity: "intercompany_imbalance",
        details:
          `group=[${group.join(",")}] ` +
          `subtotal=${result.subtotal} open=${result.open} resolved=${result.resolved}`,
        ipAddress: "cron",
        severity: "info",
        companyId: anchor,
      });
    } catch (err) {
      logger.warn({ err, group }, "intercompany_scan: audit insert failed");
    }
  } catch (err) {
    summary.failures += 1;
    logger.error({ err, group }, "intercompany_scan: group failed");
    // Surface the per-group failure through the same channel the
    // front-end alert system uses to detect silent breakage.
    await recordScanFailedAudit(anchor, err, "group", { group });
  }
}

/**
 * Run one cron tick. Per-group errors are isolated (logged + audited
 * + counted in `summary.failures`); a catastrophic failure that
 * prevents even the group list from loading is rethrown so the
 * caller's retry wrapper can act on it.
 *
 * `forceDispatch` short-circuits the prefs gate and sends regardless
 * of the configured send-time / weekday — used by tests and by the
 * admin-triggered "send a test digest" action.
 */
export async function runNightlyImbalanceScan(
  options: { forceDispatch?: boolean } = {},
): Promise<NightlyScanSummary> {
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
  // Let this throw — catastrophic failures are caught by the retry
  // wrapper below.
  const groups = await getIntercompanyGroups();
  summary.groups = groups.length;
  if (groups.length === 0) return summary;
  const anchors = groups.map((g) => g[0]!);
  const prefsByAnchor = await loadGroupPrefsMap(anchors).catch((err) => {
    logger.warn({ err }, "intercompany_scan: prefs lookup failed; using defaults");
    return new Map<number, GroupPrefsView>();
  });
  for (const group of groups) {
    const anchor = group[0]!;
    const prefs =
      prefsByAnchor.get(anchor) ?? {
        anchorCompanyId: anchor,
        enabled: true,
        sendHour: 8,
        sendMinute: 0,
        timezone: "Asia/Riyadh",
        weekdaysMask: 127,
        ccEmails: [],
        bccEmails: [],
        lastSentAt: null,
      };
    await processGroup(group, prefs, summary, {
      forceDispatch: options.forceDispatch ?? false,
    });
  }
  logger.info(summary, "intercompany imbalance cron tick complete");
  return summary;
}

/**
 * Sleep for `ms` milliseconds without blocking process shutdown.
 */
function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}

/**
 * Run the scan with exponential-backoff retries on catastrophic
 * failures (e.g. transient DB outage during group lookup). Per-group
 * failures are NOT retried at this layer — they are already isolated
 * inside `runNightlyImbalanceScan` and reported via
 * `summary.failures`. Retries only fire when the run itself throws.
 *
 * Returns the summary of the first successful attempt, or `null` if
 * every attempt threw. A `scan_failed` audit row is written on each
 * failed attempt, with `scope="permanent"` after the final retry.
 */
export async function runNightlyScanWithRetries(): Promise<NightlyScanSummary | null> {
  const totalAttempts = RETRY_DELAYS_MS.length + 1;
  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      return await runNightlyImbalanceScan();
    } catch (err) {
      const isFinal = attempt === totalAttempts;
      logger.error(
        { err, attempt, totalAttempts, isFinal },
        "nightly intercompany scan: run threw",
      );
      const companyId = await firstCompanyIdForFailureAudit();
      if (companyId !== null) {
        await recordScanFailedAudit(
          companyId,
          err,
          isFinal ? "permanent" : "run",
          { attempt, totalAttempts },
        );
      }
      if (isFinal) {
        logger.error(
          { attempt, totalAttempts },
          "nightly intercompany scan: retries exhausted, giving up until next scheduled run",
        );
        return null;
      }
      const wait = RETRY_DELAYS_MS[attempt - 1]!;
      logger.warn({ wait, nextAttempt: attempt + 1 }, "nightly intercompany scan: backing off before retry");
      await delay(wait);
    }
  }
  return null;
}

let started = false;
export function startNightlyImbalanceScan(): void {
  if (started) return;
  started = true;
  setTimeout(() => {
    void runNightlyScanWithRetries();
    setInterval(() => void runNightlyScanWithRetries(), TICK_INTERVAL_MS).unref();
  }, FIRST_RUN_DELAY_MS).unref();
}
