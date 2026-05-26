import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  updateMyPreferences,
  useGetMyPreferences,
  getGetMyPreferencesQueryKey,
} from "@workspace/api-client-react";

const STORAGE_KEY = "hasba.insight-mode";

function readLocal(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

/**
 * Task #259 — per-user "Insight Mode". When ON, components that opt
 * in (e.g. <InsightAlert>) reframe warning copy into opportunity tone
 * (teal). Source of truth is the server (`users.admin_prefs.insightMode`)
 * via `GET /users/me/preferences`; localStorage is a transient
 * pre-hydration mirror so the first paint isn't a flash of the wrong
 * mode while the network round-trip resolves.
 */
export function useInsightMode() {
  const qc = useQueryClient();
  const { data: prefs } = useGetMyPreferences({
    query: {
      queryKey: getGetMyPreferencesQueryKey(),
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  });
  const serverFlag = prefs?.adminPrefs?.insightMode;
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
      try {
        await updateMyPreferences({ insightMode: next });
        // Invalidate the canonical server cache so other mounted
        // useInsightMode consumers reflect the latest value.
        void qc.invalidateQueries({
          queryKey: getGetMyPreferencesQueryKey(),
        });
      } catch {
        setEnabled(!next);
      }
    },
    [qc],
  );

  const toggle = useCallback(() => {
    void setMode(!enabled);
  }, [enabled, setMode]);

  return { enabled, setMode, toggle };
}
