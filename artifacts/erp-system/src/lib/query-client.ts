import { QueryClient, hashKey, type QueryKey } from "@tanstack/react-query";

/**
 * Multi-Company Phase 4: cache scoping.
 *
 * Every tenant-scoped query is silently namespaced by the active company
 * id via `queryKeyHashFn`. The generated Orval hooks key by URL (e.g.
 * `["/api/products"]`) which would otherwise collide across tenants — by
 * folding the active company id into the hash, the cache treats the same
 * URL as two distinct entries when the company changes.
 *
 * Auth queries (`["auth", ...]`) are intentionally NOT scoped: the user
 * identity and company list must survive a switch.
 */
let activeCompanyKey: number | null = null;

/**
 * Sync the module-level company id used for cache hashing. Call this
 * whenever `/auth/me` resolves (initial load) or after a successful
 * `/auth/switch-company` mutation.
 */
export function setActiveCompanyKey(v: number | null): void {
  activeCompanyKey = v;
}

export function getActiveCompanyKey(): number | null {
  return activeCompanyKey;
}

function isAuthKey(queryKey: QueryKey): boolean {
  const head = queryKey?.[0];
  if (head === "auth") return true;
  if (
    Array.isArray(head) &&
    (head as readonly unknown[])[0] === "auth"
  ) {
    return true;
  }
  return false;
}

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: (queryKey) => {
          const base = hashKey(queryKey);
          if (isAuthKey(queryKey)) return base;
          return `co:${activeCompanyKey ?? "none"}|${base}`;
        },
      },
    },
  });
}
