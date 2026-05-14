const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;
const TOKEN_KEY = "hasba.portal.token";
const PORTAL_KEY = "hasba.portal.kind";

export type PortalKind = "customer" | "supplier" | "employee";

export function getPortalToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getPortalKind(): PortalKind | null {
  const v = localStorage.getItem(PORTAL_KEY);
  return v === "customer" || v === "supplier" || v === "employee" ? v : null;
}

export function setPortalSession(token: string, kind: PortalKind): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(PORTAL_KEY, kind);
}

export function clearPortalSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PORTAL_KEY);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getPortalToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export const portalApi = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body: unknown) =>
    request<T>(p, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(p: string, body: unknown) =>
    request<T>(p, { method: "PATCH", body: JSON.stringify(body) }),
};
