import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { sessionMiddleware } from "./middlewares/session";
import { initAccounting } from "./lib/accounting-init";

const app: Express = express();

// Block requests until the accounting subsystem (tables + seed + legacy
// migration) has finished. The previous fire-and-forget call could let HTTP
// requests hit incomplete schema during boot.
const accountingReady = initAccounting().catch((err) => {
  logger.error({ err }, "Failed to initialize accounting subsystem");
});

app.use(async (_req, _res, next) => {
  await accountingReady;
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

export default app;
