import { InvoiceDesignSchema, type InvoiceDesign } from "../invoice-design";
/** Values enter CSS only after closed-enum/numeric/hex validation. All free
 * text is escaped by printHtml, never interpolated into a stylesheet. */
export function invoiceDesignStyle(value: InvoiceDesign, thermal: boolean) {
  const d = InvoiceDesignSchema.parse(value);
  const logo = d.logoPosition === "center" ? "auto" : d.logoPosition === "end" ? "0 auto" : "auto 0";
  const base = `body{font-family:${d.font === "Tajawal" ? "Tajawal" : "Arial,Tajawal"},sans-serif;font-size:${thermal ? 11 : d.fontSize}px;font-feature-settings:"liga" 0,"rlig" 0}
    header{border-color:${d.accent}}.brand-logo{display:block;width:${thermal ? Math.min(d.logoWidth,32) : d.logoWidth}mm;height:auto;max-width:100%;max-height:24mm;margin-inline:${logo}}
    .design-header{font-size:13px}.design-footer{border-top:1px solid ${d.accent};padding-top:8px;break-inside:avoid}
    .qr{display:block;margin:12px auto;break-inside:avoid}header,.totals,tr{break-inside:avoid}`;
  if (thermal) return base + `header{text-align:center;border-bottom:1px dashed #555}dl{display:block}dt{float:right;clear:right;margin-left:8px}dd{min-height:20px}table{font-size:10px}th,td{padding:4px 2px}.totals{width:100%}`;
  const variants: Record<InvoiceDesign["preset"], string> = {
    formal: `header{text-align:center;padding-bottom:18px}h1{margin-top:18px}dl{grid-template-columns:1fr 2fr 1fr 2fr;border:1px solid #bac4d0;padding:12px}th,td{border:1px solid #bac4d0}.totals{width:60%}`,
    simple: `header{border:0;padding-bottom:0}h1{font-size:20px}dl{display:block;columns:2;column-gap:30px}dt,dd{display:block;break-inside:avoid}dd{margin-bottom:8px}th{background:transparent}th,td{padding:9px 4px}.totals{width:70%}`,
    commercial: `header{border-bottom:0;border-inline-start:7px solid ${d.accent};padding-inline-start:18px}h1{text-align:end;font-size:27px}dl{grid-template-columns:1fr 2fr 1fr 2fr;background:#f5f7fa;padding:12px}.totals{border:2px solid #526172;width:58%}.totals td{padding:10px}`,
    modern: `header{display:grid;grid-template-columns:1fr 1fr;gap:4px 22px}header h1{grid-column:2;grid-row:1/5;text-align:end;font-size:32px;align-self:center}header .brand-logo{grid-column:1}header h2,header p{grid-column:1}dl{grid-template-columns:1fr 2fr 1fr 2fr 1fr 2fr;gap:10px}th{border-bottom:2px solid ${d.accent};background:transparent}.totals{width:52%;margin-top:25px}`,
    ink: `body{color:#111;line-height:1.45}header{display:flex;flex-wrap:wrap;gap:5px 16px;border:0}header h1{width:100%;font-size:20px}header p{margin:0}dl{grid-template-columns:1fr 3fr 1fr 3fr;margin:8px 0;gap:2px 8px}th,.totals tr:last-child{background:transparent}th,td{padding:4px 5px;border-bottom:1px solid #aaa}.totals{width:55%}`,
  };
  return base + variants[d.preset];
}
