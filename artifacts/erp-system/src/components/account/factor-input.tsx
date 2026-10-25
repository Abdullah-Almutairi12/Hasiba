import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FactorMode } from "@/lib/account-security";

/** Six-digit authenticator code OR a one-time 48-hex recovery code. */
export function FactorInput({ id, mode, onMode, value, onChange, disabled }: {
  id: string; mode: FactorMode; onMode: (m: FactorMode) => void; value: string; onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{mode === "totp" ? "رمز تطبيق المصادقة (6 أرقام)" : "رمز استرداد لمرة واحدة"}</Label>
        <button type="button" disabled={disabled} className="text-[11px] font-bold text-primary hover:underline disabled:opacity-50"
          onClick={() => { onChange(""); onMode(mode === "totp" ? "recovery" : "totp"); }} data-testid={`toggle-factor-${id}`}>
          {mode === "totp" ? "استخدام رمز استرداد" : "استخدام تطبيق المصادقة"}
        </button>
      </div>
      <Input id={id} dir="ltr" autoComplete="one-time-code" disabled={disabled}
        inputMode={mode === "totp" ? "numeric" : "text"} maxLength={mode === "totp" ? 6 : 60}
        className="font-mono tracking-widest" value={value}
        onChange={(e) => onChange(mode === "totp" ? e.target.value.replace(/\D/g, "").slice(0, 6) : e.target.value)}
        placeholder={mode === "totp" ? "000000" : "48 حرفًا ست عشريًا"} data-testid={`input-factor-${id}`} />
    </div>
  );
}
