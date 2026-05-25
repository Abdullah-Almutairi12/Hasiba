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

function getTransport(): Transporter | null {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !port) return null;
  const key = `${host}:${port}:${user ?? ""}`;
  if (cachedTransport && cachedConfigKey === key) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host,
    port: Number(port),
    secure: process.env.SMTP_SECURE === "true",
    auth: user && pass ? { user, pass } : undefined,
  });
  cachedConfigKey = key;
  return cachedTransport;
}

export function isMailerConfigured(): boolean {
  return getTransport() !== null;
}

export async function sendMail(msg: MailMessage): Promise<MailDispatchResult> {
  const transport = getTransport();
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
    logger.info(
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
    logger.error({ err, to: msg.to }, "mail.send_failed");
    return { sent: false, reason };
  }
}
