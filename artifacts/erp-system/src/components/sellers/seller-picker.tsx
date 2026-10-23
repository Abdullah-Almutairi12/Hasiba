import type { Seller, SellerPolicy } from "@/lib/sellers";

const UNSET = "";

/** Native select: works in POS, dialogs and tests; no cashier default. */
export function SellerSelect({
  sellers, value, onChange, disabled, allowEmpty, emptyLabel, testId, label, className,
}: {
  sellers: Seller[]; value: number | null | undefined; onChange: (v: number | null) => void;
  disabled?: boolean; allowEmpty: boolean; emptyLabel: string; testId: string; label: string; className?: string;
}) {
  return (
    <select
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      value={typeof value === "number" ? String(value) : UNSET}
      onChange={(e) => onChange(e.target.value === UNSET ? null : Number(e.target.value))}
      className={className ?? "h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"}
    >
      <option value={UNSET} disabled={!allowEmpty}>{emptyLabel}</option>
      {sellers.map((x) => (
        <option key={x.id} value={x.id}>{x.name}{x.employeeNo ? ` (${x.employeeNo})` : ""}</option>
      ))}
    </select>
  );
}

export function wholeEmptyLabel(policy: SellerPolicy) {
  return policy.mode === "required" ? "اختر البائع (إلزامي)" : "بدون بائع";
}
