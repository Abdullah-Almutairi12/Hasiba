import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { accountDigest, accountEncryptionReady, openAccountSecret } from "./account-crypto";
import { accountRows, AccountSecurityError, lockAccount } from "./account-security";
import { isMailerConfigured, sendMail } from "./mailer";

// No automatic activation from shared SMTP credentials. A deployment operator
// must explicitly authorize this channel and configure its trusted public URL.
export function accountRecoveryDeliveryConfig(): { resetUrl: string } | null {
  if (process.env.ACCOUNT_RECOVERY_DELIVERY_ENABLED !== "true" || !accountEncryptionReady() || !isMailerConfigured()) return null;
  try {
    const url = new URL(process.env.ACCOUNT_RECOVERY_RESET_URL ?? "");
    const isolated = process.env.NODE_ENV === "test" && process.env.ACCOUNT_ISOLATED_TEST === "true";
    const loopback = ["127.0.0.1", "localhost", "[::1]"];
    if (isolated && !loopback.includes(process.env.SMTP_HOST ?? "")) return null;
    if (url.protocol !== "https:" && !(isolated && url.protocol === "http:" && loopback.includes(url.hostname))) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    if (!process.env.SMTP_FROM) return null;
    return { resetUrl: url.toString() };
  } catch { return null; }
}

/**
 * SMTP acceptance is not mailbox delivery. Provider outcomes never reach the
 * anonymous request response. Retry reuses the same reset token and expiry.
 * Consistent lock ordering: account fence/identity, then outbox row.
 */
export async function dispatchAccountRecovery(): Promise<{ accepted: number; failed: number; discarded: number }> {
  const totals = { accepted: 0, failed: 0, discarded: 0 };
  const config = accountRecoveryDeliveryConfig();
  if (!config) return totals;
  const due = await accountRows(db, sql`SELECT id,user_id FROM account_recovery_outbox
    WHERE status IN ('prepared','failed') AND attempts<5 AND next_attempt_at<=clock_timestamp()
    ORDER BY created_at LIMIT 10`);
  for (const candidate of due) {
    const outcome = await db.transaction(async tx => {
      let a;
      try { a = await lockAccount(tx, candidate.user_id); }
      catch (error) {
        if (!(error instanceof AccountSecurityError) || error.status !== 401) throw error;
        await tx.execute(sql`UPDATE account_recovery_outbox SET status='cancelled',encrypted_payload='',error_code='inactive'
          WHERE id=${candidate.id} AND status IN ('prepared','failed')`);
        return "discarded" as const;
      }
      const [row] = await accountRows(tx, sql`SELECT o.*,r.expires_at,r.consumed_at,r.credential_epoch,
        r.expires_at>clock_timestamp() AS valid FROM account_recovery_outbox o
        LEFT JOIN account_password_resets r ON r.token_hash=o.token_hash
        WHERE o.id=${candidate.id} AND o.status IN ('prepared','failed') AND o.attempts<5
        AND o.next_attempt_at<=clock_timestamp() FOR UPDATE OF o SKIP LOCKED`);
      if (!row) return null;
      const discard = async (state: "expired" | "cancelled", code: string) => {
        await tx.execute(sql`UPDATE account_recovery_outbox SET status=${state},encrypted_payload='',error_code=${code}
          WHERE id=${row.id}`);
        return "discarded" as const;
      };
      if (!row.valid) return discard("expired", "expired");
      if (row.consumed_at || row.credential_epoch !== a.credential_epoch || !a.is_active)
        return discard("cancelled", "invalidated");
      let payload: { email: string; token: string };
      try {
        payload = JSON.parse(openAccountSecret(a.id, "password-reset", row.encrypted_payload));
        if (payload.email !== a.email || !payload.token || accountDigest(payload.token) !== row.token_hash)
          return discard("cancelled", "payload_mismatch");
      } catch { return discard("cancelled", "payload_invalid"); }
      const link = new URL(config.resetUrl);
      link.hash = `token=${encodeURIComponent(payload.token)}`;
      // No attachments, tracking images, tenant data or secrets in logs/errors.
      let result;
      try {
        result = await sendMail({
          to: payload.email,
          subject: "حاسبة — إعادة تعيين كلمة المرور",
          body: `طلبت إعادة تعيين كلمة مرور حسابك في حاسبة.\n${link.toString()}\nينتهي الرابط بعد 15 دقيقة من الطلب. إذا لم تطلب ذلك فتجاهل الرسالة. لا تشارك الرابط. تغيير كلمة المرور لا يلغي تطبيق المصادقة.`,
        }, { sensitive: true });
      } catch { result = { sent: false as const, reason: "transport_failure" }; }
      const email = payload.email.toLowerCase();
      const accepted = result.sent && result.accepted.includes(email) && !result.rejected.includes(email) && !result.pending.includes(email);
      const attempts = Number(row.attempts) + 1;
      if (accepted) {
        await tx.execute(sql`UPDATE account_recovery_outbox SET status='sent',attempts=${attempts},
          accepted_at=clock_timestamp(),encrypted_payload='',error_code=NULL WHERE id=${row.id}`);
        return "accepted" as const;
      }
      // Do not retain provider error strings: they may contain a recipient/token.
      const error = result.sent ? (result.rejected.includes(email) ? "smtp_rejected" : "smtp_unconfirmed") : "transport_failed";
      await tx.execute(sql`UPDATE account_recovery_outbox SET status='failed',attempts=${attempts},error_code=${error},
        encrypted_payload=CASE WHEN ${attempts}>=5 THEN '' ELSE encrypted_payload END,
        next_attempt_at=clock_timestamp()+(${Math.min(300, 30 * 2 ** (attempts - 1))}*interval '1 second')
        WHERE id=${row.id}`);
      return "failed" as const;
    });
    if (outcome) totals[outcome]++;
  }
  return totals;
}

export function startAccountRecoveryWorker() {
  let running = false;
  const timer = setInterval(async () => {
    if (running || !accountRecoveryDeliveryConfig()) return;
    running = true;
    try { await dispatchAccountRecovery(); }
    catch { /* Keep the durable row for retry. Never log transport or token data. */ }
    finally { running = false; }
  }, 15_000);
  timer.unref();
  return timer;
}
