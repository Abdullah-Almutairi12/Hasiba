import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  updateMyPreferences,
} from "@workspace/api-client-react";
import { ME_KEY, type AuthUser } from "./use-auth";

const STORAGE_KEY = "hasba.insight-mode";

type CachedUser = AuthUser & {
  adminPrefs?: { insightMode?: boolean } | null;
};

function readLocal(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

/**
 * Task #259 — per-user "Insight Mode". When ON, components that opt
 * in (e.g. <InsightAlert>) reframe warning copy into opportunity tone
 * (teal). Persists to `users.admin_prefs.insightMode` via
 * `PATCH /users/me/preferences`; localStorage mirror gives an
 * optimistic first paint before /auth/me resolves.
 */
export function useInsightMode() {
  const qc = useQueryClient();
  const cached = qc.getQueryData<CachedUser | null>(ME_KEY) ?? null;
  const serverFlag = cached?.adminPrefs?.insightMode;
  const [enabled, setEnabled] = useState<boolean>(
    typeof serverFlag === "boolean" ? serverFlag : readLocal(),
  );

  useEffect(() => {
    if (typeof serverFlag === "boolean") {
      setEnabled(serverFlag);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, serverFlag ? "1" : "0");
      }
    }
  }, [serverFlag]);

  const setMode = useCallback(
    async (next: boolean) => {
      setEnabled(next);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      }
      // Optimistic adminPrefs patch on the cached /auth/me object so
      // any consumer reading the cache (header pill, settings tab)
      // re-renders without waiting for a refetch round-trip.
      qc.setQueryData<CachedUser | null>(ME_KEY, (old) =>
        old
          ? {
              ...old,
              adminPrefs: { ...(old.adminPrefs ?? {}), insightMode: next },
            }
          : old,
      );
      try {
        await updateMyPreferences({ insightMode: next });
      } catch {
        // Roll back on failure.
        setEnabled(!next);
        qc.setQueryData<CachedUser | null>(ME_KEY, (old) =>
          old
            ? {
                ...old,
                adminPrefs: { ...(old.adminPrefs ?? {}), insightMode: !next },
              }
            : old,
        );
      }
    },
    [qc],
  );

  const toggle = useCallback(() => {
    void setMode(!enabled);
  }, [enabled, setMode]);

  return { enabled, setMode, toggle };
}
