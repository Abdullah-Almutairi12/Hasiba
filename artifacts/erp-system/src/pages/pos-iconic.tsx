import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShoppingCart,
  User,
  CreditCard,
  MoreHorizontal,
  Plus,
  Minus,
  X,
  Search,
  Play,
  Trash2,
  Pause,
  Check,
} from "lucide-react";
import {
  useListProducts,
  useListProductCategories,
  useListPosSessions,
} from "@workspace/api-client-react";
import type { CreatePosOrderBody } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { usePosCheckout, type PosProduct as Product, type PosCartItem as CartItem } from "@/hooks/use-pos-checkout";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { useVatEnabled } from "@/hooks/use-vat-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ParkedOrder = {
  id: number;
  orderNumber: string;
  parkedLabel: string | null;
  customerId: number | null;
  items: Array<{
    productId: number;
    quantity: number;
    priceSnapshot?: number;
    nameSnapshot?: string;
  }>;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  createdAt: string;
};

/**
 * Iconic POS — sector-aware redesign.
 *
 * Layout: side-rail live cart + iconic product grid (retail) OR
 * photo-tile grid (F&B). Floating bottom Dock replaces traditional
 * buttons. Order Parking (hold/resume) is a primary feature, gated
 * by long-press on the 🅿️ dock pill.
 *
 * Reuses /api/pos hooks for sessions and order creation, and the
 * three new Task #266 endpoints for park/parked/resume.
 */
