import * as Sentry from "@sentry/node";
import { logger } from "./logger";

let initialized = false;

/**
 * Initialise Sentry only when SENTRY_DSN is configured. Calling this is a
 * no-op when the env is absent — Sentry imports stay zero-cost since the
 * SDK lazy-installs its instrumentation inside `init()`.
 *
 * The api-server runs against the live tenant DB, so we intentionally:
 *   - tag events with NODE_ENV so dev/staging/prod are filterable
 *   - sample traces at 10% (override with SENTRY_TRACES_SAMPLE_RATE)
 *   - never enable profilesSampleRate by default (needs a paid plan)
 *   - leave PII off (sendDefaultPii=false) — tenants own customer PII,
 *     not us.
 */
export function initSentry(): void {
  if (initialized) return;
  const dsn = process.env["SENTRY_DSN"];
  if (!dsn) {
    logger.info("Sentry disabled (SENTRY_DSN not set)");
    return;
  }
  const env = process.env["SENTRY_ENVIRONMENT"] ?? process.env["NODE_ENV"] ?? "development";
  const tracesSampleRate = Number(process.env["SENTRY_TRACES_SAMPLE_RATE"] ?? "0.1");
  Sentry.init({
    dsn,
    environment: env,
    tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0.1,
    sendDefaultPii: false,
  });
  initialized = true;
  logger.info({ env }, "Sentry initialised");
}

export { Sentry };
