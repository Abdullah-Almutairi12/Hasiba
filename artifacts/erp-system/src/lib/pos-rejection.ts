/**
 * Reads a POS checkout rejection from the generated client's ApiError:
 * the parsed JSON lives on `.data` and `.response` is the raw fetch
 * Response (it has no `.data`). A legacy axios-style `{ response: { data } }`
 * object is still accepted for backward compatibility.
 */
export type PosRejection = {
  status: number | null;
  error?: string;
  requiresManagerApproval?: boolean;
  actionKey?: string;
  max?: number | null;
  attempted?: number;
  approvalRequestId?: number | null;
};

export function readPosRejection(err: unknown): PosRejection {
  const e = (err ?? {}) as { status?: unknown; data?: unknown; response?: unknown };
  const resp = e.response as { status?: unknown; data?: unknown } | undefined;
  const isFetchResponse = typeof Response !== "undefined" && resp instanceof Response;
  const legacy = !isFetchResponse && resp && typeof resp === "object" ? resp : undefined;
  const raw = (e.data && typeof e.data === "object" ? e.data : legacy?.data && typeof legacy.data === "object" ? legacy.data : {}) as Record<string, unknown>;
  const status = typeof e.status === "number" ? e.status : typeof legacy?.status === "number" ? legacy.status : null;
  return {
    status,
    error: typeof raw.error === "string" ? raw.error : undefined,
    requiresManagerApproval: raw.requiresManagerApproval === true,
    actionKey: typeof raw.actionKey === "string" ? raw.actionKey : undefined,
    max: typeof raw.max === "number" ? raw.max : null,
    attempted: typeof raw.attempted === "number" ? raw.attempted : undefined,
    approvalRequestId: typeof raw.approvalRequestId === "number" && raw.approvalRequestId >= 1 ? raw.approvalRequestId : null,
  };
}