export default function PosIconic({
  variant,
}: {
  variant: "retail" | "fb";
}) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const vatEnabled = useVatEnabled();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const checkout = usePosCheckout(user?.companyId ? `${user.id}:${user.companyId}` : null);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [parkedOpen, setParkedOpen] = useState(false);
  const [parkLabel, setParkLabel] = useState("");
  const [paymentMethod, setPaymentMethod] =
    useState<"cash" | "card" | "stc" | "transfer">("card");
  const [success, setSuccess] = useState<{
    orderNumber: string;
    total: number;
  } | null>(null);
  const [parkedList, setParkedList] = useState<ParkedOrder[]>([]);
  const [isParkingActive, setIsParkingActive] = useState(false);

  const { data: products } = useListProducts({
    search: search || undefined,
    category: categoryId?.toString(),
  });
  const { data: categories } = useListProductCategories();
  const { data: sessions, refetch: refetchSessions } = useListPosSessions({
    query: { refetchInterval: 15_000, staleTime: 0, refetchOnWindowFocus: true },
  });
  const activeSession = sessions?.find((s) => s.status === "open");
  const checkoutLocked = !!checkout.attempt || checkout.isPending || !checkout.ready;

  useEffect(() => { setCart([]); }, [user?.id, user?.companyId]);
  useEffect(() => {
    if (!checkout.attempt) return;
    setCart(checkout.attempt.cart);
    setPaymentMethod(checkout.attempt.body.paymentMethod as typeof paymentMethod);
  }, [checkout.attempt]);

  // Live tally of parked orders for the Dock badge
  const refreshParked = useMemo(
    () => async () => {
      if (!activeSession) return;
      const base = import.meta.env.BASE_URL;
      try {
        const r = await fetch(
          `${base}api/pos/orders/parked?sessionId=${activeSession.id}`,
          { credentials: "include" },
        );
        if (r.ok) setParkedList(await r.json());
      } catch {
        // best-effort
      }
    },
    [activeSession],
  );

  useEffect(() => {
    void refreshParked();
  }, [refreshParked]);

  const subtotal = useMemo(
    () =>
      cart.reduce((acc, ci) => acc + Number(ci.product.price) * ci.quantity, 0),
    [cart],
  );
  const tax = vatEnabled ? subtotal * 0.15 : 0;
  const total = subtotal + tax;

  const addToCart = (p: Product) => {
    if (checkoutLocked) return;
    setCart((prev) => {
      const ex = prev.find((c) => c.product.id === p.id);
      if (ex) {
        return prev.map((c) =>
          c.product.id === p.id ? { ...c, quantity: c.quantity + 1 } : c,
        );
      }
      return [...prev, { product: p, quantity: 1 }];
    });
  };

  const bump = (id: number, delta: number) =>
    setCart((prev) =>
      checkoutLocked ? prev : prev.flatMap((c) => {
        if (c.product.id !== id) return [c];
        const q = c.quantity + delta;
        return q <= 0 ? [] : [{ ...c, quantity: q }];
      }),
    );

  const clearCart = () => { if (!checkoutLocked) setCart([]); };

  const handlePark = async (labelOverride?: string) => {
    if (checkoutLocked || !activeSession || cart.length === 0) return;
    const base = import.meta.env.BASE_URL;
    const label = (labelOverride ?? parkLabel).trim();
    const res = await fetch(`${base}api/pos/orders/park`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: activeSession.id,
        label: label || null,
        items: cart.map((c) => ({
          productId: c.product.id,
          quantity: c.quantity,
          priceSnapshot: Number(c.product.price),
          nameSnapshot: c.product.name,
        })),
        subtotal: Number(subtotal.toFixed(2)),
        tax: Number(tax.toFixed(2)),
        discount: 0,
        total: Number(total.toFixed(2)),
      }),
    });
    if (!res.ok) {
      toast({ title: t("pos_iconic.park_failed"), variant: "destructive" });
      return;
    }
    setCart([]);
    setParkLabel("");
    void refreshParked();
    setIsParkingActive(true);
    setTimeout(() => setIsParkingActive(false), 700);
    toast({ title: t("pos_iconic.parked_ok") });
  };

  const handleResume = async (id: number) => {
    if (checkoutLocked) return;
    if (!activeSession) {
      toast({ title: t("pos_iconic.no_session"), variant: "destructive" });
      return;
    }
    const base = import.meta.env.BASE_URL;
    const res = await fetch(`${base}api/pos/orders/${id}/resume`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: activeSession.id }),
    });
    if (!res.ok) {
      toast({ title: t("pos_iconic.resume_failed"), variant: "destructive" });
      return;
    }
    const data = (await res.json()) as ParkedOrder;
    // Rehydrate cart from parked snapshot. We map back into the
    // `products` cache when available so the live price/name reflect
    // current state; fall back to snapshot for missing products.
    const productMap = new Map<number, Product>(
      (products ?? []).map((p) => [p.id, p as Product]),
    );
    const restored: CartItem[] = data.items.map((it) => {
      const live = productMap.get(it.productId);
      const fallback: Product = {
        id: it.productId,
        name: it.nameSnapshot ?? `#${it.productId}`,
        price: it.priceSnapshot ?? 0,
      };
      return { product: live ?? fallback, quantity: it.quantity };
    });
    setCart(restored);
    setParkedOpen(false);
    void refreshParked();
    toast({ title: t("pos_iconic.resumed_ok") });
  };

  const handleCancelParked = async (id: number) => {
    // Cancel == resume + discard (the resume endpoint deletes the row).
    if (checkoutLocked || !activeSession) return;
    const base = import.meta.env.BASE_URL;
    const res = await fetch(`${base}api/pos/orders/${id}/resume`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: activeSession.id }),
    });
    if (res.ok) {
      void refreshParked();
      toast({ title: t("pos_iconic.cancelled_ok") });
    }
  };

  const handlePay = async () => {
    if (!checkout.attempt && !activeSession) {
      toast({
        title: t("pos_iconic.no_session"),
        variant: "destructive",
      });
      return;
    }
    if (cart.length === 0) return;
    const body: CreatePosOrderBody = {
      sessionId: checkout.attempt?.body.sessionId ?? activeSession!.id,
      items: cart.map((c) => ({
        productId: c.product.id,
        quantity: c.quantity,
      })),
      discount: 0,
      paymentMethod,
    };
    const created = await checkout.pay(body, cart);
    if (!created) {
      // Another till/manager may have closed the shift since the last read.
      // Recovery stays available through its saved intent, even without an
      // active shift; a new sale must use fresh server session information.
      void refetchSessions();
      return;
    }
    setSuccess({ orderNumber: created.orderNumber, total: Number(created.total) });
    setCart([]);
    void queryClient.invalidateQueries();
    setTimeout(() => setSuccess(null), 2200);
  };

  // ---- Render ----

  return (
    <div
      dir={language === "ar" ? "rtl" : "ltr"}
      data-testid="page-pos-iconic"
      className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100 dark:from-neutral-950 dark:via-neutral-900 dark:to-black text-neutral-900 dark:text-neutral-100"
    >
      {/* Status strip */}
      <div className="flex items-center gap-3 px-4 py-2 text-xs text-neutral-500 dark:text-neutral-400">
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", activeSession ? "bg-emerald-500" : "bg-neutral-400")} />
          {activeSession
            ? t("pos_iconic.session_open")
            : t("pos_iconic.session_closed")}
        </span>
        <span>•</span>
        <span>
          {variant === "fb"
            ? t("pos_iconic.mode_fb")
            : t("pos_iconic.mode_retail")}
        </span>
        <button
          onClick={() => setLocation("/returns")}
          className="ms-auto rounded-md px-2 py-1 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60"
          data-testid="button-pos-returns"
        >
          {language === "ar" ? "المرتجعات" : "Returns"}
        </button>
        <button
          onClick={() => setLocation("/")}
          className=" rounded-md px-2 py-1 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60"
          data-testid="button-pos-exit"
        >
          ✕ {t("pos_iconic.exit")}
        </button>
      </div>

      <div className="grid min-h-[calc(100vh-2.25rem)] grid-cols-1 gap-3 px-3 pb-4 lg:h-[calc(100vh-2.25rem)] lg:grid-cols-[minmax(0,1fr)_360px] lg:pb-28">
        {/* LEFT: search + categories + product grid */}
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("pos_iconic.search_ph")}
                className="ps-9 h-11 rounded-2xl border-neutral-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/60"
                data-testid="input-pos-search"
              />
            </div>
          </div>

          {/* Category chips */}
          <div className="flex flex-wrap gap-2 overflow-x-auto pb-1">
            <CategoryChip
              active={categoryId === null}
              onClick={() => setCategoryId(null)}
              label={t("pos_iconic.all")}
              emoji="🗂"
            />
            {(categories ?? []).map((c) => (
              <CategoryChip
                key={c.id}
                active={categoryId === c.id}
                onClick={() => setCategoryId(c.id)}
                label={language === "ar" ? c.nameAr || c.name : c.name}
                emoji="📦"
              />
            ))}
          </div>

          {/* Product grid */}
          <div
            className={cn(
              "max-h-[50vh] min-h-48 flex-1 overflow-y-auto rounded-3xl border border-neutral-200/70 bg-white/60 p-3 backdrop-blur lg:max-h-none lg:min-h-0 dark:border-neutral-800/70 dark:bg-neutral-900/40",
              variant === "fb"
                ? "grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3"
                : "grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2.5",
            )}
            data-testid={`grid-pos-${variant}`}
          >
            {(products ?? []).map((p) =>
              variant === "fb" ? (
                <PhotoTile
                  key={p.id}
                  product={p as Product}
                  onTap={() => addToCart(p as Product)}
                />
              ) : (
                <IconCell
                  key={p.id}
                  product={p as Product}
                  onTap={() => addToCart(p as Product)}
                />
              ),
            )}
          </div>
        </div>

        {/* RIGHT: Live cart rail */}
        <LiveCartRail
          cart={cart}
          subtotal={subtotal}
          tax={tax}
          total={total}
          vatEnabled={vatEnabled}
          onBump={bump}
          onClear={clearCart}
          onPay={handlePay}
          method={paymentMethod}
          setMethod={setPaymentMethod}
          locked={checkoutLocked}
          recovery={!!checkout.attempt}
          busy={checkout.isPending}
          ready={checkout.ready}
          checkoutError={checkout.error}
        />
      </div>

      {/* Floating dock */}
      <FloatingDock
        parkedCount={parkedList.length}
        cartCount={cart.length}
        isParkingActive={isParkingActive}
        onPark={() => handlePark()}
        onOpenParked={() => setParkedOpen(true)}
        onOpenPay={handlePay}
        payDisabled={!checkout.ready || checkout.isPending || cart.length === 0}
      />

      {/* Parked overlay */}
      <AnimatePresence>
        {parkedOpen && (
          <ParkedOverlay
            parked={parkedList}
            onClose={() => setParkedOpen(false)}
            onResume={handleResume}
            onCancel={handleCancelParked}
            parkLabel={parkLabel}
            setParkLabel={setParkLabel}
            canPark={cart.length > 0}
            onParkNow={() => handlePark()}
          />
        )}
      </AnimatePresence>

      {/* Success wave */}
      <AnimatePresence>
        {success && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none fixed inset-0 z-[80] grid place-items-center"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: [0, 1.4, 1] }}
              transition={{ duration: 0.6 }}
              className="grid size-44 place-items-center rounded-full bg-emerald-500/95 text-white shadow-2xl shadow-emerald-500/40"
            >
              <div className="text-center">
                <Check className="mx-auto size-12" />
                <div className="mt-1 text-xs">{success.orderNumber}</div>
                <div className="font-mono text-lg font-bold">
                  {success.total.toFixed(2)}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------- helpers ----------

function CategoryChip({
  active,
  onClick,
  label,
  emoji,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  emoji: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
        active
          ? "border-neutral-900 bg-neutral-900 text-white shadow-md dark:border-white dark:bg-white dark:text-neutral-900"
          : "border-neutral-200 bg-white/70 text-neutral-600 hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-300",
      )}
    >
      <span>{emoji}</span>
      <span>{label}</span>
    </button>
  );
}

