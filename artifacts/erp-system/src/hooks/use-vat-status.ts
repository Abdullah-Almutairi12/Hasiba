import {
  useGetVatStatus,
  getGetVatStatusQueryKey,
} from "@workspace/api-client-react";

export interface VatStatus {
  status: "registered" | "voluntary" | "not_registered" | "unresolved";
  rolling12mSales: number;
  percentOfMandatory: number;
  near80: boolean;
  crossedMandatory: boolean;
  eligibleVoluntary: boolean;
  remainingToMandatory: number;
  mandatoryThreshold: number;
  vatNumber: string | null;
}

/**
 * Tenant-wide VAT registration snapshot. Drives UI gating: when status
 * is `not_registered` the system suppresses VAT inputs and columns so
 * non-registered tenants don't accidentally charge tax. Returns
 * `undefined` while loading; no registration is inferred from missing data.
 */
export function useVatStatus(opts: { enabled?: boolean } = {}): {
  data: VatStatus | undefined;
  isLoading: boolean;
  enabled: boolean;
} {
  const q = useGetVatStatus({
    query: { queryKey: getGetVatStatusQueryKey(), staleTime: 60_000, enabled: opts.enabled ?? true },
  });
  const data = q.data as VatStatus | undefined;
  const status = data?.status;
  const enabled = status === "registered" || status === "voluntary";
  return { data, isLoading: q.isLoading, enabled };
}

/** Cheap boolean shortcut for components that only care about gating. */
export function useVatEnabled(opts: { enabled?: boolean } = {}): boolean {
  return useVatStatus(opts).enabled;
}
