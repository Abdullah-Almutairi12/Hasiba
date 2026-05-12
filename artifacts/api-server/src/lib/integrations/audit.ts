import { db, integrationCallsTable } from "@workspace/db";

/**
 * Persist a single outbound third-party API call. Best-effort —
 * audit failures must never block the business operation.
 *
 * Sensitive fields (Authorization headers, raw card data, ZATCA
 * private keys) MUST be redacted by the caller before passing the
 * summaries in.
 */
export async function recordIntegrationCall(args: {
  branchId?: number | null;
  provider: string;
  endpoint: string;
  method: string;
  statusCode?: number | null;
  durationMs?: number | null;
  success: boolean;
  requestSummary?: Record<string, unknown> | null;
  responseSummary?: Record<string, unknown> | null;
  errorMessage?: string | null;
  direction?: "outbound" | "inbound";
}): Promise<void> {
  try {
    await db.insert(integrationCallsTable).values({
      branchId: args.branchId ?? null,
      provider: args.provider,
      endpoint: args.endpoint.slice(0, 1000),
      method: args.method,
      statusCode: args.statusCode ?? null,
      durationMs: args.durationMs ?? null,
      success: args.success,
      requestSummary: args.requestSummary ?? null,
      responseSummary: args.responseSummary ?? null,
      errorMessage: args.errorMessage?.slice(0, 1000) ?? null,
      direction: args.direction ?? "outbound",
    });
  } catch {
    // swallow — audit must never break the call site.
  }
}
