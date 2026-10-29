// Test-only: server-shaped tax preview responses for page tests. Values are
// fixed fixtures (as a server would return), not a client tax computation.
export function mockPreviewResponse(opts: { mode?: "legacy" | "unified"; status?: string; registered?: boolean; token?: string; vat?: number; total?: number; subtotal?: number; discount?: number; lines?: Array<{ productId: number | null; description?: string; quantity: number; taxCategory?: string; inputUnitPrice?: number }>; expiresInMs?: number } = {}) {
  const registered = opts.registered ?? true;
  return {
    context: { mode: opts.mode ?? "legacy", status: opts.status ?? (registered ? "registered" : "not_registered"), registered, priceIncludesVat: false, token: `ctx-${opts.token ?? "t"}` },
    totals: {
      subtotal: opts.subtotal ?? 100, discount: opts.discount ?? 0, vat: opts.vat ?? 15, total: opts.total ?? 115,
      lines: (opts.lines ?? [{ productId: 1, quantity: 1 }]).map((l) => ({ productId: l.productId, description: l.description ?? `#${l.productId}`, quantity: l.quantity, unitPrice: 0, discountPct: 0, taxRate: registered ? 15 : 0, taxCategory: l.taxCategory ?? "standard", lineSubtotal: 0, lineDiscount: 0, lineNet: 0, lineVat: 0, lineTotal: 0, ...(l.inputUnitPrice === undefined ? {} : { inputUnitPrice: l.inputUnitPrice }) })),
    },
    previewToken: `pv-${opts.token ?? "t"}`,
    expiresAt: new Date(Date.now() + (opts.expiresInMs ?? 5 * 60_000)).toISOString(),
  };
}

/**
 * Test-only fake of POST /api/pos/tax-preview: answers like the server for a
 * fixed price list. Returns null for any other request.
 */
export function posPreviewServer(input: RequestInfo | URL, init: RequestInit | undefined, cfg: { prices: Record<number, number>; registered?: boolean; mode?: "legacy" | "unified"; token?: string; log?: unknown[] }): Response | null {
  if (!String(input).split("?")[0].endsWith("/api/pos/tax-preview") || init?.method !== "POST") return null;
  const b = JSON.parse(String(init.body)) as { items: Array<{ productId: number; quantity: number }>; discount?: number };
  cfg.log?.push(b);
  const registered = cfg.registered ?? false;
  const subtotal = b.items.reduce((a, i) => a + (cfg.prices[i.productId] ?? 0) * i.quantity, 0);
  const discount = b.discount ?? 0;
  const vat = registered ? Math.round((subtotal - discount) * 15) / 100 : 0;
  return Response.json(mockPreviewResponse({ mode: cfg.mode, registered, token: cfg.token ?? "pos", subtotal, discount, vat, total: subtotal - discount + vat,
    lines: b.items.map((i) => ({ productId: i.productId, quantity: i.quantity, inputUnitPrice: cfg.prices[i.productId] ?? 0 })) }));
}
