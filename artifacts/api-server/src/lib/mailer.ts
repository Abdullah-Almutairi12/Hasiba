import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "./logger.js";

export type MailMessage = {
  to: string;
  subject: string;
  body: string;
};

export type MailDispatchResult =
  | { sent: true; provider: "smtp"; messageId: string }
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
      subject: msg.subject,
      text: msg.body,
    });
    logger.info({ to: msg.to, messageId: info.messageId }, "mail.sent");
    return { sent: true, provider: "smtp", messageId: info.messageId };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ err, to: msg.to }, "mail.send_failed");
    return { sent: false, reason };
  }
}
