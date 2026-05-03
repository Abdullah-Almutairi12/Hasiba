import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { sessionMiddleware } from "./middlewares/session";
import { initAccounting } from "./lib/accounting-init";
import { initInventory } from "./lib/inventory-init";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const app: Express = express();

// Block requests until the accounting subsystem (tables + seed + legacy
// migration) has finished. We fail closed: if init throws, every request
// returns 503 until the process is restarted, instead of silently serving
// queries against an incomplete schema.
let accountingInitError: unknown = null;
const accountingReady = initAccounting()
  .then(() => initInventory())
  .catch((err) => {
    accountingInitError = err;
    logger.error({ err }, "Failed to initialize accounting/inventory subsystem");
  });

app.use(async (_req, res, next) => {
  await accountingReady;
  if (accountingInitError) {
    res.status(503).json({ error: "Accounting/Inventory subsystem failed to initialize" });
    return;
  }
  next();
});

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Strict same-origin CORS: the frontend is served from the same origin as the API
// (path-based routing through the Replit proxy), so we only allow same-origin
// requests for credentialed calls. We reflect the request origin only when it
// matches the allowed list, never with `origin: true`.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // Same-origin / non-browser requests have no Origin header — allow.
      if (!origin) return cb(null, true);
      if (allowedOrigins.length === 0) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("Origin not allowed by CORS"));
    },
    credentials: true,
  }),
);
// Image-upload routes need a much larger JSON body limit.
// We must mount the larger parser BEFORE the global 1mb parser, otherwise the
// global one runs first, consumes the body, and rejects oversize payloads with 413.
app.use("/api/invoices/scan", express.json({ limit: "20mb" }));

// Default JSON limit for everything else.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(sessionMiddleware);

app.use("/api", router);

// ----------------------------------------------------------------------------
// Daily reorder check
// ----------------------------------------------------------------------------
// Scans active reorder rules and logs the products whose on-hand has crossed
// the min threshold. The same query that powers /inventory/reorder-suggestions
// is used so the surfaced list is always consistent with the UI.
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
async function runReorderCheck(): Promise<void> {
  try {
    const r = await db.execute(sql`
      SELECT p.sku,
             p.name_ar AS product_name,
             w.name_ar AS warehouse_name,
             COALESCE(SUM(q.quantity)::float8, 0) AS on_hand,
             r.min_qty::float8 AS min_qty,
             GREATEST(r.max_qty - COALESCE(SUM(q.quantity), 0), r.eoq, 0)::float8 AS suggested_qty
        FROM reorder_rules r
        JOIN products p ON p.id = r.product_id
        JOIN warehouses w ON w.id = r.warehouse_id
        LEFT JOIN stock_quants q ON q.product_id = r.product_id AND q.warehouse_id = r.warehouse_id
       WHERE r.is_active = true
       GROUP BY r.id, p.sku, p.name_ar, w.name_ar
      HAVING COALESCE(SUM(q.quantity), 0) <= r.min_qty
    `);
    const rows = (r as unknown as { rows?: unknown[] }).rows ?? [];
    if (rows.length > 0) {
      logger.info({ count: rows.length, items: rows }, "Reorder check: items below min");
    } else {
      logger.info("Reorder check: no items below min");
    }
  } catch (err) {
    logger.error({ err }, "Reorder check failed");
  }
}
// First check 60s after boot (gives init tasks time to finish), then daily.
setTimeout(() => {
  void runReorderCheck();
  setInterval(() => void runReorderCheck(), ONE_DAY_MS);
}, 60_000).unref();

export default app;