function IconCell({
  product,
  onTap,
}: {
  product: Product;
  onTap: () => void;
}) {
  const { language } = useLanguage();
  const low =
    typeof product.stock === "number" &&
    product.stock > 0 &&
    product.stock < 5;
  const out =
    typeof product.stock === "number" && product.stock <= 0;
  return (
    <motion.button
      onClick={() => !out && onTap()}
      whileTap={{ scale: 0.92 }}
      whileHover={{ y: -2 }}
      disabled={out}
      className={cn(
        "group relative flex flex-col items-center gap-1 rounded-2xl border bg-white p-2 text-center shadow-sm transition dark:bg-neutral-900",
        out
          ? "cursor-not-allowed opacity-50"
          : "hover:border-blue-300 hover:shadow-md",
        low ? "border-amber-300" : "border-neutral-200 dark:border-neutral-800",
      )}
      data-testid={`product-icon-${product.id}`}
    >
      <div className="grid size-12 place-items-center rounded-full bg-gradient-to-br from-blue-50 to-indigo-100 text-2xl dark:from-blue-950/40 dark:to-indigo-950/40">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt=""
            className="size-12 rounded-full object-cover"
          />
        ) : (
          <span>📦</span>
        )}
      </div>
      <div className="line-clamp-1 text-[11px] font-medium">
        {language === "ar" ? product.nameAr || product.name : product.name}
      </div>
      <div className="font-mono text-[10px] text-neutral-500">
        {Number(product.price).toFixed(2)}
      </div>
      {low && (
        <span className="absolute end-1 top-1 size-2 rounded-full bg-amber-500" />
      )}
    </motion.button>
  );
}

