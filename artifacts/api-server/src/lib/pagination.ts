import type { Request } from "express";

/**
 * Shared pagination helper for list endpoints.
 *
 * Reads `?limit=` and `?offset=` (or `?page=`, 1-indexed) from the request.
 * Caps `limit` to MAX_LIMIT so a malicious client cannot ask for "10 million
 * rows" and DoS the server, and supplies a sensible default so endpoints
 * that forget to paginate cannot grow unbounded over time.
 *
 * Returns `{ limit, offset, page }` ready to drop into a Drizzle query
 * via `.limit(limit).offset(offset)`.
 */
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export interface Pagination {
  limit: number;
  offset: number;
  page: number;
}

function toInt(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

export function parsePagination(req: Request): Pagination {
  const limitRaw = toInt(req.query.limit);
  const offsetRaw = toInt(req.query.offset);
  const pageRaw = toInt(req.query.page);

  const limit = Math.max(1, Math.min(MAX_LIMIT, limitRaw ?? DEFAULT_LIMIT));

  let offset: number;
  let page: number;
  if (pageRaw != null && pageRaw > 0) {
    page = pageRaw;
    offset = (page - 1) * limit;
  } else {
    offset = Math.max(0, offsetRaw ?? 0);
    page = Math.floor(offset / limit) + 1;
  }
  return { limit, offset, page };
}
