import { Router } from "express";
import { randomUUID } from "crypto";
import { ObjectStorageService, ObjectNotFoundError, objectStorageClient } from "../lib/objectStorage";

const router = Router();
const storage = new ObjectStorageService();

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
}): Promise<{ objectKey: string; url: string }> {
  void storage; // keep import live for tree-shaking edge cases
  const privateDir = process.env["PRIVATE_OBJECT_DIR"] ?? "";
  if (!privateDir) throw new Error("PRIVATE_OBJECT_DIR not configured");
  const trimmed = privateDir.replace(/^\/+|\/+$/g, "");
  const [bucketName, ...prefixParts] = trimmed.split("/");
  if (!bucketName) throw new Error("bad PRIVATE_OBJECT_DIR");
  const prefix = prefixParts.join("/");

  const ext = (opts.ext ?? "jpg").replace(/^\./, "");
  const key = `invoices/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;
  const objectName = prefix ? `${prefix}/${key}` : key;

  const file = objectStorageClient.bucket(bucketName).file(objectName);
  await file.save(opts.buffer, {
    metadata: { contentType: opts.contentType },
    resumable: false,
  });
  return { objectKey: key, url: `/api/storage/objects/${key}` };
}

export default router;