function PhotoTile({
  product,
  onTap,
}: {
  product: Product;
  onTap: () => void;
}) {
  const { language } = useLanguage();
  const out =
    typeof product.stock === "number" && product.stock <= 0;
  return (
    <motion.button
      onClick={() => !out && onTap()}
      whileTap={{ scale: 0.95 }}
      whileHover={{ y: -3 }}
      disabled={out}
      className={cn(
        "group relative aspect-square overflow-hidden rounded-2xl border bg-white text-start shadow-sm transition dark:bg-neutral-900",
        out
          ? "cursor-not-allowed opacity-50"
          : "hover:shadow-xl hover:shadow-blue-500/10",
        "border-neutral-200 dark:border-neutral-800",
      )}
      data-testid={`product-tile-${product.id}`}
    >
      <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-amber-50 to-orange-100 text-5xl dark:from-amber-950/30 dark:to-orange-950/30">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt=""
            className="size-full object-cover"
          />
        ) : (
          <span>🍽️</span>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2.5 text-white">
        <div className="line-clamp-1 text-sm font-bold">
          {language === "ar" ? product.nameAr || product.name : product.name}
        </div>
        <div className="font-mono text-xs">
          {Number(product.price).toFixed(2)}
        </div>
      </div>
    </motion.button>
  );
}

