import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "./logger.js";

export type MailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

export type MailMessage = {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  attachments?: MailAttachment[];
};

export type RecipientDeliveryStatus =
  | "delivered"
  | "bounced"
  | "pending"
  | "deferred";

export interface RecipientStatusRow {
  email: string;
  status: RecipientDeliveryStatus;
  reason: string | null;
  deliveredAt: Date | null;
}

export type MailDispatchResult =
  | {
      sent: true;
      provider: "smtp";
      messageId: string;
      /**
       * Per-recipient SMTP envelope from nodemailer. `accepted` are
       * addresses the receiving server acknowledged at submit time,
       * `rejected` were refused outright (typically hard bounces),
       * and `pending` are awaiting an async DSN. Lower-cased for
       * stable matching against stored recipient rows.
       */
      accepted: string[];
      rejected: string[];
      pending: string[];
    }
  | { sent: false; reason: string };

let cachedTransport: Transporter | null = null;
let cachedConfigKey: string | null = null;

function getTransport(sensitive = false): Transporter | null {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !port) return null;
  const key = `${host}:${port}:${user ?? ""}:${sensitive}`;
  if (cachedTransport && cachedConfigKey === key) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host,
    port: Number(port),
    secure: process.env.SMTP_SECURE === "true",
    auth: user && pass ? { user, pass } : undefined,
    requireTLS: sensitive && !["127.0.0.1", "::1", "localhost"].includes(host),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  cachedConfigKey = key;
  return cachedTransport;
}

export function isMailerConfigured(): boolean {
  return getTransport() !== null;
}

export async function sendMail(msg: MailMessage, options: { sensitive?: boolean } = {}): Promise<MailDispatchResult> {
  const transport = getTransport(options.sensitive);
  if (!transport) {
    return {
      sent: false,
      reason:
        "البريد غير مُهيأ — يرجى ضبط SMTP_HOST/SMTP_PORT (واختيارياً SMTP_USER/SMTP_PASS) لإرسال الرسائل فعلياً",
    };
  }
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "no-reply@example.com";
  try {
    const info = await transport.sendMail({
      from,
      to: msg.to,
      cc: msg.cc,
      bcc: msg.bcc,
      subject: msg.subject,
      text: msg.body,
      attachments: msg.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
    const norm = (xs: unknown): string[] =>
      Array.isArray(xs)
        ? xs
            .map((x) =>
              typeof x === "string"
                ? x.trim().toLowerCase()
                : typeof x === "object" && x !== null && "address" in x
                  ? String((x as { address: unknown }).address ?? "")
                      .trim()
                      .toLowerCase()
                  : "",
            )
            .filter((s) => s.length > 0)
        : [];
    const accepted = norm((info as { accepted?: unknown }).accepted);
    const rejected = norm((info as { rejected?: unknown }).rejected);
    const pending = norm((info as { pending?: unknown }).pending);
    if (!options.sensitive) logger.info(
      {
        to: msg.to,
        messageId: info.messageId,
        accepted: accepted.length,
        rejected: rejected.length,
        pending: pending.length,
      },
      "mail.sent",
    );
    return {
      sent: true,
      provider: "smtp",
      messageId: info.messageId,
      accepted,
      rejected,
      pending,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (!options.sensitive) logger.error({ err, to: msg.to }, "mail.send_failed");
    return { sent: false, reason };
  }
}

/**
 * Task #208 — generic per-recipient delivery status helper.
 *
 * Given the dispatch result from `sendMail` and the list of recipient
 * addresses we tried to send to, return a `{email, status, reason,
 * deliveredAt}` row per recipient. Used by every `sendMail` call site
 * that persists a send record (cleanup-report, sales invoice / quotation
 * outbox, procurement PO outbox, …) so admins get the same bounce
 * visibility everywhere — not just the cleanup-report case where it
 * shipped first.
 *
 * Semantics mirror the inline logic that used to live in
 * `recordSendAttempt` for the cleanup report:
 *   - dispatch failed entirely → every recipient is `bounced` with
 *     the SMTP error as the reason. This is the SAME failure-handling
 *     the cleanup-report path used, kept here so all outboxes agree.
 *   - dispatch succeeded:
 *       rejected[]  → 'bounced'  (reason='smtp_rejected')
 *       accepted[]  → 'delivered' (deliveredAt=now)
 *       pending[]   → 'pending'
 *       not in any  → 'pending'   (relay accepted without telling us
 *                                   per-recipient — typical for SMTP
 *                                   relays that fan out async; a later
 *                                   bounce webhook will flip the row).
 */
export function recipientStatusesFromDispatch(
  dispatch: MailDispatchResult,
  recipients: string[],
): RecipientStatusRow[] {
  if (!dispatch.sent) {
    const reason = dispatch.reason ?? "send_failed";
    return recipients.map((email) => ({
      email,
      status: "bounced",
      reason,
      deliveredAt: null,
    }));
  }
  const accepted = new Set(dispatch.accepted.map((e) => e.toLowerCase()));
  const rejected = new Set(dispatch.rejected.map((e) => e.toLowerCase()));
  const pending = new Set(dispatch.pending.map((e) => e.toLowerCase()));
  const now = new Date();
  return recipients.map((email) => {
    const key = email.trim().toLowerCase();
    if (rejected.has(key)) {
      return { email, status: "bounced", reason: "smtp_rejected", deliveredAt: null };
    }
    if (accepted.has(key)) {
      return { email, status: "delivered", reason: null, deliveredAt: now };
    }
    if (pending.has(key)) {
      return { email, status: "pending", reason: null, deliveredAt: null };
    }
    return { email, status: "pending", reason: null, deliveredAt: null };
  });
}
