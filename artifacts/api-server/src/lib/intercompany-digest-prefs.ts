/**
 * Helpers around the per-group + per-user preferences that govern the
 * morning intercompany imbalance digest.
 *
 * - Group prefs are keyed by the "anchor" company id, which is the
 *   lowest companyId in a connected intercompany group. This matches
 *   the convention already used by `runNightlyImbalanceScan` when it
 *   stamps the audit row for a group.
 * - User prefs hold the opt-out flag and a per-user unsubscribe token
 *   that the email footer surfaces so finance can self-serve without
 *   needing to log in.
 *
 * All accessors here are idempotent: missing rows are auto-created
 * with defaults so the cron and the API surface can treat the row as
 * always existing.
 */

import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  intercompanyDigestGroupPrefsTable,
  intercompanyDigestUserPrefsTable,
  userCompaniesTable,
  usersTable,
  type IntercompanyDigestGroupPrefs,
  type IntercompanyDigestUserPrefs,
} from "@workspace/db";

export const DEFAULT_GROUP_PREFS = {
  enabled: true,
  sendHour: 8,
  sendMinute: 0,
  timezone: "Asia/Riyadh",
  weekdaysMask: 127, // every day
  ccEmails: [] as string[],
  bccEmails: [] as string[],
} as const;

export type GroupPrefsView = {
  anchorCompanyId: number;
  enabled: boolean;
  sendHour: number;
  sendMinute: number;
  timezone: string;
  weekdaysMask: number;
  ccEmails: string[];
  bccEmails: string[];
  lastSentAt: string | null;
};

export function rowToGroupPrefsView(
  row: IntercompanyDigestGroupPrefs,
): GroupPrefsView {
  return {
    anchorCompanyId: row.anchorCompanyId,
    enabled: row.enabled,
    sendHour: row.sendHour,
    sendMinute: row.sendMinute,
    timezone: row.timezone,
    weekdaysMask: row.weekdaysMask,
    ccEmails: row.ccEmails ?? [],
    bccEmails: row.bccEmails ?? [],
    lastSentAt: row.lastSentAt ? row.lastSentAt.toISOString() : null,
  };
}

export function defaultsForAnchor(anchorCompanyId: number): GroupPrefsView {
  return {
    anchorCompanyId,
    enabled: DEFAULT_GROUP_PREFS.enabled,
    sendHour: DEFAULT_GROUP_PREFS.sendHour,
    sendMinute: DEFAULT_GROUP_PREFS.sendMinute,
    timezone: DEFAULT_GROUP_PREFS.timezone,
    weekdaysMask: DEFAULT_GROUP_PREFS.weekdaysMask,
    ccEmails: [],
    bccEmails: [],
    lastSentAt: null,
  };
}

/** Load prefs for one anchor, returning defaults (without persisting) when missing. */
export async function loadGroupPrefs(
  anchorCompanyId: number,
): Promise<GroupPrefsView> {
  const [row] = await db
    .select()
    .from(intercompanyDigestGroupPrefsTable)
    .where(eq(intercompanyDigestGroupPrefsTable.anchorCompanyId, anchorCompanyId))
    .limit(1);
  if (!row) return defaultsForAnchor(anchorCompanyId);
  return rowToGroupPrefsView(row);
}

/** Bulk variant for the cron tick. */
export async function loadGroupPrefsMap(
  anchorIds: number[],
): Promise<Map<number, GroupPrefsView>> {
  const out = new Map<number, GroupPrefsView>();
  if (anchorIds.length === 0) return out;
  const rows = await db
    .select()
    .from(intercompanyDigestGroupPrefsTable)
    .where(inArray(intercompanyDigestGroupPrefsTable.anchorCompanyId, anchorIds));
  for (const r of rows) out.set(r.anchorCompanyId, rowToGroupPrefsView(r));
  for (const id of anchorIds) if (!out.has(id)) out.set(id, defaultsForAnchor(id));
  return out;
}

