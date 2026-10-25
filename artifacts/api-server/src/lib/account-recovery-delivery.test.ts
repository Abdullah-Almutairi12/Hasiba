import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { db, pool, usersTable } from "@workspace/db";
import { assertApplicationReady } from "../app";
import { dispatchAccountRecovery, accountRecoveryDeliveryConfig } from "./account-recovery-delivery";
import { requestAccountReset, readAccountTestOutbox, finishAccountReset } from "./account-reset";
import { accountDigest } from "./account-crypto";

// Real SMTP protocol over loopback, no external provider, stored MIME only in
// process memory. No token/recipient is printed or placed in test evidence.
let reject = false;
let dropAck = false;
let submissions = 0;
let messages: string[] = [];
const sockets = new Set<Socket>();
const smtp = createServer(socket => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  socket.write("220 localhost isolated fixture\r\n");
  let buffer = "", data = false, message = "";
  socket.on("data", chunk => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      if (data) {
        if (line === ".") {
          messages.push(message); submissions++; message = ""; data = false;
          if (dropAck) socket.destroy(); else socket.write("250 accepted by local fixture only\r\n");
        } else message += line + "\r\n";
      } else if (/^EHLO|^HELO/i.test(line)) socket.write("250 localhost\r\n");
      else if (/^MAIL FROM/i.test(line)) socket.write("250 sender ok\r\n");
      else if (/^RCPT TO/i.test(line)) socket.write(reject ? "450 retry fixture\r\n" : "250 recipient ok\r\n");
      else if (/^DATA/i.test(line)) { data = true; socket.write("354 end with dot\r\n"); }
      else if (/^QUIT/i.test(line)) { socket.end("221 goodbye\r\n"); }
      else socket.write("250 ok\r\n");
    }
  });
});
const q = async (text: string, args: unknown[] = []) => (await pool.query(text, args)).rows;
async function fixture() {
  const [u] = await db.insert(usersTable).values({
    name: "مصطنع لقناة الاستعادة", email: `recovery-${randomUUID()}@example.invalid`,
    passwordHash: "not-a-login-fixture", role: "owner", isActive: true,
  }).returning();
  await requestAccountReset(u.email!);
  return { u, token: readAccountTestOutbox(u.email!)[0] };
}
beforeAll(async () => {
  if (process.env.NODE_ENV !== "test" || process.env.ACCOUNT_ISOLATED_TEST !== "true" ||
    !process.env.DATABASE_URL?.includes("/hasba_test_")) throw Error("Requires disposable isolated database");
  await assertApplicationReady();
  await new Promise<void>(resolve => smtp.listen(0, "127.0.0.1", resolve));
  const address = smtp.address();
  if (!address || typeof address === "string") throw Error("Missing local SMTP");
  vi.stubEnv("SMTP_HOST", "127.0.0.1"); vi.stubEnv("SMTP_PORT", String(address.port));
  vi.stubEnv("SMTP_USER", ""); vi.stubEnv("SMTP_PASS", ""); vi.stubEnv("SMTP_SECURE", "false");
  vi.stubEnv("SMTP_FROM", "fixture@example.invalid");
  vi.stubEnv("ACCOUNT_RECOVERY_DELIVERY_ENABLED", "true");
  vi.stubEnv("ACCOUNT_RECOVERY_RESET_URL", "http://127.0.0.1/account/password");
});
afterAll(async () => {
  vi.unstubAllEnvs(); for (const socket of sockets) socket.destroy();
  await new Promise<void>(resolve => smtp.close(() => resolve()));
});
describe("recovery outbox via existing mailer and isolated real SMTP", () => {
  it("requires explicit activation, trusted URL and local test transport", async () => {
    await fixture(); const before = submissions;
    vi.stubEnv("ACCOUNT_RECOVERY_DELIVERY_ENABLED", "false");
    expect(await dispatchAccountRecovery()).toEqual({ accepted: 0, failed: 0, discarded: 0 });
    expect(submissions).toBe(before);
    vi.stubEnv("ACCOUNT_RECOVERY_DELIVERY_ENABLED", "true");
    vi.stubEnv("ACCOUNT_RECOVERY_RESET_URL", "https://user:pass@example.invalid/account/password");
    expect(accountRecoveryDeliveryConfig()).toBeNull();
    vi.stubEnv("ACCOUNT_RECOVERY_RESET_URL", "http://127.0.0.1/account/password");
    vi.stubEnv("SMTP_HOST", "never-contact.example.invalid");
    expect(accountRecoveryDeliveryConfig()).toBeNull();
    vi.stubEnv("SMTP_HOST", "127.0.0.1");
    await dispatchAccountRecovery();
  });
  it("submits through SMTP once under two workers; link uses a fragment and the original valid token", async () => {
    const f = await fixture(), before = submissions;
    await Promise.all([dispatchAccountRecovery(), dispatchAccountRecovery()]);
    expect(submissions - before).toBe(1);
    const [row] = await q("SELECT status,attempts,accepted_at,encrypted_payload FROM account_recovery_outbox WHERE user_id=$1", [f.u.id]);
    expect(row.status).toBe("sent"); expect(row.attempts).toBe(1);
    expect(!!row.accepted_at).toBe(true); expect(row.encrypted_payload === "").toBe(true);
    const mime = messages.at(-1)!;
    const body = /Content-Transfer-Encoding: base64/i.test(mime)
      ? Buffer.from(mime.split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\s/g, ""), "base64").toString()
      : mime.replace(/=\r\n/g, "").replace(/=3D/g, "=");
    expect(body.includes(`http://127.0.0.1/account/password#token=${f.token}`)).toBe(true);
    expect(body.includes(`?token=`)).toBe(false);
    await finishAccountReset(f.token, "Synthetic reset from SMTP test phrase!");
    const [reset] = await q("SELECT consumed_at FROM account_password_resets WHERE token_hash=$1", [accountDigest(f.token)]);
    expect(!!reset.consumed_at).toBe(true);
    messages = [];
  });
  it("persists failure without provider text, waits for backoff, retries the same token without another reset", async () => {
    const f = await fixture(), before = submissions; reject = true;
    expect((await dispatchAccountRecovery()).failed).toBe(1);
    const [failed] = await q("SELECT * FROM account_recovery_outbox WHERE user_id=$1", [f.u.id]);
    expect(failed.status).toBe("failed"); expect(failed.attempts).toBe(1);
    expect(failed.error_code).toBe("transport_failed");
    expect((await dispatchAccountRecovery()).failed).toBe(0);
    await q("UPDATE account_recovery_outbox SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE user_id=$1", [f.u.id]);
    reject = false; expect((await dispatchAccountRecovery()).accepted).toBe(1);
    expect(submissions - before).toBe(1);
    const resets = await q("SELECT token_hash FROM account_password_resets WHERE user_id=$1", [f.u.id]);
    expect(resets.length).toBe(1); expect(resets[0].token_hash === accountDigest(f.token)).toBe(true);
  });
  it("treats a lost SMTP acknowledgement as unconfirmed, retries the same message token and never creates another reset", async () => {
    const f = await fixture(), before = submissions; dropAck = true;
    expect((await dispatchAccountRecovery()).failed).toBe(1);
    const [first] = await q("SELECT status,accepted_at FROM account_recovery_outbox WHERE user_id=$1", [f.u.id]);
    expect(first.status).toBe("failed"); expect(first.accepted_at).toBeNull();
    dropAck = false;
    await q("UPDATE account_recovery_outbox SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE user_id=$1", [f.u.id]);
    expect((await dispatchAccountRecovery()).accepted).toBe(1);
    expect(submissions - before).toBe(2);
    const rows = await q("SELECT token_hash FROM account_password_resets WHERE user_id=$1", [f.u.id]);
    expect(rows.length).toBe(1); expect(rows[0].token_hash === accountDigest(f.token)).toBe(true);
  });
  it("discards expired, superseded, consumed and inactive requests without sending their secrets", async () => {
    const expired = await fixture(), superseded = await fixture(), consumed = await fixture(), inactive = await fixture();
    await q("UPDATE account_password_resets SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1", [expired.u.id]);
    await requestAccountReset(superseded.u.email!);
    await q("UPDATE account_password_resets SET consumed_at=clock_timestamp() WHERE user_id=$1", [consumed.u.id]);
    await q("UPDATE users SET is_active=false WHERE id=$1", [inactive.u.id]);
    const before = submissions, result = await dispatchAccountRecovery();
    expect(result.discarded).toBe(3); expect(submissions - before).toBe(1);
    const old = await q("SELECT status,encrypted_payload FROM account_recovery_outbox WHERE user_id=$1 ORDER BY created_at", [superseded.u.id]);
    expect(old.map(r => r.status)).toEqual(["cancelled", "sent"]);
    expect(old.every(r => r.encrypted_payload === "")).toBe(true);
  });
  it("caps retry attempts and clears terminal encrypted payload; corrupted payload is not sent", async () => {
    const exhausted = await fixture(), corrupt = await fixture();
    await q("UPDATE account_recovery_outbox SET attempts=4 WHERE user_id=$1", [exhausted.u.id]);
    await q("UPDATE account_recovery_outbox SET encrypted_payload='corrupt' WHERE user_id=$1", [corrupt.u.id]);
    reject = true; const before = submissions;
    const result = await dispatchAccountRecovery();
    expect(result.failed).toBe(1); expect(result.discarded).toBe(1);
    await q("UPDATE account_recovery_outbox SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE user_id=$1", [exhausted.u.id]);
    expect((await dispatchAccountRecovery()).failed).toBe(0);
    expect(submissions).toBe(before);
    const [row] = await q("SELECT attempts,encrypted_payload FROM account_recovery_outbox WHERE user_id=$1", [exhausted.u.id]);
    expect(row.attempts).toBe(5); expect(row.encrypted_payload === "").toBe(true);
    reject = false; messages = [];
  });
});
