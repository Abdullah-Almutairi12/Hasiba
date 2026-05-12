import "reflect-metadata";
import app from "./app";
import { logger } from "./lib/logger";
import { startZatcaRetryWorker } from "./lib/integrations/zatca-phase2";

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

function shutdown(signal: string): void {
  logger.info({ signal }, "Shutting down");
  clearInterval(zatcaRetryHandle);
  server.close(() => process.exit(0));
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
