import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMyAuditConsent,
  getGetMyAuditConsentQueryKey,
  updateMyPreferences,
  type AuditConsent,
} from "@workspace/api-client-react";

export type { AuditConsent };

const DEFAULTS: Required<AuditConsent> = {
  salesDetails: true,
  customerPii: true,
  locationContext: true,
};

/**
 * Task #259 — read + mutate the current user's audit consent. Server
 * is source of truth; mutation patches `users.admin_prefs.auditConsent`
 * via the existing `/users/me/preferences` endpoint and invalidates
 * the consent query so dependent panels re-render.
 */
export function useAuditConsent() {
  const qc = useQueryClient();
  const key = getGetMyAuditConsentQueryKey();
  const q = useGetMyAuditConsent({ query: { queryKey: key, staleTime: 30_000 } });
  const consent: Required<AuditConsent> = {
    ...DEFAULTS,
    ...(q.data ?? {}),
  };

  const setConsent = useCallback(
    async (patch: Partial<AuditConsent>) => {
      const next: Required<AuditConsent> = { ...consent, ...patch };
      qc.setQueryData(key, next);
      try {
        await updateMyPreferences({ auditConsent: next });
        // Audit log payload depends on consent — refresh dependent
        // panels so the user sees the change reflected immediately.
        await qc.invalidateQueries({ queryKey: key });
      } catch (e) {
        qc.setQueryData(key, consent);
        throw e;
      }
    },
    [consent, qc, key],
  );

  return {
    consent,
    isLoading: q.isLoading,
    setConsent,
  };
}
