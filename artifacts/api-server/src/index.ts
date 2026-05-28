import "reflect-metadata";
// Sentry must be initialised BEFORE app/router imports so its
// auto-instrumentation can wrap http/express at module load time.
import { initSentry } from "./lib/sentry";
initSentry();
import app from "./app";
import { logger } from "./lib/logger";
import { startZatcaRetryWorker } from "./lib/integrations/zatca-phase2";
import { startTrackingWorker } from "./lib/integrations/shipping";
import { startReportingWorkers } from "./lib/reporting-workers";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

// ZATCA retry worker — drains the zatca_invoice_retries queue every
// 60s. Uses .unref() so it never blocks process shutdown.
const zatcaRetryHandle = startZatcaRetryWorker(60_000);
const reportingWorkerHandle = startReportingWorkers(5 * 60_000);

// Shipping tracking worker — sweeps open shipments every 5 minutes
// and refreshes their status from the carrier APIs (SMSA / Aramex /
// Saee / Naqel). .unref() so it never blocks shutdown.
const trackingHandle = startTrackingWorker(5 * 60_000);

function shutdown(signal: string): void {
  logger.info({ signal }, "Shutting down");
  clearInterval(zatcaRetryHandle);
  clearInterval(trackingHandle);
  clearInterval(reportingWorkerHandle);
  server.close(() => process.exit(0));
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
