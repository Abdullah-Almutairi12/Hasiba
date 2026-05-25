import { pgTable, serial, text, integer, timestamp, index, uniqueIndex, numeric, boolean } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { usersTable } from "./users";

/**
 * Multi-Company Phase 5: links a source document (sales invoice OR
 * purchase order) in one company to its auto-generated mirror document
 * (supplier invoice OR sales order) in a sibling company.
 *
 * One row per source document — unique on (kind, source_doc_id). The link
 * is created inside the same DB transaction that creates the source
 * document, so its existence is a guarantee the mirror also exists.
 *
 * Status:
 *   - matched:   mirror is live and amounts match the source.
 *   - unmatched: manual review state — source and mirror amounts diverge.
 *   - void:      source was cancelled/reversed; mirror has been reversed.
 *   - resynced:  mirror was forcefully recreated via the
 *                "Send to counterparty" action after a source edit.
 */
export const intercompanyLinksTable = pgTable(
  "intercompany_links",
  {
    id: serial("id").primaryKey(),
    /** 'sales_invoice' or 'purchase_order' — what kind of source document this row mirrors. */
    kind: text("kind").notNull(),
    sourceCompanyId: integer("source_company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
    sourceDocId: integer("source_doc_id").notNull(),
    sourceRef: text("source_ref").notNull(),
    targetCompanyId: integer("target_company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
    targetDocId: integer("target_doc_id").notNull(),
    targetRef: text("target_ref").notNull(),
    status: text("status").notNull().default("matched"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqSource: uniqueIndex("intercompany_links_source_unique").on(t.kind, t.sourceDocId),
    targetIdx: index("intercompany_links_target_idx").on(t.kind, t.targetDocId),
    sourceCompanyIdx: index("intercompany_links_source_company_idx").on(t.sourceCompanyId),
  }),
);

export type IntercompanyLink = typeof intercompanyLinksTable.$inferSelect;

/**
 * Phase 6 add-on: persisted record of intercompany pricing-policy
 * mismatches. The consolidated PL/BS reports surface a transient
 * "imbalance" banner when a matched link's source and mirror amounts
 * diverge — this table turns that finding into a durable review queue
 * so finance can triage with one-click resync/void/ignore.
 *
 * One row per (link_id, basis) — `basis` is 'subtotal' for P&L-side
 * differences and 'open' for outstanding AR/AP differences. Both can
 * coexist for the same link.
 *
 * Status flow:
 *   - open:     the most recent scan still finds a mismatch.
 *   - resolved: a later scan found the amounts now agree (auto-flipped).
 *   - ignored:  finance accepted the difference (e.g. legitimate FX
 *               or rounding) and silenced it explicitly.
 */
export const intercompanyImbalancesTable = pgTable(
  "intercompany_imbalances",
  {
    id: serial("id").primaryKey(),
    linkId: integer("link_id").notNull().references(() => intercompanyLinksTable.id, { onDelete: "cascade" }),
    basis: text("basis").notNull(),
    kind: text("kind").notNull(),
    sourceCompanyId: integer("source_company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
    sourceRef: text("source_ref").notNull(),
    targetCompanyId: integer("target_company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
    targetRef: text("target_ref").notNull(),
    sourceAmount: numeric("source_amount", { precision: 18, scale: 4 }).notNull(),
    targetAmount: numeric("target_amount", { precision: 18, scale: 4 }).notNull(),
    difference: numeric("difference", { precision: 18, scale: 4 }).notNull(),
    status: text("status").notNull().default("open"),
    notes: text("notes"),
    detectedAt: timestamp("detected_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at"),
    resolvedBy: integer("resolved_by"),
  },
  (t) => ({
    uniqLinkBasis: uniqueIndex("intercompany_imbalances_link_basis_unique").on(t.linkId, t.basis),
    statusIdx: index("intercompany_imbalances_status_idx").on(t.status),
    sourceCompanyIdx: index("intercompany_imbalances_source_company_idx").on(t.sourceCompanyId),
    targetCompanyIdx: index("intercompany_imbalances_target_company_idx").on(t.targetCompanyId),
  }),
);

export type IntercompanyImbalance = typeof intercompanyImbalancesTable.$inferSelect;

/**
 * Task 150 — single-use signed action tokens embedded in the morning
 * imbalance digest email. Each row binds (recipient user, imbalance,
 * action) → opaque token. The email link opens a confirmation modal
 * in the app which then consumes the token via the public
 * `/intercompany/email-action/confirm` endpoint.
 *
 * Single-use: enforced by `consumedAt IS NULL` on lookup; consuming
 * stamps the row so a second click 404s.
 * Expiry: enforced by `expiresAt`. The digest cron sets this to 7 days.
 * Cross-tenant safety: the consumer revalidates that the bound
 * user_id still has finance access to the imbalance's source/target
 * company at the moment of click (memberships can be revoked between
 * email send and click).
 */
export const intercompanyImbalanceActionTokensTable = pgTable(
  "intercompany_imbalance_action_tokens",
  {
    id: serial("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    imbalanceId: integer("imbalance_id")
      .notNull()
      .references(() => intercompanyImbalancesTable.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    userId: integer("user_id").notNull(),
    email: text("email").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    consumedIp: text("consumed_ip"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    tokenIdx: uniqueIndex("intercompany_imbalance_action_tokens_token_idx").on(t.tokenHash),
    imbalanceIdx: index("intercompany_imbalance_action_tokens_imbalance_idx").on(t.imbalanceId),
  }),
);

export type IntercompanyImbalanceActionToken =
  typeof intercompanyImbalanceActionTokensTable.$inferSelect;

/**
 * Per-group preferences for the morning intercompany imbalance digest.
 * One row per "anchor" company (lowest companyId in a connected group).
 * The cron loads this row to decide when the group's digest should be
 * dispatched and whether finance wants cc/bcc visibility for managers
 * who don't want to be primary recipients.
 *
 * - sendHour/sendMinute + timezone: local clock the digest should aim for.
 * - weekdaysMask: bitfield with bit i representing day i (0=Sunday … 6=Saturday).
 *   Default 127 = every day.
 * - lastSentAt: stamped on a successful dispatch so the cron tick can
 *   dedupe within the same local calendar day.
 */
export const intercompanyDigestGroupPrefsTable = pgTable(
  "intercompany_digest_group_prefs",
  {
    id: serial("id").primaryKey(),
    anchorCompanyId: integer("anchor_company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    sendHour: integer("send_hour").notNull().default(8),
    sendMinute: integer("send_minute").notNull().default(0),
    timezone: text("timezone").notNull().default("Asia/Riyadh"),
    weekdaysMask: integer("weekdays_mask").notNull().default(127),
    ccEmails: text("cc_emails").array().notNull().default([] as never),
    bccEmails: text("bcc_emails").array().notNull().default([] as never),
    lastSentAt: timestamp("last_sent_at"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    updatedBy: integer("updated_by"),
  },
  (t) => ({
    anchorUnique: uniqueIndex("intercompany_digest_group_prefs_anchor_unique").on(
      t.anchorCompanyId,
    ),
  }),
);

export type IntercompanyDigestGroupPrefs =
  typeof intercompanyDigestGroupPrefsTable.$inferSelect;

/**
 * Per-user preferences for the morning intercompany digest. Currently
 * just an opt-out toggle and an unsubscribe token so the email footer
 * can offer a one-click self-service link without requiring login.
 */
export const intercompanyDigestUserPrefsTable = pgTable(
  "intercompany_digest_user_prefs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    optedOut: boolean("opted_out").notNull().default(false),
    unsubscribeToken: text("unsubscribe_token").notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userUnique: uniqueIndex("intercompany_digest_user_prefs_user_unique").on(
      t.userId,
    ),
    tokenUnique: uniqueIndex("intercompany_digest_user_prefs_token_unique").on(
      t.unsubscribeToken,
    ),
  }),
);

export type IntercompanyDigestUserPrefs =
  typeof intercompanyDigestUserPrefsTable.$inferSelect;
