import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { setActiveCompanyKey } from "@/lib/query-client";
import { syncWorkspaceIdentity } from "@/lib/workspace-responsibility";

export type AuthCompany = {
  id: number;
  name: string;
  role: string;
  isDefault: boolean;
  isActive: boolean;
};

export type AuthUser = {
  id: number;
  name: string;
  email: string | null;
  role: string;
  branchId: number | null;
  preferredBranchId: number | null;
  avatarUrl: string | null;
  companyId: number | null;
  /**
   * Active company's business sector (set in onboarding). Drives the POS
   * layout: `retail` → Iconic dense-icon grid, `fb` → Photo-tile menu,
   * everything else → legacy POS. Nullable for legacy sessions whose
   * companies were created before the column existed.
   */
  businessType: string | null;
  companies: AuthCompany[];
  /** True only for trusted-device POS cashier sessions. */
  posDevice?: boolean;
  /** Company policy requires a verified second factor before business access. */
  mfaEnrollmentRequired?: boolean;
};

/** Password accepted, second factor pending. Limited session: never cached as /auth/me. */
export type MfaRequired = { mfaRequired: true };
export type LoginResult = AuthUser | MfaRequired;
export const isMfaRequired = (r: unknown): r is MfaRequired =>
  !!r && typeof r === "object" && (r as { mfaRequired?: unknown }).mfaRequired === true;

const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export const ME_KEY = ["auth", "me"] as const;

export function useAuth() {
  const qc = useQueryClient();

  const meQuery = useQuery<AuthUser | null>({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await apiFetch<AuthUser>("/auth/me");
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
    // Conversion/reversion in another owner's session must change navigation
    // without signing the employee out or waiting for a window-focus event.
    refetchInterval: 30_000,
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: (vars: { email: string; password: string }) =>
      apiFetch<LoginResult>("/auth/login", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    // Credentials must not linger in the mutation cache.
    gcTime: 0,
    onSuccess: (result) => {
      // Any prior identity's private cache is dropped before the new state lands.
      qc.clear();
      // A pending-factor session must not populate auth/me or any operational cache.
      if (isMfaRequired(result)) { qc.setQueryData(ME_KEY, null); return; }
      qc.setQueryData(ME_KEY, result);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/auth/logout", { method: "POST" }),
    onSuccess: () => {
      qc.setQueryData(ME_KEY, null);
      qc.clear();
    },
  });

  // Keep the cache-scoping key in sync with the active tenant: any
  // change to /auth/me (initial load OR a switch) must immediately
  // update the module-level company id used by `queryKeyHashFn`.
  useEffect(() => {
    setActiveCompanyKey(meQuery.data?.companyId ?? null);
  }, [meQuery.data?.companyId]);

  // Identity / company / membership-role change resets the scoped
  // responsibility header and drops non-auth query cache.
  const identityKey = meQuery.data
    ? `${meQuery.data.id}:${meQuery.data.companyId ?? "none"}:${meQuery.data.role}`
    : meQuery.isLoading ? null : "anon";
  useEffect(() => {
    if (identityKey !== null) syncWorkspaceIdentity(qc, identityKey);
  }, [identityKey, qc]);

  /** After second-factor verification: drop all private cache and reload identity from the server. */
  const completeMfaLogin = async () => {
    qc.clear();
    const me = await apiFetch<AuthUser>("/auth/me").catch(() => null);
    qc.setQueryData(ME_KEY, me);
    return me;
  };

  return {
    completeMfaLogin,
    user: meQuery.data ?? null,
    isLoading: meQuery.isLoading,
    isAuthenticated: !!meQuery.data,
    login: async (vars: { email: string; password: string }) => {
      try { return await loginMutation.mutateAsync(vars); }
      finally { loginMutation.reset(); }
    },
    loginError: loginMutation.error as Error | null,
    isLoggingIn: loginMutation.isPending,
    logout: logoutMutation.mutateAsync,
    isLoggingOut: logoutMutation.isPending,
  };
}
