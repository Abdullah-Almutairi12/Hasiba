/**
 * CSRF defense-in-depth via Origin/Referer header validation.
 *
 * `SameSite=lax` cookies already block the most common CSRF vectors,
 * but OWASP recommends an explicit Origin/Referer check on every
 * state-changing request as a second line of defense. This middleware
 * does exactly that, mirroring the same allowlist used by the strict
 * CORS handler.
 *
 * Behaviour:
 *   - Safe methods (GET, HEAD, OPTIONS) → pass through.
 *   - State-changing methods (POST, PUT, PATCH, DELETE):
 *       * If the request has an Origin header, it must be in the
 *         allowlist (or null/same-origin).
 *       * If no Origin header, fall back to Referer with the same
 *         allowlist check.
 *       * Requests with neither Origin nor Referer pass through —
 *         non-browser clients (curl, native mobile, server-to-server)
 *         legitimately omit both and authenticate via session cookie
 *         which they cannot forge cross-site anyway.
 *
 * Mount this AFTER the public webhook routes (which receive POSTs
 * from external services without an Origin header in our allowlist).
 */
import type { Request, Response, NextFunction } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function buildAllowlist(): Set<string> {
  const fromEnv = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Replit dev/prod domains are exposed via REPLIT_DOMAINS (comma-separated host list).
  const replitHosts = (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const replitOrigins = replitHosts.map((h) => `https://${h}`);

  const dev = process.env.NODE_ENV !== "production"
    ? ["http://localhost", "http://localhost:80", "http://127.0.0.1"]
    : [];

  return new Set<string>([...fromEnv, ...replitOrigins, ...dev]);
}

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** True when `origin` is allowed (exact match or host-prefix for localhost ports). */
function isAllowed(origin: string, allowlist: Set<string>): boolean {
  if (allowlist.has(origin)) return true;
  // Allow any localhost port in dev.
  if (process.env.NODE_ENV !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    return true;
  }
  return false;
}

/**
 * Express middleware that rejects cross-origin state-changing requests
 * with HTTP 403. See module docstring for the full behaviour matrix.
 */
export function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = req.get("origin");
  const referer = req.get("referer");

  // Non-browser clients (curl, native mobile, S2S) typically omit both
  // headers. They cannot forge cross-site requests through the browser,
  // so the session cookie remains the sole authenticator. Allow.
  if (!origin && !referer) {
    next();
    return;
  }

  const allowlist = buildAllowlist();
  const candidate = origin ?? (referer ? originOf(referer) : null);

  if (!candidate) {
    res.status(403).json({ error: "Forbidden: invalid request origin" });
    return;
  }

  if (!isAllowed(candidate, allowlist)) {
    req.log?.warn?.({ candidate, method: req.method, url: req.url }, "CSRF: rejected cross-origin write");
    res.status(403).json({ error: "Forbidden: cross-origin write blocked" });
    return;
  }

  next();
}
