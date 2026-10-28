import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSwitchCompany } from "@workspace/api-client-react";
import { useAuth, ME_KEY, type AuthCompany } from "@/hooks/use-auth";
import { setActiveCompanyKey } from "@/lib/query-client";

/**
 * Multi-Company Phase 4: single source of truth for the active tenant.
 *
 * Reads `/auth/me` to get the list of companies the current user can switch
 * into and exposes a `switchCompany(id)` helper that:
 *   1. Calls `POST /auth/switch-company` to flip the session.
 *   2. Refetches `/auth/me` so `activeCompanyId` is fresh.
 *   3. Invalidates every other query so all scoped data refetches with
 *      the new company context. This is the critical guardrail that
 *      prevents stale cross-tenant data from leaking on switch.
 */
export function useCurrentCompany() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const switchMut = useSwitchCompany();

  const companies: AuthCompany[] = user?.companies ?? [];
  const activeCompanyId: number | null = user?.companyId ?? null;
  const activeCompany = useMemo(
    () => companies.find((c) => c.id === activeCompanyId) ?? null,
    [companies, activeCompanyId],
  );

  const switchCompany = useCallback(
    async (companyId: number) => {
      if (companyId === activeCompanyId) return;
      // Editors may guard unsaved work before the server's tenant switch.
      const leaving = new Event("hasiba:before-company-switch", { cancelable: true });
      window.dispatchEvent(leaving);
      if (leaving.defaultPrevented) return;
      // Cancel any in-flight requests so a slow response from the OLD
      // tenant cannot land into the new tenant's cache after the swap.
      await qc.cancelQueries({
        predicate: (q) => {
          const head = q.queryKey?.[0];
          return head !== "auth";
        },
      });
      await switchMut.mutateAsync({ data: { companyId } });
      // Update the cache-scoping key first so every subsequent refetch
      // is written under the new tenant's namespace.
      setActiveCompanyKey(companyId);
      // Drop stale non-auth entries entirely; remount of subscribers
      // triggers a fresh fetch under the new namespace.
      qc.removeQueries({
        predicate: (q) => {
          const head = q.queryKey?.[0];
          return head !== "auth";
        },
      });
      // Refetch /auth/me so the rest of the app sees the new active id.
      await qc.invalidateQueries({ queryKey: ME_KEY });
    },
    [activeCompanyId, qc, switchMut],
  );

  return {
    companies,
    activeCompanyId,
    activeCompany,
    canSwitch: companies.length > 1,
    isSwitching: switchMut.isPending,
    switchCompany,
  };
}
