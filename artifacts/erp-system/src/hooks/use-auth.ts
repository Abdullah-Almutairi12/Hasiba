import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { setActiveCompanyKey } from "@/lib/query-client";

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
  email: string;
  role: string;
  branchId: number | null;
  avatarUrl: string | null;
  companyId: number | null;
  companies: AuthCompany[];
};

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
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: (vars: { email: string; password: string }) =>
      apiFetch<AuthUser>("/auth/login", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: (user) => {
      qc.setQueryData(ME_KEY, user);
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

  return {
    user: meQuery.data ?? null,
    isLoading: meQuery.isLoading,
    isAuthenticated: !!meQuery.data,
    login: loginMutation.mutateAsync,
    loginError: loginMutation.error as Error | null,
    isLoggingIn: loginMutation.isPending,
    logout: logoutMutation.mutateAsync,
    isLoggingOut: logoutMutation.isPending,
  };
}
