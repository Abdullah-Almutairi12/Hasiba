import { Router } from "express";
import { randomUUID, randomBytes, createHash } from "crypto";
import { z } from "zod";
import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import {
  db,
  documentsTable,
  documentFoldersTable,
  documentVersionsTable,
  documentAclsTable,
  documentAttachmentsTable,
  signatureRequestsTable,
  signatureSignersTable,
  signatureAuditTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { adminGuard, requireRole, ALL_ROLES } from "../middlewares/require-role";
import { objectStorageClient } from "../lib/objectStorage";
import { sendMail } from "../lib/mailer";

const router = Router();

const MAX_DOC_BYTES = 25 * 1024 * 1024; // 25mb

function getBucketPrefix(): { bucket: string; prefix: string } {
  const privateDir = (process.env["PRIVATE_OBJECT_DIR"] ?? "").replace(/^\/+|\/+$/g, "");
  if (!privateDir) throw new Error("PRIVATE_OBJECT_DIR not configured");
  const [bucket, ...rest] = privateDir.split("/");
  if (!bucket) throw new Error("bad PRIVATE_OBJECT_DIR");
  return { bucket, prefix: rest.join("/") };
}

async function uploadBuffer(buffer: Buffer, contentType: string, ext: string): Promise<string> {
  const { bucket, prefix } = getBucketPrefix();
  const key = `documents/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;
  const objectName = prefix ? `${prefix}/${key}` : key;
  await objectStorageClient
    .bucket(bucket)
    .file(objectName)
    .save(buffer, { metadata: { contentType }, resumable: false });
  return key;
}

function inferExt(name: string, mime: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name);
  if (m && m[1]) return m[1].toLowerCase();
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("word")) return "docx";
  return "bin";
}

// Extract plain text from a base64 file when possible (txt + simple PDFs).
// Heavy OCR is out of scope here; this lets us still index typed documents.
function extractTextBestEffort(buffer: Buffer, mime: string, name: string): string | null {
  try {
    if (mime.startsWith("text/") || /\.(txt|md|csv|json|log)$/i.test(name)) {
      return buffer.toString("utf8").slice(0, 200_000);
    }
    // Cheap fallback: pull printable ASCII chunks from any binary. Good enough
    // for tagging-style search on PDFs without bundling a PDF parser.
    if (mime === "application/pdf" || /\.pdf$/i.test(name)) {
      const str = buffer.toString("latin1");
      const matches = str.match(/[\x20-\x7E\u0600-\u06FF]{5,}/g);
      return matches ? matches.join(" ").slice(0, 200_000) : null;
    }
  } catch {
    return null;
  }
  return null;
}

// =========================================================================
// Folders
// =========================================================================
router.get("/documents/folders", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(documentFoldersTable)
      .orderBy(asc(documentFoldersTable.path));
    return res.json(rows);
  } catch (err) {
    req.log.error({ err }, "list folders failed");
    return res.status(500).json({ error: "internal" });
  }
});

const CreateFolderBody = z.object({
  name: z.string().min(1).max(120),
  parentId: z.number().int().positive().nullable().optional(),
});

router.post("/documents/folders", adminGuard, async (req, res) => {
  try {
    const parsed = CreateFolderBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });

    let parentPath = "";
    const parentId = parsed.data.parentId ?? null;
    if (parentId) {
      const [p] = await db
        .select({ path: documentFoldersTable.path })
        .from(documentFoldersTable)
        .where(eq(documentFoldersTable.id, parentId))
        .limit(1);
      if (!p) return res.status(404).json({ error: "المجلد الأب غير موجود" });
      parentPath = p.path;
    }
    const safeName = parsed.data.name.replace(/\//g, "-").trim();
    const path = `${parentPath}/${safeName}`;
    const [row] = await db
      .insert(documentFoldersTable)
      .values({
        name: safeName,
        parentId,
        path,
        createdByUserId: req.session.userId,
      })
      .returning();
    return res.status(201).json(row);
  } catch (err: unknown) {
    req.log.error({ err }, "create folder failed");
    if ((err as { code?: string })?.code === "23505") {
      return res.status(409).json({ error: "هذا المجلد موجود بالفعل" });
    }
    return res.status(500).json({ error: "internal" });
  }
});

router.delete("/documents/folders/:id", adminGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    // Cascade delete: documents in this folder become orphan (folderId=NULL).
    await db
      .update(documentsTable)
      .set({ folderId: null })
      .where(eq(documentsTable.folderId, id));
    await db.delete(documentAclsTable).where(eq(documentAclsTable.folderId, id));
    await db.delete(documentFoldersTable).where(eq(documentFoldersTable.id, id));
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "delete folder failed");
    return res.status(500).json({ error: "internal" });
  }
});

// Folder ACLs (admin-only).
router.get("/documents/folders/:id/acls", adminGuard, async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db
    .select()
    .from(documentAclsTable)
    .where(eq(documentAclsTable.folderId, id));
  return res.json(rows);
});

const AclBody = z.object({
  role: z.string().min(2).max(40),
  access: z.enum(["read", "write"]).default("read"),
});

router.post("/documents/folders/:id/acls", adminGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const parsed = AclBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });
    const [row] = await db
      .insert(documentAclsTable)
      .values({ folderId: id, role: parsed.data.role, access: parsed.data.access })
      .onConflictDoNothing()
      .returning();
    return res.status(201).json(row ?? { ok: true });
  } catch (err) {
    req.log.error({ err }, "create acl failed");
    return res.status(500).json({ error: "internal" });
  }
});

router.delete("/documents/folders/:fid/acls/:id", adminGuard, async (req, res) => {
  await db
    .delete(documentAclsTable)
    .where(eq(documentAclsTable.id, Number(req.params.id)));
  return res.json({ ok: true });
});

// =========================================================================
// Documents — list, search, upload, versioning
// =========================================================================
const docsReadGuard = requireRole(...ALL_ROLES);

router.get("/documents", docsReadGuard, async (req, res) => {
  try {
    const q = (req.query.q as string | undefined)?.trim();
    const folderId = req.query.folderId ? Number(req.query.folderId) : undefined;

    const where = [] as ReturnType<typeof eq>[];
    if (folderId !== undefined && !Number.isNaN(folderId)) {
      where.push(eq(documentsTable.folderId, folderId));
    }
    let query = db.select().from(documentsTable).$dynamic();
    if (q) {
      const pat = `%${q.toLowerCase()}%`;
      query = query.where(
        and(
          ...where,
          or(
            ilike(documentsTable.name, pat),
            ilike(documentsTable.tags, pat),
            ilike(documentsTable.extractedText, pat),
          )!,
        ),
      );
    } else if (where.length) {
      query = query.where(and(...where));
    }
    const rows = await query.orderBy(desc(documentsTable.updatedAt)).limit(200);
    return res.json(rows);
  } catch (err) {
    req.log.error({ err }, "list documents failed");
    return res.status(500).json({ error: "internal" });
  }
});

const UploadBody = z.object({
  name: z.string().min(1).max(240),
  folderId: z.number().int().positive().nullable().optional(),
  tags: z.string().max(500).optional(),
  // base64-encoded file content
  fileBase64: z.string().min(10),
  mime: z.string().min(3).max(120),
});

router.post("/documents", docsReadGuard, async (req, res) => {
  try {
    const parsed = UploadBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });
    const buf = Buffer.from(parsed.data.fileBase64, "base64");
    if (buf.length === 0) return res.status(400).json({ error: "ملف فارغ" });
    if (buf.length > MAX_DOC_BYTES) {
      return res.status(413).json({ error: "حجم الملف يتجاوز الحد المسموح (25mb)" });
    }
    const ext = inferExt(parsed.data.name, parsed.data.mime);
    const objectKey = await uploadBuffer(buf, parsed.data.mime, ext);
    const checksum = createHash("sha256").update(buf).digest("hex");
    const text = extractTextBestEffort(buf, parsed.data.mime, parsed.data.name);

    const userId = req.session.userId ?? null;
    const created = await db.transaction(async (tx) => {
      const [doc] = await tx
        .insert(documentsTable)
        .values({
          name: parsed.data.name,
          folderId: parsed.data.folderId ?? null,
          tags: (parsed.data.tags ?? "").toLowerCase(),
          extractedText: text,
          currentVersion: 1,
          latestObjectKey: objectKey,
          latestMime: parsed.data.mime,
          latestSize: buf.length,
          createdByUserId: userId,
        })
        .returning();
      await tx.insert(documentVersionsTable).values({
        documentId: doc.id,
        version: 1,
        objectKey,
        mime: parsed.data.mime,
        size: buf.length,
        checksum,
        uploadedByUserId: userId,
      });
      return doc;
    });
    return res.status(201).json(created);
  } catch (err) {
    req.log.error({ err }, "upload document failed");
    return res.status(500).json({ error: "internal" });
  }
});

router.get("/documents/:id", docsReadGuard, async (req, res) => {
  const id = Number(req.params.id);
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id)).limit(1);
  if (!doc) return res.status(404).json({ error: "not found" });
  const versions = await db
    .select()
    .from(documentVersionsTable)
    .where(eq(documentVersionsTable.documentId, id))
    .orderBy(desc(documentVersionsTable.version));
  return res.json({ ...doc, versions });
});

const NewVersionBody = z.object({
  fileBase64: z.string().min(10),
  mime: z.string().min(3).max(120),
  note: z.string().max(500).optional(),
});

router.post("/documents/:id/versions", docsReadGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const parsed = NewVersionBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });
    const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id)).limit(1);
    if (!doc) return res.status(404).json({ error: "not found" });
    const buf = Buffer.from(parsed.data.fileBase64, "base64");
    if (buf.length === 0 || buf.length > MAX_DOC_BYTES) {
      return res.status(400).json({ error: "ملف غير صالح" });
    }
    const ext = inferExt(doc.name, parsed.data.mime);
    const objectKey = await uploadBuffer(buf, parsed.data.mime, ext);
    const checksum = createHash("sha256").update(buf).digest("hex");
    const text = extractTextBestEffort(buf, parsed.data.mime, doc.name);
    const nextVersion = doc.currentVersion + 1;

    await db.transaction(async (tx) => {
      await tx.insert(documentVersionsTable).values({
        documentId: id,
        version: nextVersion,
        objectKey,
        mime: parsed.data.mime,
        size: buf.length,
        checksum,
        note: parsed.data.note ?? null,
        uploadedByUserId: req.session.userId ?? null,
      });
      await tx
        .update(documentsTable)
        .set({
          currentVersion: nextVersion,
          latestObjectKey: objectKey,
          latestMime: parsed.data.mime,
          latestSize: buf.length,
          extractedText: text ?? doc.extractedText,
          updatedAt: new Date(),
        })
        .where(eq(documentsTable.id, id));
    });
    return res.status(201).json({ version: nextVersion, objectKey });
  } catch (err) {
    req.log.error({ err }, "upload new version failed");
    return res.status(500).json({ error: "internal" });
  }
});

router.delete("/documents/:id", adminGuard, async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(documentAttachmentsTable).where(eq(documentAttachmentsTable.documentId, id));
  await db.delete(documentVersionsTable).where(eq(documentVersionsTable.documentId, id));
  await db.delete(documentsTable).where(eq(documentsTable.id, id));
  return res.json({ ok: true });
});

// =========================================================================
// Attachments (polymorphic) — link a document to a business record.
// =========================================================================
const AttachBody = z.object({
  documentId: z.number().int().positive(),
  entityType: z.string().min(2).max(40),
  entityId: z.number().int().positive(),
});

router.post("/documents/attachments", docsReadGuard, async (req, res) => {
  try {
    const parsed = AttachBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });
    const [row] = await db
      .insert(documentAttachmentsTable)
      .values({
        documentId: parsed.data.documentId,
        entityType: parsed.data.entityType,
        entityId: parsed.data.entityId,
        createdByUserId: req.session.userId ?? null,
      })
      .returning();
    return res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "attach document failed");
    return res.status(500).json({ error: "internal" });
  }
});

router.get("/documents/attachments", docsReadGuard, async (req, res) => {
  const entityType = req.query.entityType as string | undefined;
  const entityId = req.query.entityId ? Number(req.query.entityId) : undefined;
  if (!entityType || entityId === undefined || Number.isNaN(entityId)) {
    return res.status(400).json({ error: "بيانات غير صحيحة" });
  }
  const rows = await db
    .select({
      id: documentAttachmentsTable.id,
      documentId: documentAttachmentsTable.documentId,
      entityType: documentAttachmentsTable.entityType,
      entityId: documentAttachmentsTable.entityId,
      name: documentsTable.name,
      mime: documentsTable.latestMime,
      size: documentsTable.latestSize,
      createdAt: documentAttachmentsTable.createdAt,
    })
    .from(documentAttachmentsTable)
    .leftJoin(documentsTable, eq(documentsTable.id, documentAttachmentsTable.documentId))
    .where(
      and(
        eq(documentAttachmentsTable.entityType, entityType),
        eq(documentAttachmentsTable.entityId, entityId),
      ),
    );
  return res.json(rows);
});

router.delete("/documents/attachments/:id", docsReadGuard, async (req, res) => {
  await db
    .delete(documentAttachmentsTable)
    .where(eq(documentAttachmentsTable.id, Number(req.params.id)));
  return res.json({ ok: true });
});

// =========================================================================
// E-signature flow
// =========================================================================
const CreateSignatureRequestBody = z.object({
  documentId: z.number().int().positive(),
  title: z.string().min(2).max(200),
  message: z.string().max(2000).optional(),
  orderedSigning: z.boolean().default(true),
  signers: z
    .array(
      z.object({
        name: z.string().min(2).max(120),
        email: z.string().email(),
      }),
    )
    .min(1)
    .max(20),
});

router.post("/documents/signatures", docsReadGuard, async (req, res) => {
  try {
    const parsed = CreateSignatureRequestBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });
    const [doc] = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.id, parsed.data.documentId))
      .limit(1);
    if (!doc) return res.status(404).json({ error: "المستند غير موجود" });

    const baseUrl =
      (process.env.PUBLIC_APP_URL ?? "").replace(/\/$/, "") ||
      (process.env.REPLIT_DOMAINS?.split(",")[0]
        ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`
        : "");

    const result = await db.transaction(async (tx) => {
      const [reqRow] = await tx
        .insert(signatureRequestsTable)
        .values({
          documentId: doc.id,
          documentVersion: doc.currentVersion,
          title: parsed.data.title,
          message: parsed.data.message ?? null,
          orderedSigning: parsed.data.orderedSigning,
          status: "pending",
          createdByUserId: req.session.userId ?? null,
        })
        .returning();

      const signers = await Promise.all(
        parsed.data.signers.map(async (s, idx) => {
          const token = randomBytes(24).toString("base64url");
          const tokenHash = createHash("sha256").update(token).digest("hex");
          const [row] = await tx
            .insert(signatureSignersTable)
            .values({
              requestId: reqRow.id,
              seq: idx + 1,
              name: s.name,
              email: s.email.toLowerCase(),
              tokenHash,
              status: "pending",
            })
            .returning();
          return { row, token };
        }),
      );

      await tx.insert(signatureAuditTable).values({
        requestId: reqRow.id,
        event: "sent",
        ip: req.ip ?? null,
        userAgent: (req.headers["user-agent"] as string) ?? null,
        meta: { signerCount: signers.length },
      });

      return { reqRow, signers };
    });

    // Fire-and-forget email each signer their unique signing link.
    for (const s of result.signers) {
      const link = `${baseUrl}/sign?token=${encodeURIComponent(s.token)}`;
      sendMail({
        to: s.row.email,
        subject: `طلب توقيع: ${parsed.data.title}`,
        body: `مرحباً ${s.row.name},\n\nمطلوب توقيعك على المستند "${parsed.data.title}".\nاضغط الرابط للتوقيع:\n${link}\n\n${parsed.data.message ?? ""}`,
      }).catch(() => undefined);
    }

    return res.status(201).json({
      request: result.reqRow,
      signers: result.signers.map((s) => ({
        id: s.row.id,
        name: s.row.name,
        email: s.row.email,
        seq: s.row.seq,
        // Token only returned to the requester on creation — never on subsequent reads.
        token: s.token,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "create signature request failed");
    return res.status(500).json({ error: "internal" });
  }
});

router.get("/documents/signatures", docsReadGuard, async (req, res) => {
  const rows = await db
    .select()
    .from(signatureRequestsTable)
    .orderBy(desc(signatureRequestsTable.createdAt))
    .limit(100);
  return res.json(rows);
});

router.get("/documents/signatures/:id", docsReadGuard, async (req, res) => {
  const id = Number(req.params.id);
  const [r] = await db
    .select()
    .from(signatureRequestsTable)
    .where(eq(signatureRequestsTable.id, id))
    .limit(1);
  if (!r) return res.status(404).json({ error: "not found" });
  const signers = await db
    .select({
      id: signatureSignersTable.id,
      seq: signatureSignersTable.seq,
      name: signatureSignersTable.name,
      email: signatureSignersTable.email,
      status: signatureSignersTable.status,
      signedAt: signatureSignersTable.signedAt,
      declineReason: signatureSignersTable.declineReason,
    })
    .from(signatureSignersTable)
    .where(eq(signatureSignersTable.requestId, id))
    .orderBy(asc(signatureSignersTable.seq));
  const audit = await db
    .select()
    .from(signatureAuditTable)
    .where(eq(signatureAuditTable.requestId, id))
    .orderBy(asc(signatureAuditTable.createdAt));
  return res.json({ ...r, signers, audit });
});

// ---- Public signing endpoints (no staff session, token-authenticated). ----

const signPublicRouter = Router();

async function loadSignerByToken(token: string) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const [signer] = await db
    .select()
    .from(signatureSignersTable)
    .where(eq(signatureSignersTable.tokenHash, tokenHash))
    .limit(1);
  if (!signer) return null;
  const [request] = await db
    .select()
    .from(signatureRequestsTable)
    .where(eq(signatureRequestsTable.id, signer.requestId))
    .limit(1);
  return request ? { signer, request } : null;
}

signPublicRouter.get("/sign/:token", async (req, res) => {
  try {
    const ctx = await loadSignerByToken(req.params.token);
    if (!ctx) return res.status(404).json({ error: "رابط غير صالح" });
    const { signer, request } = ctx;
    const [doc] = await db
      .select({
        id: documentsTable.id,
        name: documentsTable.name,
        latestObjectKey: documentsTable.latestObjectKey,
        latestMime: documentsTable.latestMime,
      })
      .from(documentsTable)
      .where(eq(documentsTable.id, request.documentId))
      .limit(1);

    // Audit "viewed".
    await db.insert(signatureAuditTable).values({
      requestId: request.id,
      signerId: signer.id,
      event: "viewed",
      ip: req.ip ?? null,
      userAgent: (req.headers["user-agent"] as string) ?? null,
    });

    // Determine if this signer is the next one in serial order.
    let canSignNow = true;
    if (request.orderedSigning && signer.status === "pending") {
      const earlier = await db
        .select({ id: signatureSignersTable.id, status: signatureSignersTable.status, seq: signatureSignersTable.seq })
        .from(signatureSignersTable)
        .where(
          and(
            eq(signatureSignersTable.requestId, request.id),
            sql`${signatureSignersTable.seq} < ${signer.seq}`,
          ),
        );
      canSignNow = earlier.every((e) => e.status === "signed");
    }

    return res.json({
      request: {
        id: request.id,
        title: request.title,
        message: request.message,
        status: request.status,
      },
      signer: {
        name: signer.name,
        email: signer.email,
        seq: signer.seq,
        status: signer.status,
      },
      document: doc,
      canSignNow,
    });
  } catch (err) {
    req.log.error({ err }, "sign view failed");
    return res.status(500).json({ error: "internal" });
  }
});

const SignBody = z.object({
  signatureImage: z.string().min(20).max(2_000_000), // data URL
});

signPublicRouter.post("/sign/:token", async (req, res) => {
  try {
    const parsed = SignBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });
    const ctx = await loadSignerByToken(req.params.token);
    if (!ctx) return res.status(404).json({ error: "رابط غير صالح" });
    const { signer, request } = ctx;
    if (signer.status !== "pending") {
      return res.status(409).json({ error: "تم التوقيع مسبقاً أو رُفض الطلب" });
    }
    if (request.status !== "pending") {
      return res.status(409).json({ error: "الطلب غير مفتوح للتوقيع" });
    }
    if (request.orderedSigning) {
      const earlier = await db
        .select({ status: signatureSignersTable.status })
        .from(signatureSignersTable)
        .where(
          and(
            eq(signatureSignersTable.requestId, request.id),
            sql`${signatureSignersTable.seq} < ${signer.seq}`,
          ),
        );
      if (!earlier.every((e) => e.status === "signed")) {
        return res.status(409).json({ error: "ينتظر هذا الطلب توقيعاً سابقاً" });
      }
    }

    const now = new Date();
    const ip = req.ip ?? null;
    const userAgent = (req.headers["user-agent"] as string) ?? null;

    await db.transaction(async (tx) => {
      await tx
        .update(signatureSignersTable)
        .set({
          status: "signed",
          signedAt: now,
          signedIp: ip,
          signatureImage: parsed.data.signatureImage,
        })
        .where(eq(signatureSignersTable.id, signer.id));
      await tx.insert(signatureAuditTable).values({
        requestId: request.id,
        signerId: signer.id,
        event: "signed",
        ip,
        userAgent,
      });

      // If all signers have signed, complete the request.
      const remaining = await tx
        .select({ id: signatureSignersTable.id })
        .from(signatureSignersTable)
        .where(
          and(
            eq(signatureSignersTable.requestId, request.id),
            sql`${signatureSignersTable.status} <> 'signed'`,
          ),
        );
      if (remaining.length === 0) {
        await tx
          .update(signatureRequestsTable)
          .set({ status: "completed", completedAt: now })
          .where(eq(signatureRequestsTable.id, request.id));
        await tx.insert(signatureAuditTable).values({
          requestId: request.id,
          event: "completed",
          ip,
          userAgent,
        });
      }
    });

    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "sign submit failed");
    return res.status(500).json({ error: "internal" });
  }
});

