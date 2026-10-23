import type { Response } from "express";
import { ZodError } from "zod";
import { ZodError as ZodErrorV4 } from "zod/v4";
import { ClosedPeriodError } from "./journal-posting";

/**
 * Centralized error handler for route handlers. Returns 400 for zod validation
 * errors, 403 for attempts to edit a closed fiscal period, and 500 for
 * everything else.
 */
export function handleRouteError(err: unknown, res: Response): void {
  if (err instanceof ZodError || err instanceof ZodErrorV4) {
    res.status(400).json({
      error: "بيانات غير صالحة",
      details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
    return;
  }
  if (err instanceof ClosedPeriodError) {
    res.status(403).json({ error: err.message });
    return;
  }
  // Errors thrown by helpers (e.g. assertLinkedCompanyAllowed) carry an
  // explicit HTTP `status` so the caller can preserve 403/404/409 etc.
  if (err instanceof Error && typeof (err as Error & { status?: unknown }).status === "number") {
    const status = (err as Error & { status: number }).status;
    res.status(status).json({ error: err.message });
    return;
  }
  res.req.log?.error({
    event: "request.failed",
    err,
    requestId: res.req.id,
    method: res.req.method,
    route: res.req.route?.path,
  }, "Unexpected request failure");
  res.status(500).json({ error: "Internal server error", requestId: res.req.id });
}

/**
 * Helper for routes that build their own catch with a generic 400 fallback.
 * Returns true if it handled the error (closed-period 403); the caller
 * should fall through to its existing handling otherwise.
 */
export function handleClosedPeriod(err: unknown, res: Response): boolean {
  if (err instanceof ClosedPeriodError) {
    res.status(403).json({ error: err.message });
    return true;
  }
  return false;
}
