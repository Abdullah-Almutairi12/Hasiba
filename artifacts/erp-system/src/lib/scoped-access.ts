import { useEffect } from "react";
import { useGetWorkspaceAccess, getGetWorkspaceAccessQueryKey } from "@workspace/api-client-react";
import { refreshSelectedFromAccess, useSelectedResponsibility } from "@/lib/workspace-responsibility";

/**
 * Keeps the selected responsibility's effective actions and VAT flag live
 * while a scoped screen is open. Returns the query state so callers can
 * block financial actions while access is unknown.
 */
export function useLiveScopedAccess(enabled: boolean) {
  const selected = useSelectedResponsibility();
  const q = useGetWorkspaceAccess({
    query: { queryKey: getGetWorkspaceAccessQueryKey(), enabled: enabled && !!selected, refetchInterval: 30_000, refetchOnWindowFocus: true, retry: false },
  });
  useEffect(() => { if (q.data) refreshSelectedFromAccess(q.data); }, [q.data]);
  return { selected, isLoading: q.isLoading, isError: q.isError, refetch: q.refetch };
}
