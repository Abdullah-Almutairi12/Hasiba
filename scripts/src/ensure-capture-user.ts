/**
 * Idempotently upsert the dedicated docs-capture user so the
 * Playwright-driven screenshot script can log in without depending on
 * a full seed run.
 *
 * Required env (NO defaults — we refuse to provision a privileged
 * account with a predictable password):
 *
 *   DOCS_CAPTURE_EMAIL     — login email for the capture bot.
 *   DOCS_CAPTURE_PASSWORD  — password. Must be >= 16 chars.
 *
 * The user is created with role=manager so it can reach every page
 * that ships in the user manual. Operators MUST run this against a
 * dedicated demo tenant — see scripts/docs-capture.sh for the
 * environment safety gate that enforces this.
 */
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

const EMAIL = process.env.DOCS_CAPTURE_EMAIL ?? "";
const PASSWORD = process.env.DOCS_CAPTURE_PASSWORD ?? "";

function fail(msg: string): never {
  console.error(`[ensure-capture-user] ${msg}`);
  process.exit(1);
}

async function main() {
  if (!EMAIL) {
    fail("DOCS_CAPTURE_EMAIL is required (no default).");
  }
  if (!PASSWORD) {
    fail("DOCS_CAPTURE_PASSWORD is required (no default).");
  }
  if (PASSWORD.length < 16) {
    fail(
      "DOCS_CAPTURE_PASSWORD must be at least 16 characters — this account is created with role=manager.",
    );
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, EMAIL))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(usersTable)
      .set({ passwordHash, role: "manager", isActive: true })
      .where(eq(usersTable.email, EMAIL));
    console.log(`[ensure-capture-user] refreshed ${EMAIL}`);
  } else {
    await db.insert(usersTable).values({
      name: "Docs Capture Bot",
      email: EMAIL,
      passwordHash,
      role: "manager",
      isActive: true,
      has2fa: false,
    });
    console.log(`[ensure-capture-user] created ${EMAIL}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[ensure-capture-user] fatal:", err);
    process.exit(1);
  });
