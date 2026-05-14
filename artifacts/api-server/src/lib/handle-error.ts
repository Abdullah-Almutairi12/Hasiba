import type { Response } from "express";
import { ZodError } from "zod";
import { ClosedPeriodError } from "./journal-posting";

/**
 * Centralized error handler for route handlers. Returns 400 for zod validation
 * errors, 403 for attempts to edit a closed fiscal period, and 500 for
 * everything else.
 */
export function handleRouteError(err: unknown, res: Response): void {
  if (err instanceof ZodError) {
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
  res.status(500).json({ error: "Internal server error" });
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
