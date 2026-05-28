import * as Sentry from "@sentry/react";

/**
 * Initialise Sentry on the frontend only when VITE_SENTRY_DSN is provided
 * at build time. Stays silent otherwise so local dev / preview builds
 * don't ship spurious noise to a real DSN.
 */
export function initSentry(): void {
  const dsn = import.meta.env["VITE_SENTRY_DSN"] as string | undefined;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: (import.meta.env["VITE_SENTRY_ENVIRONMENT"] as string | undefined) ?? import.meta.env.MODE,
    tracesSampleRate: Number(import.meta.env["VITE_SENTRY_TRACES_SAMPLE_RATE"] ?? "0.1") || 0.1,
    sendDefaultPii: false,
  });
}
