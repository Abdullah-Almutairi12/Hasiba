import { cn } from "@/lib/utils";

/**
 * Official Saudi Riyal symbol (SAMA, February 2025).
 *
 * Inline SVG so it renders identically across browsers/OS regardless of font
 * support for the Unicode codepoint U+20C0 (Saudi Riyal Sign), which was added
 * in Unicode 17.0 but is not yet shipped with all system fonts.
 *
 * The path uses `fill="currentColor"` so the symbol picks up the surrounding
 * text colour. The default size is `1em` so it scales with the parent's font.
 */
export function RiyalSymbol({
  className,
  ariaLabel = "ريال سعودي",
}: {
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox="0 0 1124.14 1256.39"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(
        "inline-block size-[0.95em] shrink-0 fill-current align-[-0.125em]",
        className,
      )}
    >
      <path d="M699.62 1113.02h0c-20.06 44.48-33.32 92.75-38.4 143.37l424.51-90.24c20.06-44.47 33.31-92.75 38.4-143.37l-424.51 90.24Z" />
      <path d="M1085.73 895.8c20.06-44.47 33.32-92.75 38.4-143.37l-330.68 70.33v-135.2l292.27-62.11c20.06-44.47 33.32-92.75 38.4-143.37L793.45 545.4V0h-83.84c-46.49 0-84.2 37.71-84.2 84.2v559.45l-87.95 18.7V0h-83.84c-46.49 0-84.2 37.71-84.2 84.2v603.55L0 794.61c.01.99-.34 51.47 38.4 143.37l400.99-85.27v152.78L0 1099.97c.01.99-.34 51.47 38.4 143.37l400.99-85.27v98.28h83.84c46.49 0 84.2-37.71 84.2-84.2v-50.92l87.95-18.7v153.82h83.84c46.49 0 84.2-37.71 84.2-84.2v-87.51l221.13-47.04Zm-622.97-200.74l87.95-18.7v135.2l-87.95 18.7v-135.2Z" />
    </svg>
  );
}

type MoneyProps = {
  value: number | string | null | undefined;
  /** Number of decimals. Defaults to 2 for precise figures, pass 0 for KPIs. */
  fractionDigits?: 0 | 2;
  className?: string;
  /** Optional className applied to the SVG only (size/opacity tweaks). */
  symbolClassName?: string;
};

/**
 * Renders an Arabic-locale formatted number followed by the official Riyal
 * symbol. Use this anywhere we previously printed `<n> ر.س` or relied on
 * `Intl.NumberFormat({ style: "currency", currency: "SAR" })`.
 */
export function Money({
  value,
  fractionDigits = 2,
  className,
  symbolClassName,
}: MoneyProps) {
  const numeric = Number(value ?? 0);
  const safe = Number.isFinite(numeric) ? numeric : 0;
  const formatted = safe.toLocaleString("ar-SA", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap tabular-nums",
        className,
      )}
    >
      <span>{formatted}</span>
      <RiyalSymbol className={cn("opacity-80", symbolClassName)} />
    </span>
  );
}

/**
 * String-only formatter for places that cannot render JSX (chart tooltips,
 * window.alert(), copy-to-clipboard). Uses the new official Unicode codepoint
 * U+20C0 ("⃀"). Browsers/OS that lack a font with the glyph will fall back to
 * the placeholder square; for visual UI use the <Money/> component instead.
 */
export function formatRiyal(
  value: number | string | null | undefined,
  fractionDigits: 0 | 2 = 2,
): string {
  const numeric = Number(value ?? 0);
  const safe = Number.isFinite(numeric) ? numeric : 0;
  const formatted = safe.toLocaleString("ar-SA", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  return `${formatted}\u00A0\u20C0`;
}

/**
 * Number-only Arabic-locale formatter. Use when you need just the digits
 * (e.g. "ميزانية: <input> [Money symbol]" labels).
 */
export function formatNumberAR(
  value: number | string | null | undefined,
  fractionDigits: 0 | 2 = 0,
): string {
  const numeric = Number(value ?? 0);
  const safe = Number.isFinite(numeric) ? numeric : 0;
  return safe.toLocaleString("ar-SA", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}