export interface UpdateGroupPrefsInput {
  enabled: boolean;
  sendHour: number;
  sendMinute: number;
  timezone: string;
  weekdaysMask: number;
  ccEmails: string[];
  bccEmails: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmailList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const v = raw.trim().toLowerCase();
    if (!v || !EMAIL_RE.test(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export function validateGroupPrefs(input: UpdateGroupPrefsInput): string | null {
  if (typeof input.enabled !== "boolean") return "enabled must be boolean";
  if (!Number.isInteger(input.sendHour) || input.sendHour < 0 || input.sendHour > 23)
    return "sendHour must be 0..23";
  if (
    !Number.isInteger(input.sendMinute) ||
    input.sendMinute < 0 ||
    input.sendMinute > 59
  )
    return "sendMinute must be 0..59";
  if (typeof input.timezone !== "string" || !input.timezone.trim())
    return "timezone is required";
  try {
    // Throws RangeError on bogus tz.
    new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
  } catch {
    return "timezone is not a valid IANA name";
  }
  if (
    !Number.isInteger(input.weekdaysMask) ||
    input.weekdaysMask < 0 ||
    input.weekdaysMask > 127
  )
    return "weekdaysMask must be 0..127";
  return null;
}

export async function upsertGroupPrefs(
  anchorCompanyId: number,
  input: UpdateGroupPrefsInput,
  updatedBy: number | null,
): Promise<GroupPrefsView> {
  const cc = normaliseEmailList(input.ccEmails);
  const bcc = normaliseEmailList(input.bccEmails);
  const [row] = await db
    .insert(intercompanyDigestGroupPrefsTable)
    .values({
      anchorCompanyId,
      enabled: input.enabled,
      sendHour: input.sendHour,
      sendMinute: input.sendMinute,
      timezone: input.timezone,
      weekdaysMask: input.weekdaysMask,
      ccEmails: cc,
      bccEmails: bcc,
      updatedBy,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: intercompanyDigestGroupPrefsTable.anchorCompanyId,
      set: {
        enabled: input.enabled,
        sendHour: input.sendHour,
        sendMinute: input.sendMinute,
        timezone: input.timezone,
        weekdaysMask: input.weekdaysMask,
        ccEmails: cc,
        bccEmails: bcc,
        updatedBy,
        updatedAt: new Date(),
      },
    })
    .returning();
  return rowToGroupPrefsView(row!);
}

export async function markGroupSent(
  anchorCompanyId: number,
  when: Date,
): Promise<void> {
  // Insert-if-missing so a successful first send creates the prefs row
  // at defaults, with lastSentAt stamped.
  await db
    .insert(intercompanyDigestGroupPrefsTable)
    .values({
      anchorCompanyId,
      lastSentAt: when,
    })
    .onConflictDoUpdate({
      target: intercompanyDigestGroupPrefsTable.anchorCompanyId,
      set: { lastSentAt: when },
    });
}

// -------- user prefs --------

function newToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function getOrCreateUserPrefs(
  userId: number,
): Promise<IntercompanyDigestUserPrefs> {
  const [existing] = await db
    .select()
    .from(intercompanyDigestUserPrefsTable)
    .where(eq(intercompanyDigestUserPrefsTable.userId, userId))
    .limit(1);
  if (existing) return existing;
  const [row] = await db
    .insert(intercompanyDigestUserPrefsTable)
    .values({ userId, unsubscribeToken: newToken() })
    .onConflictDoUpdate({
      target: intercompanyDigestUserPrefsTable.userId,
      set: { updatedAt: new Date() },
    })
    .returning();
  return row!;
}

export async function setUserOptedOut(
  userId: number,
  optedOut: boolean,
): Promise<IntercompanyDigestUserPrefs> {
  await getOrCreateUserPrefs(userId);
  const [row] = await db
    .update(intercompanyDigestUserPrefsTable)
    .set({ optedOut, updatedAt: new Date() })
    .where(eq(intercompanyDigestUserPrefsTable.userId, userId))
    .returning();
  return row!;
}

/** Returns the user record + the prefs row, or null on bad token. */
export async function lookupByUnsubscribeToken(
  token: string,
): Promise<{ user: { id: number; name: string; email: string }; prefs: IntercompanyDigestUserPrefs } | null> {
  if (!token) return null;
  const [row] = await db
    .select({
      prefs: intercompanyDigestUserPrefsTable,
      userId: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
    })
    .from(intercompanyDigestUserPrefsTable)
    .innerJoin(usersTable, eq(usersTable.id, intercompanyDigestUserPrefsTable.userId))
    .where(eq(intercompanyDigestUserPrefsTable.unsubscribeToken, token))
    .limit(1);
  if (!row || !row.email) return null;
  return {
    user: { id: row.userId, name: row.name, email: row.email },
    prefs: row.prefs,
  };
}

/**
 * For a connected company group, return the active opt-in finance
 * users with their email + per-user unsubscribe token. Rows are
 * deduped by user id so a user with access to multiple companies in
 * the group only appears once.
 */
export interface DigestRecipient {
  userId: number;
  email: string;
  unsubscribeToken: string;
}

const FINANCE_ROLES = ["owner", "manager", "accountant"];

export async function loadOptedInRecipients(
  group: number[],
): Promise<DigestRecipient[]> {
  if (group.length === 0) return [];
  const rows = await db
    .selectDistinct({
      userId: usersTable.id,
      email: usersTable.email,
    })
    .from(userCompaniesTable)
    .innerJoin(usersTable, eq(usersTable.id, userCompaniesTable.userId))
    .where(
      and(
        inArray(userCompaniesTable.companyId, group),
        inArray(userCompaniesTable.role, FINANCE_ROLES),
        eq(usersTable.isActive, true),
      ),
    );
  if (rows.length === 0) return [];
  const userIds = rows.map((r) => r.userId);
  const prefRows = await db
    .select()
    .from(intercompanyDigestUserPrefsTable)
    .where(inArray(intercompanyDigestUserPrefsTable.userId, userIds));
  const prefByUser = new Map<number, IntercompanyDigestUserPrefs>();
  for (const p of prefRows) prefByUser.set(p.userId, p);

  // Auto-provision tokens for users without a prefs row so the email
  // footer can include an unsubscribe link on the first send.
  const missingIds = userIds.filter((id) => !prefByUser.has(id));
  if (missingIds.length > 0) {
    const inserted = await db
      .insert(intercompanyDigestUserPrefsTable)
      .values(
        missingIds.map((userId) => ({ userId, unsubscribeToken: newToken() })),
      )
      .onConflictDoNothing({ target: intercompanyDigestUserPrefsTable.userId })
      .returning();
    for (const p of inserted) prefByUser.set(p.userId, p);
    // Anyone still missing (rare conflict race) — refetch.
    const stillMissing = missingIds.filter((id) => !prefByUser.has(id));
    if (stillMissing.length > 0) {
      const refetched = await db
        .select()
        .from(intercompanyDigestUserPrefsTable)
        .where(inArray(intercompanyDigestUserPrefsTable.userId, stillMissing));
      for (const p of refetched) prefByUser.set(p.userId, p);
    }
  }

  const out: DigestRecipient[] = [];
  const seen = new Set<number>();
  for (const r of rows) {
    if (seen.has(r.userId)) continue;
    seen.add(r.userId);
    const email = r.email?.trim().toLowerCase();
    if (!email) continue;
    const prefs = prefByUser.get(r.userId);
    if (prefs?.optedOut) continue;
    out.push({
      userId: r.userId,
      email,
      unsubscribeToken: prefs?.unsubscribeToken ?? newToken(),
    });
  }
  out.sort((a, b) => a.email.localeCompare(b.email));
  return out;
}

// -------- schedule arithmetic --------

/**
 * Decide whether the digest for an anchor should fire on a given tick.
 *
 * Rules:
 *   - prefs.enabled must be true
 *   - the current weekday (in the configured tz) must be allowed by weekdaysMask
 *   - the configured hh:mm in tz must have been reached at-or-before `now`
 *   - we must not have already sent today (in tz)
 */
export function shouldDispatchNow(
  prefs: GroupPrefsView,
  now: Date,
): boolean {
  if (!prefs.enabled) return false;
  let parts: Record<string, string>;
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: prefs.timezone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    parts = Object.fromEntries(
      fmt.formatToParts(now).map((p) => [p.type, p.value]),
    );
  } catch {
    return false;
  }
  const WEEKDAY_INDEX: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dow = WEEKDAY_INDEX[parts.weekday ?? ""];
  if (dow === undefined) return false;
  if (((prefs.weekdaysMask >> dow) & 1) === 0) return false;
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  if (hour < prefs.sendHour) return false;
  if (hour === prefs.sendHour && minute < prefs.sendMinute) return false;
  const todayKey = `${parts.year}-${parts.month}-${parts.day}`;
  if (prefs.lastSentAt) {
    const lastDate = new Date(prefs.lastSentAt);
    if (Number.isFinite(lastDate.getTime())) {
      try {
        const lastFmt = new Intl.DateTimeFormat("en-US", {
          timeZone: prefs.timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        const lp = Object.fromEntries(
          lastFmt.formatToParts(lastDate).map((p) => [p.type, p.value]),
        );
        const lastKey = `${lp.year}-${lp.month}-${lp.day}`;
        if (lastKey === todayKey) return false;
      } catch {
        // ignore; fall through to send
      }
    }
  }
  return true;
}
