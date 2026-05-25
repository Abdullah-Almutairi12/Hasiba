import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod/v4";
import { ObjectStorageService, ObjectNotFoundError, objectStorageClient } from "../lib/objectStorage";
import { handleRouteError } from "../lib/handle-error";

const router = Router();
const storage = new ObjectStorageService();

/**
 * Hard ceiling on attachment uploads. 10MB covers a typical
 * multi-page supplier invoice or bank advice PDF; beyond that the
 * request is rejected before we touch object storage.
 */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const uploadAttachmentBodySchema = z.object({
  filename: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9._\u0600-\u06FF\- ]+\.pdf$/i, "filename must end in .pdf"),
  contentBase64: z.string().min(1),
});

/**
 * POST /storage/attachments — upload a PDF justification document
 * for an audit-trail attachment (e.g. supplier invoice, bank advice
 * supporting an alert dismissal). The route is mounted behind
 * requireAuth at the router level, so only signed-in users can
 * upload; it does NOT enforce tenant scoping because the resulting
 * URL is opaque (random UUID) and is bound to a specific dismissal
 * row at write time (the dismiss endpoint validates the URL shape).
 *
 * Returns the relative URL (`/api/storage/objects/...`) callers
 * persist on the owning record.
 */
router.post("/storage/attachments", async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (typeof userId !== "number") {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const { filename, contentBase64 } = uploadAttachmentBodySchema.parse(req.body);
    const buffer = Buffer.from(contentBase64, "base64");
    if (buffer.length === 0) {
      res.status(400).json({ error: "empty file" });
      return;
    }
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      res.status(413).json({ error: "file too large (max 10MB)" });
      return;
    }
    // Sniff the PDF magic bytes — base64 decoders are happy to
    // produce arbitrary bytes from any input, so we re-check the
    // resulting content before persisting it as a PDF.
    if (buffer.subarray(0, 4).toString("ascii") !== "%PDF") {
      res.status(400).json({ error: "not a PDF file" });
      return;
    }
    const { url } = await uploadBufferToPrivateObject({
      buffer,
      contentType: "application/pdf",
      ext: "pdf",
      folder: "attachments",
    });
    res.json({ url, filename });
  } catch (err) {
    handleRouteError(err, res);
  }
});

/**
 * Serve a previously-uploaded private object.
 * Public for now (anyone with the opaque key can view) — same model as a presigned URL.
 * Used to show invoice photos in the UI.
 */
// Express v5 / path-to-regexp v8 dropped the `:key(*)` syntax — wildcards now use `*splat`.
router.get("/storage/objects/*splat", async (req, res) => {
  try {
    // `req.params.splat` may be a string (single segment) or string[] (multi-segment).
    const raw = (req.params as Record<string, string | string[]>)["splat"];
    const objectKey = Array.isArray(raw) ? raw.join("/") : raw;
    if (!objectKey) return res.status(400).json({ error: "missing key" });

    const privateDir = process.env["PRIVATE_OBJECT_DIR"] ?? "";
    if (!privateDir) return res.status(500).json({ error: "object storage not configured" });

    // privateDir looks like "/<bucket>/<prefix>"; split into bucket + objectName.
    const trimmed = privateDir.replace(/^\/+|\/+$/g, "");
    const [bucketName, ...prefixParts] = trimmed.split("/");
    const prefix = prefixParts.join("/");
    const objectName = prefix ? `${prefix}/${objectKey}` : objectKey;
    if (!bucketName) return res.status(500).json({ error: "bad PRIVATE_OBJECT_DIR" });

    const file = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (!exists) throw new ObjectNotFoundError();

    const [metadata] = await file.getMetadata();
    res.setHeader("Content-Type", (metadata.contentType as string) || "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=86400");
    file.createReadStream().on("error", () => res.status(500).end()).pipe(res);
    return;
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return res.status(404).json({ error: "not found" });
    req.log.error({ err }, "serve object failed");
    return res.status(500).json({ error: "internal error" });
  }
});

/**
 * Helper: server-side upload of an in-memory buffer (e.g., a base64-decoded image).
 * Used by /invoices/scan to persist the source photo for the audit trail.
 */
export async function uploadBufferToPrivateObject(opts: {
  buffer: Buffer;
  contentType: string;
  ext?: string;
  /** Folder under PRIVATE_OBJECT_DIR. Defaults to "invoices" for back-compat. */
  folder?: string;
}): Promise<{ objectKey: string; url: string }> {
  void storage; // keep import live for tree-shaking edge cases
  const privateDir = process.env["PRIVATE_OBJECT_DIR"] ?? "";
  if (!privateDir) throw new Error("PRIVATE_OBJECT_DIR not configured");
  const trimmed = privateDir.replace(/^\/+|\/+$/g, "");
  const [bucketName, ...prefixParts] = trimmed.split("/");
  if (!bucketName) throw new Error("bad PRIVATE_OBJECT_DIR");
  const prefix = prefixParts.join("/");

  const ext = (opts.ext ?? "jpg").replace(/^\./, "");
  const folder = opts.folder ?? "invoices";
  const key = `${folder}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;
  const objectName = prefix ? `${prefix}/${key}` : key;

  const file = objectStorageClient.bucket(bucketName).file(objectName);
  await file.save(opts.buffer, {
    metadata: { contentType: opts.contentType },
    resumable: false,
  });
  return { objectKey: key, url: `/api/storage/objects/${key}` };
}

export default router;
