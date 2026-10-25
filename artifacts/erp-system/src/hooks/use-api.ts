import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { financialFetch,getWorkspaceResponsibility,WORKSPACE_RESPONSIBILITY_HEADER } from "@workspace/api-client-react";

const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;
function workspaceHeaders(input?:HeadersInit):Headers{
  const headers=new Headers(input),selected=getWorkspaceResponsibility();
  if(selected&&!headers.has(WORKSPACE_RESPONSIBILITY_HEADER))headers.set(WORKSPACE_RESPONSIBILITY_HEADER,selected);
  return headers;
}

export async function apiGet<T>(path: string, headers?: HeadersInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include", headers:workspaceHeaders(headers) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await financialFetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: workspaceHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error(data?.error ?? `HTTP ${res.status}`),{status:res.status});
  }
  return (await res.json()) as T;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    credentials: "include",
    headers: workspaceHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    credentials: "include",
    headers:workspaceHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export function useApiQuery<T>(
  path: string,
  options?: { enabled?: boolean; refetchInterval?: number },
) {
  return useQuery<T>({
    queryKey: [path],
    queryFn: () => apiGet<T>(path),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
  });
}

export function useApiMutation<TBody, TResp>(path: string, invalidate?: string[]) {
  const qc = useQueryClient();
  return useMutation<TResp, Error, TBody>({
    mutationFn: (body) => apiPost<TResp>(path, body),
    onSuccess: () => {
      invalidate?.forEach((p) => qc.invalidateQueries({ queryKey: [p] }));
    },
  });
}
