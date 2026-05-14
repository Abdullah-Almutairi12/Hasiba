import { Router } from "express";
import rateLimit from "express-rate-limit";
import { randomBytes } from "crypto";
import { z } from "zod";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  db,
  customersTable,
  suppliersTable,
  employeesTable,
  portalInvitationsTable,
  portalSessionsTable,
  type PortalKind,
} from "@workspace/db";
import { sendMail } from "../lib/mailer";
import { hashToken, requirePortalSession } from "../middlewares/require-portal-session";

const router = Router();

const requestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "محاولات كثيرة جداً، يرجى المحاولة لاحقاً" },
});

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const PortalEnum = z.enum(["customer", "supplier", "employee"]);

const RequestBody = z.object({
  portal: PortalEnum,
  email: z.string().email(),
});

async function findPrincipal(portal: PortalKind, email: string): Promise<number | null> {
  const lower = email.toLowerCase();
  if (portal === "customer") {
    const [r] = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(eq(customersTable.email, lower))
      .limit(1);
    return r?.id ?? null;
  }
  if (portal === "supplier") {
    const [r] = await db
      .select({ id: suppliersTable.id })
      .from(suppliersTable)
      .where(eq(suppliersTable.email, lower))
      .limit(1);
    return r?.id ?? null;
  }
  const [r] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(eq(employeesTable.email, lower))
    .limit(1);
  return r?.id ?? null;
}

/**
 * Request a magic link. We never reveal whether the email exists — always
 * return 200 with a generic message. If a matching principal is found, we
 * email a single-use link; otherwise we silently no-op.
 */
router.post("/portal/auth/request-magic-link", requestLimiter, async (req, res) => {
  try {
    const parsed = RequestBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });
    const { portal, email } = parsed.data;

    const principalId = await findPrincipal(portal, email);
    if (principalId == null) {
      // Pretend success.
      return res.json({ ok: true, message: "إذا كان البريد مسجلاً سيصلك رابط الدخول" });
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await db.insert(portalInvitationsTable).values({
      portal,
      email: email.toLowerCase(),
      principalId,
      tokenHash,
      purpose: "magic_link",
      expiresAt,
    });

    const base =
      (process.env.PUBLIC_APP_URL ?? "").replace(/\/$/, "") ||
      (process.env.REPLIT_DOMAINS?.split(",")[0]
        ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`
        : "");
    const link = `${base}/portal/verify?token=${encodeURIComponent(token)}&portal=${portal}`;

    const result = await sendMail({
      to: email,
      subject: "رابط الدخول إلى بوابتك — حاسبة.AI",
      body: `اضغط الرابط التالي للدخول إلى بوابتك (ينتهي خلال 30 دقيقة):\n\n${link}\n\nإذا لم تطلب هذا الرابط فيمكنك تجاهل هذه الرسالة.`,
    });
    if (!result.sent) {
      // Mail not configured — surface link in logs so dev still works.
      req.log.warn({ link, reason: result.reason }, "portal.magic_link.email_skipped");
    }
    return res.json({
      ok: true,
      message: "إذا كان البريد مسجلاً سيصلك رابط الدخول",
      // Echo link only in development so the dev console can copy it.
      devLink: process.env.NODE_ENV !== "production" ? link : undefined,
    });
  } catch (err) {
    req.log.error({ err }, "portal request magic link failed");
    return res.status(500).json({ error: "حدث خطأ في الخادم" });
  }
});

const VerifyBody = z.object({
  token: z.string().min(10),
});

router.post("/portal/auth/verify", verifyLimiter, async (req, res) => {
  try {
    const parsed = VerifyBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });
    const tokenHash = hashToken(parsed.data.token);

    const [inv] = await db
      .select()
      .from(portalInvitationsTable)
      .where(
        and(
          eq(portalInvitationsTable.tokenHash, tokenHash),
          isNull(portalInvitationsTable.consumedAt),
          gt(portalInvitationsTable.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!inv) return res.status(401).json({ error: "رابط غير صالح أو منتهي" });

    // Consume invite + open a portal session in a single transaction.
    const sessionToken = randomBytes(32).toString("base64url");
    const sessionHash = hashToken(sessionToken);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

    await db.transaction(async (tx) => {
      await tx
        .update(portalInvitationsTable)
        .set({ consumedAt: new Date() })
        .where(eq(portalInvitationsTable.id, inv.id));
      await tx.insert(portalSessionsTable).values({
        portal: inv.portal,
        principalId: inv.principalId,
        email: inv.email,
        tokenHash: sessionHash,
        ip: req.ip ?? null,
        userAgent: (req.headers["user-agent"] as string) ?? null,
        expiresAt,
      });
    });

    return res.json({
      token: sessionToken,
      portal: inv.portal,
      email: inv.email,
      principalId: inv.principalId,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "portal verify failed");
    return res.status(500).json({ error: "حدث خطأ في الخادم" });
  }
});

router.post("/portal/auth/logout", async (req, res) => {
  try {
    // Anonymous if no token; otherwise revoke.
    const auth = req.headers.authorization;
    if (auth && typeof auth === "string") {
      const [, value] = auth.split(/\s+/);
      if (value) {
        await db
          .update(portalSessionsTable)
          .set({ revokedAt: new Date() })
          .where(eq(portalSessionsTable.tokenHash, hashToken(value)));
      }
    }
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "portal logout failed");
    return res.status(500).json({ error: "حدث خطأ في الخادم" });
  }
});

router.get("/portal/auth/me", requirePortalSession(), async (req, res) => {
  const ctx = req.portal!;
  return res.json({
    portal: ctx.portal,
    email: ctx.email,
    principalId: ctx.principalId,
  });
});

export default router;