function LiveCartRail({
  cart,
  subtotal,
  tax,
  total,
  vatEnabled,
  onBump,
  onClear,
  onPay,
  method,
  setMethod,
  locked,
  recovery,
  busy,
  ready,
  checkoutError,
}: {
  cart: CartItem[];
  subtotal: number;
  tax: number;
  total: number;
  vatEnabled: boolean;
  onBump: (id: number, delta: number) => void;
  onClear: () => void;
  onPay: () => void;
  method: "cash" | "card" | "stc" | "transfer";
  setMethod: (method: "cash" | "card" | "stc" | "transfer") => void;
  locked: boolean;
  recovery: boolean;
  busy: boolean;
  ready: boolean;
  checkoutError: string;
}) {
  const { t } = useLanguage();
  return (
    <aside
      data-testid="rail-pos-cart"
      className="flex min-h-96 flex-col gap-3 rounded-3xl border border-neutral-200/70 bg-white/80 p-3 backdrop-blur lg:min-h-0 dark:border-neutral-800/70 dark:bg-neutral-900/60"
    >
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-2 text-sm font-bold">
          <ShoppingCart className="size-4" />
          {t("pos_iconic.cart")} ({cart.length})
        </div>
        {cart.length > 0 && (
          <button
            onClick={onClear}
            disabled={locked}
            className="rounded-md p-1 text-xs text-neutral-400 hover:text-red-500"
            aria-label="clear"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        <>
          {cart.length === 0 ? (
            <div className="grid h-40 place-items-center text-xs text-neutral-400">
              {t("pos_iconic.cart_empty")}
            </div>
          ) : (
            cart.map((ci) => (
              <motion.div
                key={ci.product.id}
                layout
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-2 rounded-xl border border-neutral-100 bg-white px-2.5 py-2 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="grid size-8 place-items-center rounded-full bg-blue-50 text-base dark:bg-blue-950/40">
                  📦
                </div>
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-1 text-xs font-medium">
                    {ci.product.name}
                  </div>
                  <div className="font-mono text-[10px] text-neutral-500">
                    {Number(ci.product.price).toFixed(2)} × {ci.quantity}
                  </div>
                </div>
                <div className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-1 py-0.5 text-xs dark:bg-neutral-800">
                  <button
                    onClick={() => onBump(ci.product.id, -1)}
                    disabled={locked}
                    className="grid size-6 place-items-center rounded-full hover:bg-white dark:hover:bg-neutral-700"
                  >
                    <Minus className="size-3" />
                  </button>
                  <span className="min-w-5 text-center font-mono">
                    {ci.quantity}
                  </span>
                  <button
                    onClick={() => onBump(ci.product.id, 1)}
                    disabled={locked}
                    className="grid size-6 place-items-center rounded-full hover:bg-white dark:hover:bg-neutral-700"
                  >
                    <Plus className="size-3" />
                  </button>
                </div>
              </motion.div>
            ))
          )}
        </>
      </div>

      <div className="space-y-1 rounded-2xl bg-neutral-50 p-3 text-xs dark:bg-neutral-800/60">
        <Row label={t("pos_iconic.subtotal")} value={subtotal} />
        {vatEnabled && <Row label={t("pos_iconic.tax")} value={tax} />}
        <div className="my-1.5 border-t border-dashed border-neutral-200 dark:border-neutral-700" />
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold">{t("pos_iconic.total")}</span>
          <motion.span
            key={total.toFixed(2)}
            initial={{ scale: 1.2, color: "#10b981" }}
            animate={{ scale: 1, color: "inherit" }}
            className="font-mono text-base font-bold"
          >
            {total.toFixed(2)}
          </motion.span>
        </div>
      </div>

      <fieldset disabled={locked} className="grid grid-cols-2 gap-2" aria-label={t("pos_iconic.choose_payment")}>
        <legend className="mb-2 text-xs font-semibold">{t("pos_iconic.choose_payment")}</legend>
        {([
          ["cash", t("pos_iconic.cash")],
          ["card", t("pos_iconic.card")],
          ["stc", "STC Pay"],
          ["transfer", t("pos_iconic.transfer")],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={method === key}
            data-testid={`button-pay-${key}`} onClick={() => setMethod(key)}
            className={cn("min-h-11 rounded-xl border px-2 text-sm disabled:opacity-60",
              method === key ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "border-neutral-200 dark:border-neutral-700")}>
            {label}
          </button>
        ))}
      </fieldset>
      <p className="text-[11px] text-neutral-500">{t("pos_iconic.manual_tender_notice")}</p>
      {checkoutError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">{checkoutError}</p>}
      <button
        onClick={onPay}
        disabled={cart.length === 0 || busy || !ready}
        data-testid="button-pay-rail"
        className="grid h-14 w-full place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-base font-bold text-white shadow-lg shadow-emerald-500/30 transition disabled:from-neutral-300 disabled:to-neutral-300 disabled:shadow-none"
      >
        <span className="inline-flex items-center gap-2">
          <CreditCard className="size-5" />
          {busy ? t("pos_iconic.processing") : recovery ? t("pos_iconic.recover_sale") : t("pos_iconic.pay")} {cart.length > 0 && total.toFixed(2)}
        </span>
      </button>
    </aside>
  );
}
function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-neutral-500">{label}</span>
      <span className="font-mono">{value.toFixed(2)}</span>
    </div>
  );
}

function FloatingDock({
  parkedCount,
  cartCount,
  isParkingActive,
  onPark,
  onOpenParked,
  onOpenPay,
  payDisabled,
}: {
  parkedCount: number;
  cartCount: number;
  isParkingActive: boolean;
  onPark: () => void;
  onOpenParked: () => void;
  onOpenPay: () => void;
  payDisabled: boolean;
}) {
  const { t } = useLanguage();
  // Long-press on the Parking pill = park current cart. Tap = open list.
  const [pressTimer, setPressTimer] = useState<number | null>(null);
  const startPress = () => {
    const id = window.setTimeout(() => {
      onPark();
      setPressTimer(null);
    }, 400);
    setPressTimer(id);
  };
  const endPress = (didTrigger: boolean) => {
    if (pressTimer !== null) {
      window.clearTimeout(pressTimer);
      setPressTimer(null);
      if (!didTrigger) onOpenParked();
    }
  };
  return (
    <div
      data-testid="dock-pos"
      className="relative z-30 flex justify-center px-3 pb-5 pointer-events-none lg:fixed lg:inset-x-0 lg:bottom-5 lg:pb-0"
    >
      <motion.nav
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-white/40 bg-white/80 px-2 py-1.5 shadow-2xl shadow-black/20 backdrop-blur-xl dark:border-white/10 dark:bg-neutral-900/80"
      >
        <DockBtn
          label={t("pos_iconic.parking")}
          onPointerDown={startPress}
          onPointerUp={() => endPress(false)}
          onPointerLeave={() => endPress(true)}
          badge={parkedCount}
          highlight={isParkingActive}
          testId="dock-parking"
        >
          <Pause className="size-5" />
        </DockBtn>
        <DockBtn
          label={t("pos_iconic.cart")}
          onClick={() => {
            /* cart rail already visible; tap is a no-op marker */
          }}
          badge={cartCount}
          testId="dock-cart"
        >
          <ShoppingCart className="size-5" />
        </DockBtn>
        <DockBtn label={t("pos_iconic.customer")} testId="dock-customer">
          <User className="size-5" />
        </DockBtn>
        <DockBtn
          label={t("pos_iconic.pay")}
          onClick={onOpenPay}
          disabled={payDisabled}
          highlight={cartCount > 0}
          testId="dock-pay"
        >
          <CreditCard className="size-5" />
        </DockBtn>
        <DockBtn label={t("pos_iconic.more")} testId="dock-more">
          <MoreHorizontal className="size-5" />
        </DockBtn>
      </motion.nav>
    </div>
  );
}

function DockBtn({
  children,
  label,
  badge,
  highlight,
  testId,
  ...rest
}: {
  children: React.ReactNode;
  label: string;
  badge?: number;
  highlight?: boolean;
  testId?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      title={label}
      aria-label={label}
      data-testid={testId}
      {...rest}
      className={cn(
        "relative grid size-12 place-items-center rounded-full transition",
        highlight
          ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/40"
          : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800",
      )}
    >
      {children}
      {typeof badge === "number" && badge > 0 && (
        <span className="absolute -end-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
          {badge}
        </span>
      )}
    </button>
  );
}

function ParkedOverlay({
  parked,
  onClose,
  onResume,
  onCancel,
  parkLabel,
  setParkLabel,
  canPark,
  onParkNow,
}: {
  parked: ParkedOrder[];
  onClose: () => void;
  onResume: (id: number) => void;
  onCancel: (id: number) => void;
  parkLabel: string;
  setParkLabel: (s: string) => void;
  canPark: boolean;
  onParkNow: () => void;
}) {
  const { t } = useLanguage();
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-40 grid place-items-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
      data-testid="overlay-parked"
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-3xl bg-white p-5 shadow-2xl dark:bg-neutral-900"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="inline-flex items-center gap-2 text-lg font-bold">
            <Pause className="size-5 text-amber-500" />
            {t("pos_iconic.parked_title")}
          </h2>
          <button
            onClick={onClose}
            className="grid size-8 place-items-center rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <X className="size-4" />
          </button>
        </div>

        {canPark && (
          <div className="mb-4 flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/40 dark:bg-amber-950/20">
            <Input
              placeholder={t("pos_iconic.park_label_ph")}
              value={parkLabel}
              onChange={(e) => setParkLabel(e.target.value)}
              className="h-10"
              data-testid="input-park-label"
            />
            <Button
              onClick={onParkNow}
              data-testid="button-park-now"
              className="h-10 bg-amber-500 text-white hover:bg-amber-600"
            >
              <Pause className="me-1 size-4" />
              {t("pos_iconic.park_now")}
            </Button>
          </div>
        )}

        {parked.length === 0 ? (
          <div className="grid h-40 place-items-center rounded-2xl border border-dashed border-neutral-200 text-sm text-neutral-400 dark:border-neutral-800">
            {t("pos_iconic.no_parked")}
          </div>
        ) : (
          <div className="grid max-h-[60vh] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
            {parked.map((p) => (
              <div
                key={p.id}
                data-testid={`parked-${p.id}`}
                className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="grid size-10 place-items-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                  🎫
                </div>
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-1 text-sm font-bold">
                    {p.parkedLabel || t("pos_iconic.untitled")}
                  </div>
                  <div className="text-[11px] text-neutral-500">
                    {p.items.length} {t("pos_iconic.items")} •{" "}
                    {p.total.toFixed(2)}
                  </div>
                </div>
                <button
                  onClick={() => onResume(p.id)}
                  data-testid={`button-resume-${p.id}`}
                  className="grid size-9 place-items-center rounded-full bg-emerald-500 text-white shadow hover:bg-emerald-600"
                  aria-label="resume"
                >
                  <Play className="size-4" />
                </button>
                <button
                  onClick={() => onCancel(p.id)}
                  className="grid size-9 place-items-center rounded-full bg-neutral-100 text-neutral-500 hover:bg-red-50 hover:text-red-500 dark:bg-neutral-800"
                  aria-label="cancel"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
