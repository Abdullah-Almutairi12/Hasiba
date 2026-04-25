import type { Response } from "express";
import { ZodError } from "zod";

/**
 * Centralized error handler for route handlers. Returns 400 for zod validation
 * errors and 500 for everything else.
 */
export function handleRouteError(err: unknown, res: Response): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "بيانات غير صالحة",
      details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
    return;
  }
  res.status(500).json({ error: "Internal server error" });
}
