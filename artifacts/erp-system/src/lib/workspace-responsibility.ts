import { useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { setWorkspaceResponsibility } from "@workspace/api-client-react";

/**
 * Scoped-workspace selection. Memory only: never written to storage, URL
 * or logs. The id is a selector, not authority — the server re-verifies
 * identity, company and the actual assignment on every request.
 */
export type SelectedResponsibility = {
  id: number;
  resource: string;
  branchId: number;
  /** Live effective actions (grant actions minus denied), from /workspace/access. */
  actions: string[];
  /** Company VAT registration as checkout sees it; null = not yet known. */
  vatRegistered: boolean | null;
};

type AccessLike = {
  status: string;
  grants: Array<{ id: number; resource: string; branchId: number; actions: string[] }>;
  deniedActions: string[];
  vatRegistered?: boolean;
};

/** Effective actions for one grant: its actions minus any denied action. */
export function effectiveActions(access: AccessLike, grantId: number): string[] {
  const g = access.grants.find((x) => x.id === grantId);
  if (!g || access.status !== "active") return [];
  return g.actions.filter((a) => !access.deniedActions.includes(a));
}

/** Build a selection snapshot from live access (nothing guessed). */
export function selectionFromAccess(access: AccessLike, grantId: number): SelectedResponsibility | null {
  const g = access.grants.find((x) => x.id === grantId);
  if (!g) return null;
  return {
    id: g.id, resource: g.resource, branchId: g.branchId,
    actions: effectiveActions(access, grantId),
    vatRegistered: typeof access.vatRegistered === "boolean" ? access.vatRegistered : null,
  };
}

/**
 * Refresh actions/VAT of the CURRENT selection from live access without
 * changing which responsibility is selected and without clearing cache.
 */
export function refreshSelectedFromAccess(access: AccessLike): void {
  if (!selected) return;
  const next = selectionFromAccess(access, selected.id);
  if (!next || next.resource !== selected.resource || next.branchId !== selected.branchId) return;
  if (next.vatRegistered === selected.vatRegistered &&
    next.actions.length === selected.actions.length && next.actions.every((a, i) => a === selected!.actions[i])) return;
  selected = next;
  emit();
}

let selected: SelectedResponsibility | null = null;
let identityKey = "";
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function isAuthQuery(key: readonly unknown[]): boolean {
  const head = key?.[0];
  return head === "auth" || (Array.isArray(head) && head[0] === "auth");
}

/**
 * Drops cached server data (except the auth identity) so nothing fetched
 * under a previous identity/company/responsibility is shown under the new
 * one. Only the React Query cache is touched — the financial retry
 * evidence held by financialFetch lives elsewhere and is preserved.
 */
export function clearScopedQueryCache(qc: QueryClient): void {
  const predicate = (q: { queryKey: readonly unknown[] }) => !isAuthQuery(q.queryKey);
  void qc.cancelQueries({ predicate });
  qc.removeQueries({ predicate });
}

export function getSelectedResponsibility(): SelectedResponsibility | null {
  return selected;
}

export function selectResponsibility(
  qc: QueryClient,
  next: SelectedResponsibility | null,
): void {
  if (
    (selected === null && next === null) ||
    (selected && next && selected.id === next.id && selected.resource === next.resource && selected.branchId === next.branchId)
  ) {
    // Same responsibility: only refresh live actions/VAT, no cache reset.
    if (selected && next) { selected = { ...next, actions: [...next.actions] }; emit(); }
    return;
  }
  selected = next ? { ...next, actions: [...next.actions] } : null;
  setWorkspaceResponsibility(selected ? selected.id : null);
  clearScopedQueryCache(qc);
  emit();
}

/**
 * Call whenever the authenticated identity or active company resolves.
 * A change resets the selection and header and clears scoped cache.
 */
export function syncWorkspaceIdentity(qc: QueryClient, key: string): void {
  if (key === identityKey) return;
  const hadIdentity = identityKey !== "";
  identityKey = key;
  const hadSelection = selected !== null;
  selected = null;
  setWorkspaceResponsibility(null);
  if (hadIdentity || hadSelection) clearScopedQueryCache(qc);
  if (hadSelection) emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useSelectedResponsibility(): SelectedResponsibility | null {
  return useSyncExternalStore(subscribe, () => selected, () => null);
}

/** Test-only reset. */
export function __resetWorkspaceResponsibility(): void {
  selected = null;
  identityKey = "";
  setWorkspaceResponsibility(null);
  emit();
}