const DeclineBody = z.object({ reason: z.string().max(500).optional() });
signPublicRouter.post("/sign/:token/decline", async (req, res) => {
  try {
    const parsed = DeclineBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });
    const ctx = await loadSignerByToken(req.params.token);
    if (!ctx) return res.status(404).json({ error: "رابط غير صالح" });
    const { signer, request } = ctx;
    if (signer.status !== "pending") {
      return res.status(409).json({ error: "تم التعامل مع الطلب مسبقاً" });
    }
    await db.transaction(async (tx) => {
      await tx
        .update(signatureSignersTable)
        .set({
          status: "declined",
          declineReason: parsed.data.reason ?? null,
        })
        .where(eq(signatureSignersTable.id, signer.id));
      await tx
        .update(signatureRequestsTable)
        .set({ status: "declined" })
        .where(eq(signatureRequestsTable.id, request.id));
      await tx.insert(signatureAuditTable).values({
        requestId: request.id,
        signerId: signer.id,
        event: "declined",
        ip: req.ip ?? null,
        userAgent: (req.headers["user-agent"] as string) ?? null,
        meta: { reason: parsed.data.reason ?? null },
      });
    });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "sign decline failed");
    return res.status(500).json({ error: "internal" });
  }
});

export { signPublicRouter };
export default router;
