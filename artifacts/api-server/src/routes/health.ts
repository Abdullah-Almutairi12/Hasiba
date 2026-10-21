import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Read-only readiness probe: a live process is not proof of a reachable database.
router.get("/readyz", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ready" });
  } catch (err) {
    req.log.warn({ event: "health.database_unavailable", err }, "Readiness check failed");
    res.status(503).json({ status: "unavailable" });
  }
});

export default router;
