import { useState, useMemo, useEffect, useRef } from "react";
import { Money } from "@/components/riyal";
import { useLocation } from "wouter";
import {
  useListProducts,
  useListProductCategories,
  useCreatePosOrder,
  useCreatePosSession,
  useListPosSessions,
  useGetZatcaStatus,
} from "@workspace/api-client-react";
import type { CreatePosOrderBody, PosOrder } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Search,
  ShoppingCart,
  Trash2,
  ArrowLeft,
  ArrowRight,
  User,
  PackageSearch,
  ScanLine,
  Crown,
  Gift,
  Calculator,
  Store,
  RefreshCw,
  Maximize2,
  Power,
  Plus,
  Minus,
  CreditCard,
  Banknote,
  Apple,
  Pause,
  RotateCcw,
  Check,
  X,
  Sparkles,
  ChevronLeft,
  ShieldCheck,
  Wallet,
  Truck,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApiQuery, apiPost } from "@/hooks/use-api";

interface PosShippingCarrier {
  id: number;
  provider: string;
  displayName: string;
  isEnabled: boolean;
}
interface PosCreatedShipment {
  shipmentId: number;
  awbNumber: string;
  labelUrl: string | null;
}

const fmtPrice = (v: number) =>
  new Intl.NumberFormat("ar-SA", {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);

export default function POS() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<
    "card" | "cash" | "stc" | "gift"
  >("card");
  const [clock, setClock] = useState<string>("");
  const [showSuccess, setShowSuccess] = useState<{
    invoiceNo: string;
    total: number;
    method: string;
    uuid: string;
    payments?: Array<{ method: string; amount: number; reference?: string | null; payerName?: string | null }>;
  } | null>(null);
  const [shipDialog, setShipDialog] = useState(false);
  const [shipResult, setShipResult] = useState<PosCreatedShipment | null>(null);
  const { data: shippingCarriers } = useApiQuery<PosShippingCarrier[]>(
    "/integrations/shipping-carriers",
  );

  type SplitMethod = "cash" | "card" | "transfer" | "stc" | "deferred";
  type SplitRow = { method: SplitMethod; amount: string; reference: string; payerName: string };
  type SplitPayment = { method: SplitMethod; amount: number; reference?: string | null; payerName?: string | null };
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitRows, setSplitRows] = useState<SplitRow[]>([]);

  // ===== Real payment-gateway plumbing =====
  // The cashier picks an enabled gateway (Moyasar, Mada, Tap, HyperPay,
  // STC Pay, PayTabs); we open a hosted checkout, poll the resulting
  // payment_intent until it captures, then finalise the POS order
  // with a back-reference to the intent so accounting reconciles.
  type Gateway = {
    id: number;
    provider: string;
    displayName: string;
    environment: string;
  };
  type Intent = {
    id: number;
    status: "pending" | "authorized" | "captured" | "paid" | "failed" | "refunded";
    providerRef: string | null;
    checkoutUrl: string | null;
    failureReason?: string | null;
  };
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [selectedGatewayId, setSelectedGatewayId] = useState<number | null>(null);
  const [gatewayStage, setGatewayStage] =
    useState<"idle" | "starting" | "awaiting" | "settling" | "failed">("idle");
  const [activeIntent, setActiveIntent] = useState<Intent | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    let aborted = false;
    fetch("/api/pos/payment-gateways", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Gateway[]) => {
        if (aborted) return;
        setGateways(rows ?? []);
        if (rows && rows[0]) setSelectedGatewayId((g) => g ?? rows[0].id);
      })
      .catch(() => {});
    return () => {
      aborted = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  const providerLabel = (p: string) =>
    ({
      moyasar: "Moyasar",
      mada: "مدى",
      tap: "Tap",
      hyperpay: "HyperPay",
      stcpay: "STC Pay",
      paytabs: "PayTabs",
    } as Record<string, string>)[p] ?? p;

  useEffect(() => {
    const t = setInterval(() => {
      setClock(
        new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        })
      );
    }, 1000);
    setClock(
      new Date().toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      })
    );
    return () => clearInterval(t);
  }, []);

  const { data: categories } = useListProductCategories();
  const { data: products, isLoading: isLoadingProducts } = useListProducts({
    search: search || undefined,
    category: categoryId?.toString(),
  });

  const { data: sessions } = useListPosSessions();
  const { data: zatca } = useGetZatcaStatus();
  const createSession = useCreatePosSession();
  const createOrder = useCreatePosOrder();

  const activeSession = sessions?.find((s) => s.status === "open");

  const [cart, setCart] = useState<
    Array<{ product: any; quantity: number }>
  >([]);
  const [discount, setDiscount] = useState(0);
  const [customer, setCustomer] = useState<{
    name: string;
    loyaltyPoints: number;
    tier: string;
  } | null>(null);

  const addToCart = (product: any) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const removeFromCart = (productId: number) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const updateQuantity = (productId: number, delta: number) => {
    setCart((prev) =>
      prev.flatMap((item) => {
        if (item.product.id === productId) {
          const newQ = item.quantity + delta;
          if (newQ <= 0) return [];
          return [{ ...item, quantity: newQ }];
        }
        return [item];
      })
    );
  };

  const subtotal = useMemo(
    () => cart.reduce((acc, item) => acc + item.product.price * item.quantity, 0),
    [cart]
  );
  const loyaltyDiscount = customer
    ? Math.min(customer.loyaltyPoints * 0.05, subtotal * 0.1)
    : 0;
  const effectiveDiscount = discount + loyaltyDiscount;
  const tax = Math.max(0, subtotal - effectiveDiscount) * 0.15;
  const total = Math.max(0, subtotal - effectiveDiscount) + tax;
  const earnedPoints = Math.floor(total / 10);

  const methodLabels: Record<string, string> = {
    card: "شبكة",
    cash: "كاش",
    stc: "STC Pay",
    transfer: "تحويل",
    gift: "بطاقة هدية",
  };

  const stopPolling = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const submitOrder = (
    payments: SplitPayment[] | null,
    successMethodLabel: string,
    paymentIntentId?: number | null,
  ) => {
    if (!activeSession) {
      toast({ title: "لا يوجد جلسة بيع مفتوحة", variant: "destructive" });
      return;
    }
    if (cart.length === 0) return;

    const data: CreatePosOrderBody = {
      sessionId: activeSession.id,
      items: cart.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
      })),
      discount: effectiveDiscount,
      ...(payments && payments.length > 0
        ? {
            payments: payments.map((p) => ({
              method: p.method,
              amount: p.amount,
              reference: p.reference || null,
              payerName: p.payerName || null,
            })),
          }
        : {
            // Preserve the actual cashier-selected method (so STC sales
            // don't mis-report as card). Gift cards have no first-class
            // server enum yet, so we collapse them to "card" — same
            // accounting treatment as before this change.
            paymentMethod: (paymentMethod === "gift"
              ? "card"
              : paymentMethod) as "cash" | "card" | "stc",
          }),
      ...(paymentIntentId ? { paymentIntentId } : {}),
    };

    createOrder.mutate(
      { data },
      {
        onSuccess: (resp) => {
          const order = resp as PosOrder & { invoiceNo?: string; uuid?: string };
          setShowSuccess({
            invoiceNo: order.invoiceNo ?? order.orderNumber ?? `INV-${Date.now()}`,
            total,
            method: successMethodLabel,
            uuid: order.uuid ?? crypto.randomUUID(),
            payments: order.payments ?? undefined,
          });
          if (customer) {
            setCustomer({
              ...customer,
              loyaltyPoints: customer.loyaltyPoints + earnedPoints,
            });
          }
          setCart([]);
          setDiscount(0);
          setSplitOpen(false);
          setSplitRows([]);
        },
        onError: (err) => {
          const e = err as {
            response?: { data?: { error?: string } };
            message?: string;
          };
          toast({
            title: "تعذر إتمام الدفع",
            description:
              e?.response?.data?.error ?? e?.message ?? "حدث خطأ غير متوقع",
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleCheckout = () => {
    if (cart.length === 0) return;
    // Cash, gift card, and STC-without-a-configured-gateway stay on the
    // legacy direct-tender path. For card/STC/transfer we route through
    // a real payment gateway when one is enabled.
    const usesGateway =
      (paymentMethod === "card" || paymentMethod === "stc") &&
      gateways.length > 0 &&
      selectedGatewayId !== null;
    if (usesGateway) {
      void startGatewayCheckout();
      return;
    }
    submitOrder(null, methodLabels[paymentMethod] || "بطاقة");
  };

  const startGatewayCheckout = async () => {
    if (!selectedGatewayId) {
      toast({ title: "اختر بوابة الدفع أولاً", variant: "destructive" });
      return;
    }
    if (cart.length === 0) return;
    setGatewayStage("starting");
    setActiveIntent(null);
    try {
      const cartRef = `POS-${Date.now()}`;
      const r = await fetch("/api/pos/payment/checkout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gatewayId: selectedGatewayId,
          amount: +total.toFixed(2),
          description: `بيع POS — ${cart.length} منتج`,
          callbackUrl: window.location.origin + "/pos",
          cartRef,
        }),
      });
      const body = (await r.json().catch(() => ({}))) as {
        intentId?: number;
        checkoutUrl?: string | null;
        providerRef?: string | null;
        status?: string;
        error?: string;
      };
      if (!r.ok || !body.intentId) {
        setGatewayStage("failed");
        toast({
          title: "تعذّر بدء عملية الدفع",
          description: body.error ?? `HTTP ${r.status}`,
          variant: "destructive",
        });
        return;
      }
      const intent: Intent = {
        id: body.intentId,
        status: (body.status as Intent["status"]) ?? "pending",
        providerRef: body.providerRef ?? null,
        checkoutUrl: body.checkoutUrl ?? null,
      };
      setActiveIntent(intent);
      setGatewayStage("awaiting");
      if (intent.checkoutUrl) {
        window.open(intent.checkoutUrl, "_blank", "noopener,noreferrer");
      }
      // Poll the intent every 2s for up to 5 minutes. Webhook flips
      // status to "captured" / "paid" when the customer completes the
      // hosted checkout; "failed" surfaces declines back to the till.
      const startedAt = Date.now();
      stopPolling();
      pollRef.current = window.setInterval(async () => {
        try {
          const pr = await fetch(`/api/pos/payment/intent/${intent.id}`, {
            credentials: "include",
          });
          if (!pr.ok) return;
          const pi = (await pr.json()) as Intent;
          setActiveIntent(pi);
          if (pi.status === "captured" || pi.status === "paid") {
            stopPolling();
            setGatewayStage("settling");
            const gw = gateways.find((g) => g.id === selectedGatewayId);
            const label = `${providerLabel(gw?.provider ?? "")}${
              pi.providerRef ? ` — ${pi.providerRef}` : ""
            }`;
            submitOrder(null, label, pi.id);
            // Reset gateway stage after the order mutation finishes
            // (handled in submitOrder's onSuccess via the success modal).
            setGatewayStage("idle");
          } else if (pi.status === "failed" || pi.status === "refunded") {
            stopPolling();
            setGatewayStage("failed");
            toast({
              title: "تم رفض عملية الدفع",
              description: pi.failureReason ?? "حاول مرة أخرى",
              variant: "destructive",
            });
          } else if (Date.now() - startedAt > 5 * 60_000) {
            stopPolling();
            setGatewayStage("failed");
            toast({
              title: "انتهت مهلة الانتظار",
              description: "لم نستلم تأكيد الدفع من البوابة",
              variant: "destructive",
            });
          }
        } catch {
          /* keep polling */
        }
      }, 2000);
    } catch (e) {
      setGatewayStage("failed");
      toast({
        title: "تعذّر الاتصال ببوابة الدفع",
        description: e instanceof Error ? e.message : "حاول مرة أخرى",
        variant: "destructive",
      });
    }
  };

  const cancelGatewayCheckout = () => {
    stopPolling();
    setGatewayStage("idle");
    setActiveIntent(null);
  };

  const openSplitDialog = () => {
    if (cart.length === 0) {
      toast({ title: "السلة فارغة", variant: "destructive" });
      return;
    }
    // Pre-seed two rows split 50/50 between cash and card.
    const half = +(total / 2).toFixed(2);
    setSplitRows([
      { method: "cash", amount: String(half), reference: "", payerName: "" },
      { method: "card", amount: String(+(total - half).toFixed(2)), reference: "", payerName: "" },
    ]);
    setSplitOpen(true);
  };

  const splitSum = splitRows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const splitRemaining = +(total - splitSum).toFixed(2);
  const splitValid =
    splitRows.length >= 2 &&
    Math.abs(splitRemaining) < 0.01 &&
    splitRows.every((r) => Number(r.amount) > 0);

  const confirmSplit = () => {
    if (!splitValid) return;
    submitOrder(
      splitRows.map((r) => ({
        method: r.method,
        amount: Number(r.amount),
        reference: r.reference || undefined,
        payerName: r.payerName || undefined,
      })),
      `مقسّم — ${splitRows.length} دفعات`,
    );
  };

  const handleStartSession = () => {
    createSession.mutate({
      data: {
        branchId: 1,
        cashierName: "الكاشير",
        openingCash: 0,
      },
    });
  };

  if (!activeSession && sessions !== undefined) {
    return (
      <div
        dir="rtl"
        className="flex h-screen items-center justify-center bg-neutral-50 font-sans"
      >
        <Card className="w-full max-w-md border-neutral-200 p-8 text-center shadow-xl">
          <div className="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-blue-50 text-[#2563EB]">
            <ShoppingCart className="size-8" />
          </div>
          <h2 className="mb-2 text-2xl font-extrabold text-neutral-900">
            جلسة البيع مغلقة
          </h2>
          <p className="mb-6 text-neutral-500">
            يجب فتح جلسة بيع جديدة للبدء في استقبال الطلبات.
          </p>
          <Button
            onClick={handleStartSession}
            size="lg"
            className="h-12 w-full bg-[#2563EB] font-bold text-white shadow-lg shadow-blue-500/30 hover:bg-[#1D4ED8]"
            disabled={createSession.isPending}
          >
            {createSession.isPending ? "جاري الفتح..." : "فتح جلسة جديدة"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setLocation("/")}
            className="mt-2 w-full"
          >
            العودة للوحة القيادة
          </Button>
        </Card>
      </div>
    );
  }

  const upsellItems = products?.slice(0, 3) || [];

  return (
    <div
      dir="rtl"
      className="flex h-screen overflow-hidden bg-neutral-50 font-sans text-neutral-900"
    >
      {/* Sidebar */}
      <aside className="z-40 flex h-full w-[260px] flex-shrink-0 flex-col border-l border-neutral-200 bg-white shadow-xl">
        <div className="flex h-16 items-center border-b border-neutral-100 px-5">
          <button
            onClick={() => setLocation("/")}
            className="flex w-full items-center gap-3 group"
          >
            <div className="grid size-9 place-items-center rounded-lg bg-[#2563EB] text-white shadow transition-transform group-hover:scale-105">
              <Calculator className="size-4" />
            </div>
            <div className="text-right leading-tight">
              <span className="block text-lg font-bold tracking-tight">
                حاسبة<span className="text-[#2563EB]">.</span>
              </span>
              <span className="text-[9px] font-medium uppercase tracking-wider text-neutral-500">
                POS Terminal
              </span>
            </div>
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-4">
          <div className="mb-2 px-4 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
            القائمة الرئيسية
          </div>

          {[
            { icon: "📊", label: "لوحة التحكم", path: "/" },
            { icon: "🧾", label: "نقطة البيع (POS)", path: "/pos", active: true },
            { icon: "📦", label: "المنتجات والمخزون", path: "/products" },
            { icon: "📑", label: "فواتير الموردين", path: "/invoices" },
            { icon: "👥", label: "العملاء", path: "/customers" },
          ].map((item) => (
            <button
              key={item.path}
              onClick={() => setLocation(item.path)}
              className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                item.active
                  ? "bg-blue-50 font-bold text-[#1D4ED8]"
                  : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
              }`}
            >
              {item.active && (
                <span className="absolute right-0 top-1/2 h-[70%] w-1 -translate-y-1/2 rounded-l-md bg-[#2563EB]" />
              )}
              <span className="w-5 text-center text-sm">{item.icon}</span>
              <span className="text-sm">{item.label}</span>
            </button>
          ))}

          <div className="mb-2 mt-6 px-4 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
            الإدارة والمالية
          </div>

          {[
            { icon: "⚖️", label: "المحاسبة والامتثال", path: "/accounting" },
            { icon: "📈", label: "التقارير والتحليلات", path: "/reports" },
            { icon: "⚙️", label: "الإعدادات والأمان", path: "/settings" },
          ].map((item) => (
            <button
              key={item.path}
              onClick={() => setLocation(item.path)}
              className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-neutral-900"
            >
              <span className="w-5 text-center text-sm">{item.icon}</span>
              <span className="text-sm">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="border-t border-neutral-100 bg-neutral-50/70 p-3">
          <button className="flex w-full items-center gap-3 rounded-lg border border-transparent p-2 transition-all hover:border-neutral-100 hover:bg-white hover:shadow-sm">
            <div className="relative">
              <div className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-xs font-bold text-white ring-2 ring-white">
                أم
              </div>
              <span className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-white bg-emerald-500" />
            </div>
            <div className="min-w-0 flex-1 text-right">
              <p className="truncate text-sm font-bold text-neutral-900">
                أحمد المدير
              </p>
              <p className="truncate text-[10px] text-neutral-500">
                وردية صباحية #{activeSession?.id ?? "—"}
              </p>
            </div>
            <ChevronLeft className="size-3 text-neutral-400" />
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="relative flex h-full flex-1 flex-col overflow-hidden bg-neutral-50">
        {/* Top utility bar */}
        <header className="z-20 flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-4 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-neutral-500">
              <Store className="size-4" />
              <span className="font-bold text-neutral-700">فرع الرياض جاليري</span>
              <span className="text-neutral-300">|</span>
              <span className="font-mono">{clock}</span>
            </div>
            <div
              className={`hidden items-center gap-2 rounded-full border px-3 py-1 md:flex ${
                zatca?.connected
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-red-200 bg-red-50"
              }`}
            >
              <span className="relative flex size-2">
                {zatca?.connected && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                )}
                <span
                  className={`relative inline-flex size-2 rounded-full ${
                    zatca?.connected ? "bg-emerald-500" : "bg-red-500"
                  }`}
                />
              </span>
              <span
                className={`text-[10px] font-bold ${
                  zatca?.connected ? "text-emerald-700" : "text-red-700"
                }`}
              >
                {zatca?.connected ? "متصل بالهيئة (ZATCA)" : "غير متصل بـ ZATCA"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-bold text-neutral-600 transition-colors hover:bg-neutral-200">
              <RefreshCw className="size-3" />
              <span>مزامنة (0)</span>
            </button>
            <button className="grid size-9 place-items-center rounded-lg border border-neutral-200 bg-white text-neutral-500 shadow-sm transition-all hover:border-blue-200 hover:text-[#2563EB]">
              <Maximize2 className="size-4" />
            </button>
            <button
              className="grid size-9 place-items-center rounded-lg border border-red-100 bg-red-50 text-red-500 shadow-sm transition-all hover:bg-red-100"
              title="إقفال الوردية"
            >
              <Power className="size-4" />
            </button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* LEFT: Product catalog */}
          <div className="flex min-w-0 flex-1 flex-col pl-1">
            <div className="flex flex-col gap-4 border-b border-neutral-200 bg-white p-4">
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <Search className="absolute right-4 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key !== "Enter") return;
                      const code = search.trim();
                      if (!code) return;
                      try {
                        const r = await fetch(
                          `/api/inventory/lookup?code=${encodeURIComponent(code)}`,
                          { credentials: "include" },
                        );
                        if (r.ok) {
                          const m = await r.json();
                          addToCart({
                            id: m.productId,
                            nameAr: m.nameAr ?? m.sku,
                            name: m.nameAr ?? m.sku,
                            sku: m.sku,
                            price: m.price ?? 0,
                          });
                          setSearch("");
                        } else {
                          toast({
                            title: "لم يُعثر على المنتج",
                            description: code,
                            variant: "destructive",
                          });
                        }
                      } catch {
                        toast({ title: "تعذر الاتصال", variant: "destructive" });
                      }
                    }}
                    placeholder="بحث باسم المنتج، الباركود، أو SKU..."
                    className="h-12 rounded-xl border-neutral-200 bg-neutral-50 pe-4 ps-12 text-sm shadow-inner focus-visible:border-[#2563EB] focus-visible:ring-2 focus-visible:ring-blue-500/20"
                    autoFocus
                  />
                  <div className="absolute left-2 top-1/2 -translate-y-1/2">
                    <span className="rounded border border-neutral-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-neutral-400">
                      F1
                    </span>
                  </div>
                </div>
                <button
                  className="grid size-12 place-items-center rounded-xl bg-neutral-900 text-white shadow-lg transition-transform active:scale-95 hover:bg-neutral-800"
                  title="مسح الباركود"
                >
                  <ScanLine className="size-5" />
                </button>
              </div>

              {/* Category pills */}
              <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
                <button
                  onClick={() => setCategoryId(null)}
                  className={`whitespace-nowrap rounded-full border px-5 py-2 text-xs font-bold transition-all ${
                    categoryId === null
                      ? "border-transparent bg-[#2563EB] text-white shadow-md shadow-blue-500/30"
                      : "border-neutral-200 bg-white text-neutral-600 hover:border-blue-300 hover:text-[#2563EB]"
                  }`}
                >
                  الكل
                </button>
                {categories?.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCategoryId(c.id)}
                    className={`whitespace-nowrap rounded-full border px-5 py-2 text-xs font-bold transition-all ${
                      categoryId === c.id
                        ? "border-transparent bg-[#2563EB] text-white shadow-md shadow-blue-500/30"
                        : "border-neutral-200 bg-white text-neutral-600 hover:border-blue-300 hover:text-[#2563EB]"
                    }`}
                  >
                    {c.nameAr || c.name}
                  </button>
                ))}
              </div>
            </div>

            <ScrollArea className="flex-1 bg-[#f8fafc] p-4">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                {isLoadingProducts
                  ? Array.from({ length: 12 }).map((_, i) => (
                      <Skeleton key={i} className="h-[180px] w-full rounded-2xl" />
                    ))
                  : products?.map((product: any) => {
                      const stock = product.stockQuantity ?? 0;
                      const outOfStock = stock <= 0 && product.stockQuantity != null;
                      return (
                        <motion.button
                          key={product.id}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => !outOfStock && addToCart(product)}
                          disabled={outOfStock}
                          className={`group relative flex h-[180px] flex-col overflow-hidden rounded-2xl border bg-white p-3 text-right shadow-sm transition-all hover:shadow-md ${
                            outOfStock
                              ? "cursor-not-allowed opacity-60"
                              : "cursor-pointer border-neutral-200"
                          }`}
                        >
                          {outOfStock && (
                            <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-100/60">
                              <span className="rounded-full bg-neutral-800 px-3 py-1 text-xs font-bold text-white">
                                نفذت الكمية
                              </span>
                            </div>
                          )}
                          {!outOfStock && stock > 0 && (
                            <div className="absolute left-2 top-2 z-10 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-[#1D4ED8]">
                              {stock} متوفر
                            </div>
                          )}
                          <div className="mb-2 flex h-24 w-full items-center justify-center rounded-xl bg-neutral-50 transition-colors group-hover:bg-blue-50/50">
                            {product.imageUrl ? (
                              <img
                                src={product.imageUrl}
                                alt={product.name}
                                className="h-20 w-auto object-contain mix-blend-multiply"
                              />
                            ) : (
                              <PackageSearch className="size-10 text-neutral-300" />
                            )}
                          </div>
                          <div className="mt-auto">
                            <h3 className="mb-1 truncate text-sm font-bold leading-tight text-neutral-800">
                              {product.nameAr || product.name}
                            </h3>
                            <div className="flex items-center justify-between">
                              <span className="text-base font-bold text-[#2563EB]">
                                <Money value={product.price} symbolClassName="opacity-60" />
                              </span>
                              {!outOfStock && (
                                <div className="grid size-6 place-items-center rounded-full bg-neutral-100 text-neutral-400 transition-colors group-hover:bg-[#2563EB] group-hover:text-white">
                                  <Plus className="size-3" />
                                </div>
                              )}
                            </div>
                          </div>
                        </motion.button>
                      );
                    })}
              </div>
            </ScrollArea>
          </div>

          {/* RIGHT: Cart & checkout */}
          <div className="z-30 flex w-[420px] flex-col border-r border-neutral-200 bg-white shadow-2xl">
            {/* Customer + Loyalty */}
            <div className="flex flex-col border-b border-neutral-100">
              <button
                onClick={() =>
                  customer
                    ? setCustomer(null)
                    : setCustomer({
                        name: "نوره الحربي",
                        loyaltyPoints: 1250,
                        tier: "ذهبي",
                      })
                }
                className="group flex items-center justify-between bg-neutral-50 p-4 transition-colors hover:bg-blue-50"
              >
                <div className="flex items-center gap-3">
                  <div className="grid size-10 place-items-center rounded-full bg-blue-100 font-bold text-[#2563EB]">
                    <User className="size-4" />
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-neutral-800 transition-colors group-hover:text-[#2563EB]">
                      {customer?.name || "عميل عام"}
                    </p>
                    <p className="text-[10px] text-neutral-500">
                      {customer ? "اضغط للإزالة" : "اضغط للاختيار أو الإضافة"}
                    </p>
                  </div>
                </div>
                <ChevronLeft className="size-3 text-neutral-400" />
              </button>

              {customer && (
                <div className="bg-neutral-50 px-4 pb-3">
                  <div className="relative overflow-hidden rounded-xl bg-gradient-to-l from-[#1E3A8A] to-[#1D4ED8] p-3 text-white shadow-md">
                    <div className="absolute -right-4 -top-4 opacity-10">
                      <Crown className="size-16" />
                    </div>
                    <div className="relative z-10 mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Crown className="size-4 text-amber-300" />
                        <span className="text-xs font-bold">
                          برنامج الولاء — الفئة {customer.tier}
                        </span>
                      </div>
                      <span className="rounded-full bg-white/20 px-2 py-0.5 font-mono text-xs font-bold">
                        {customer.loyaltyPoints} نقطة
                      </span>
                    </div>
                    <div className="mb-2 h-1.5 w-full rounded-full bg-white/20">
                      <div
                        className="h-1.5 rounded-full bg-amber-300"
                        style={{
                          width: `${Math.min(
                            100,
                            (customer.loyaltyPoints / 1500) * 100
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-blue-100">
                      <span className="inline-flex items-center gap-1">متاح: خصم <Money value={loyaltyDiscount || 50} fractionDigits={0} /></span>
                      {cart.length > 0 && (
                        <span className="rounded-md bg-white/20 px-2 py-0.5 font-bold">
                          سيكسب {earnedPoints} نقطة
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Cart items */}
            <ScrollArea className="flex-1">
              <div className="space-y-3 p-4">
                {cart.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center text-neutral-400">
                    <ShoppingCart className="mb-3 size-12 opacity-30" />
                    <p className="text-sm">السلة فارغة</p>
                    <p className="mt-1 text-xs">اضغط على المنتجات لإضافتها</p>
                  </div>
                ) : (
                  cart.map((item) => (
                    <motion.div
                      key={item.product.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-start gap-3"
                    >
                      <div className="grid size-12 shrink-0 place-items-center rounded-lg border border-neutral-100 bg-neutral-50">
                        {item.product.imageUrl ? (
                          <img
                            src={item.product.imageUrl}
                            alt={item.product.name}
                            className="h-8 w-auto object-contain mix-blend-multiply"
                          />
                        ) : (
                          <PackageSearch className="size-5 text-neutral-300" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="mb-1 flex items-start justify-between">
                          <h4 className="text-sm font-bold text-neutral-800">
                            {item.product.nameAr || item.product.name}
                          </h4>
                          <span className="text-sm font-bold text-neutral-900">
                            {fmtPrice(item.product.price * item.quantity)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1">
                            <button
                              onClick={() => updateQuantity(item.product.id, -1)}
                              className="grid size-5 place-items-center text-neutral-400 transition-colors hover:text-[#2563EB]"
                            >
                              <Minus className="size-2.5" />
                            </button>
                            <span className="w-4 text-center text-sm font-bold tabular-nums">
                              {item.quantity}
                            </span>
                            <button
                              onClick={() => updateQuantity(item.product.id, 1)}
                              className="grid size-5 place-items-center text-neutral-400 transition-colors hover:text-[#2563EB]"
                            >
                              <Plus className="size-2.5" />
                            </button>
                          </div>
                          <button
                            onClick={() => removeFromCart(item.product.id)}
                            className="text-neutral-400 transition-colors hover:text-red-500"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}

                {/* AI Upsell */}
                {cart.length > 0 && upsellItems.length > 0 && (
                  <div className="border-t border-dashed border-neutral-200 pt-4 mt-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Sparkles className="size-3.5 text-[#2563EB]" />
                      <h5 className="text-xs font-bold text-neutral-700">
                        اقتراحات ذكية (غالباً ما تُشترى معاً)
                      </h5>
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-2 hide-scrollbar">
                      {upsellItems.slice(0, 3).map((p: any) => (
                        <button
                          key={p.id}
                          onClick={() => addToCart(p)}
                          className="group flex min-w-[120px] flex-col gap-2 rounded-xl border border-blue-100 bg-white p-2 transition-colors hover:border-blue-300"
                        >
                          <div className="flex items-center gap-2">
                            <div className="grid size-8 shrink-0 place-items-center rounded bg-neutral-50">
                              {p.imageUrl ? (
                                <img
                                  src={p.imageUrl}
                                  alt={p.name}
                                  className="size-7 object-cover rounded"
                                />
                              ) : (
                                <PackageSearch className="size-3 text-neutral-300" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1 text-right">
                              <p className="truncate text-[10px] font-bold text-neutral-800">
                                {p.nameAr || p.name}
                              </p>
                              <p className="font-mono text-[10px] text-[#2563EB]">
                                +{fmtPrice(p.price)}
                              </p>
                            </div>
                          </div>
                          <span className="rounded-md bg-blue-50 py-1 text-center text-[10px] font-bold text-[#1D4ED8] transition-colors group-hover:bg-[#2563EB] group-hover:text-white">
                            إضافة للسلة
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Totals */}
            <div className="space-y-2 border-t border-neutral-200 bg-neutral-50 p-4">
              <div className="flex justify-between text-xs text-neutral-500">
                <span>المجموع الفرعي</span>
                <span className="font-mono">{fmtPrice(subtotal)}</span>
              </div>
              <div className="flex justify-between text-xs text-neutral-500">
                <span>الضريبة (15%)</span>
                <span className="font-mono">{fmtPrice(tax)}</span>
              </div>
              <div className="flex justify-between text-xs font-bold text-emerald-600">
                <span>الخصم</span>
                <span className="font-mono">-{fmtPrice(effectiveDiscount)}</span>
              </div>
              {loyaltyDiscount > 0 && (
                <div className="flex justify-between text-[11px] text-amber-600">
                  <span className="flex items-center gap-1">
                    <Gift className="size-3" /> خصم الولاء
                  </span>
                  <span className="font-mono">-{fmtPrice(loyaltyDiscount)}</span>
                </div>
              )}
              <div className="my-2 border-t border-dashed border-neutral-300" />
              <div className="flex items-end justify-between">
                <span className="text-sm font-bold text-neutral-800">
                  الإجمالي (شامل الضريبة)
                </span>
                <span className="font-mono text-2xl font-bold text-[#2563EB]">
                  <Money value={total} symbolClassName="size-[0.6em] text-neutral-500" />
                </span>
              </div>
            </div>

            {/* Payment methods */}
            <div className="grid grid-cols-4 gap-2 border-t border-neutral-200 bg-white p-4">
              {[
                { key: "cash", icon: Banknote, label: "كاش" },
                { key: "card", icon: CreditCard, label: "شبكة", default: true },
                { key: "stc", icon: Wallet, label: "STC Pay" },
                { key: "gift", icon: Gift, label: "بطاقة هدية" },
              ].map((m) => {
                const Icon = m.icon;
                const selected = paymentMethod === m.key;
                return (
                  <button
                    key={m.key}
                    onClick={() => setPaymentMethod(m.key as typeof paymentMethod)}
                    className={`relative flex flex-col items-center justify-center rounded-xl border p-2 transition-all ${
                      selected
                        ? "border-2 border-[#2563EB] bg-blue-50 text-[#1D4ED8]"
                        : "border-neutral-200 text-neutral-600 hover:border-[#2563EB] hover:bg-blue-50 hover:text-[#1D4ED8]"
                    }`}
                  >
                    {m.default && !selected && (
                      <span className="absolute -right-2 -top-2 rounded-full bg-[#2563EB] px-1.5 py-0.5 text-[8px] text-white">
                        افتراضي
                      </span>
                    )}
                    <Icon
                      className={`mb-1 size-4 ${
                        m.key === "gift" ? "text-purple-500" : ""
                      }`}
                    />
                    <span className="text-[10px] font-bold">{m.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Gateway selector — only shown when at least one gateway is
                configured AND the cashier picked card / STC Pay. */}
            {gateways.length > 0 &&
              (paymentMethod === "card" || paymentMethod === "stc") && (
                <div className="border-t border-neutral-200 bg-blue-50/30 px-4 py-3">
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                    بوابة الدفع
                  </label>
                  <select
                    value={selectedGatewayId ?? ""}
                    onChange={(e) =>
                      setSelectedGatewayId(Number(e.target.value) || null)
                    }
                    disabled={
                      gatewayStage === "starting" ||
                      gatewayStage === "awaiting" ||
                      gatewayStage === "settling"
                    }
                    className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-800"
                  >
                    {gateways.map((g) => (
                      <option key={g.id} value={g.id}>
                        {providerLabel(g.provider)} — {g.displayName}
                        {g.environment === "sandbox" ? " (تجريبي)" : ""}
                      </option>
                    ))}
                  </select>
                  {gatewayStage === "awaiting" && activeIntent && (
                    <div className="mt-2 flex items-center justify-between rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                      <span>
                        بانتظار تأكيد الدفع من البوابة
                        {activeIntent.providerRef
                          ? ` — ${activeIntent.providerRef}`
                          : ""}
                      </span>
                      <button
                        type="button"
                        onClick={cancelGatewayCheckout}
                        className="text-amber-900 underline"
                      >
                        إلغاء
                      </button>
                    </div>
                  )}
                  {gatewayStage === "settling" && (
                    <div className="mt-2 rounded-md bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-800">
                      تم استلام الدفع — جارٍ إصدار الفاتورة...
                    </div>
                  )}
                  {gatewayStage === "failed" && (
                    <div className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-[11px] text-red-800">
                      فشل الدفع. اختر بوابة وحاول مجدّداً.
                    </div>
                  )}
                </div>
              )}

            {/* Action buttons */}
            <div className="flex flex-col gap-3 border-t border-neutral-200 bg-white p-4">
              <Button
                onClick={handleCheckout}
                disabled={
                  cart.length === 0 ||
                  createOrder.isPending ||
                  gatewayStage === "starting" ||
                  gatewayStage === "awaiting" ||
                  gatewayStage === "settling"
                }
                className="h-14 w-full gap-2 rounded-xl bg-[#2563EB] text-lg font-bold text-white shadow-lg shadow-blue-500/30 transition-all active:scale-95 hover:bg-[#1D4ED8] disabled:bg-neutral-300 disabled:shadow-none"
              >
                <span>
                  {createOrder.isPending
                    ? "جاري الدفع..."
                    : `دفع ${fmtPrice(total)}`}
                </span>
                {!createOrder.isPending && <ArrowLeft className="size-4" />}
              </Button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={openSplitDialog}
                  disabled={cart.length === 0 || createOrder.isPending}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white py-2.5 text-sm font-bold text-[#1D4ED8] transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ArrowRight className="size-3.5" />
                  <span>تقسيم الفاتورة</span>
                </button>
                <button
                  className="grid w-12 place-items-center rounded-xl border border-orange-100 bg-orange-50 text-orange-600 transition-colors hover:bg-orange-100"
                  title="مرتجع سريع"
                >
                  <RotateCcw className="size-4" />
                </button>
                <button
                  className="grid w-12 place-items-center rounded-xl bg-neutral-100 text-neutral-600 transition-colors hover:bg-neutral-200"
                  title="تعليق الطلب"
                >
                  <Pause className="size-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Split-Bill Dialog */}
        <Dialog open={splitOpen} onOpenChange={setSplitOpen}>
          <DialogContent dir="rtl" className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-right">تقسيم الفاتورة على عدة طرق دفع</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="rounded-lg bg-neutral-50 p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-neutral-500">إجمالي الفاتورة</span>
                  <span className="font-mono font-bold">{fmtPrice(total)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">المجموع المُدخل</span>
                  <span className="font-mono">{fmtPrice(splitSum)}</span>
                </div>
                <div className="mt-1 flex justify-between border-t border-dashed border-neutral-300 pt-1">
                  <span className="font-semibold">المتبقي</span>
                  <span
                    className={`font-mono font-bold ${
                      Math.abs(splitRemaining) < 0.01
                        ? "text-emerald-600"
                        : splitRemaining > 0
                        ? "text-orange-600"
                        : "text-red-600"
                    }`}
                  >
                    {fmtPrice(splitRemaining)}
                  </span>
                </div>
              </div>

              <div className="space-y-2 max-h-72 overflow-y-auto">
                {splitRows.map((row, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 rounded-lg border border-neutral-200 p-2"
                  >
                    <div className="flex flex-1 flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <select
                          value={row.method}
                          onChange={(e) => {
                            const v = e.target.value as SplitMethod;
                            setSplitRows((rows) =>
                              rows.map((r, i) => (i === idx ? { ...r, method: v } : r))
                            );
                          }}
                          className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm"
                        >
                          <option value="cash">كاش</option>
                          <option value="card">شبكة</option>
                          <option value="transfer">تحويل</option>
                          <option value="stc">STC Pay</option>
                          <option value="deferred">آجل</option>
                        </select>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={row.amount}
                          onChange={(e) =>
                            setSplitRows((rows) =>
                              rows.map((r, i) =>
                                i === idx ? { ...r, amount: e.target.value } : r
                              )
                            )
                          }
                          placeholder="المبلغ"
                          className="flex-1 text-right"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setSplitRows((rows) => rows.filter((_, i) => i !== idx))
                          }
                          disabled={splitRows.length <= 2}
                          className="grid size-8 place-items-center rounded-md text-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30"
                          title="حذف الدفعة"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="text"
                          value={row.reference}
                          onChange={(e) =>
                            setSplitRows((rows) =>
                              rows.map((r, i) =>
                                i === idx ? { ...r, reference: e.target.value } : r
                              )
                            )
                          }
                          placeholder="مرجع (اختياري)"
                          className="flex-1 text-right text-xs"
                        />
                        <Input
                          type="text"
                          value={row.payerName}
                          onChange={(e) =>
                            setSplitRows((rows) =>
                              rows.map((r, i) =>
                                i === idx ? { ...r, payerName: e.target.value } : r
                              )
                            )
                          }
                          placeholder={row.method === "deferred" ? "اسم العميل (آجل)" : "اسم الدافع (اختياري)"}
                          className="flex-1 text-right text-xs"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 gap-2"
                  onClick={() =>
                    setSplitRows((rows) => [
                      ...rows,
                      { method: "cash", amount: String(splitRemaining > 0 ? splitRemaining : 0), reference: "", payerName: "" },
                    ])
                  }
                >
                  <Plus className="size-4" />
                  <span>إضافة دفعة</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={() => {
                    if (splitRows.length === 0) return;
                    const remaining = total - splitRows.slice(0, -1).reduce((a, r) => a + (Number(r.amount) || 0), 0);
                    setSplitRows((rows) =>
                      rows.map((r, i) =>
                        i === rows.length - 1 ? { ...r, amount: String(+remaining.toFixed(2)) } : r
                      )
                    );
                  }}
                >
                  توزيع المتبقي
                </Button>
              </div>
            </div>
            <DialogFooter className="gap-2 sm:justify-start">
              <Button
                type="button"
                onClick={confirmSplit}
                disabled={!splitValid || createOrder.isPending}
                className="flex-1 bg-[#2563EB] hover:bg-[#1D4ED8]"
              >
                {createOrder.isPending ? "جاري الدفع..." : `تأكيد الدفع المقسّم (${fmtPrice(total)})`}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSplitOpen(false)}
                disabled={createOrder.isPending}
              >
                إلغاء
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Success Modal */}
        <AnimatePresence>
          {showSuccess && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm"
              onClick={() => setShowSuccess(null)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="pos-print-receipt relative w-[420px] overflow-hidden rounded-3xl bg-white shadow-2xl"
              >
                <button
                  onClick={() => setShowSuccess(null)}
                  className="absolute left-4 top-4 z-20 grid size-8 place-items-center rounded-full bg-white/20 text-white backdrop-blur transition-colors hover:bg-white/30"
                >
                  <X className="size-4" />
                </button>

                <div className="relative flex flex-col items-center bg-emerald-500 p-8 text-white">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.1, type: "spring" }}
                    className="mb-4 grid size-20 place-items-center rounded-full bg-white shadow-lg"
                  >
                    <Check className="size-10 text-emerald-500" />
                  </motion.div>
                  <h2 className="mb-1 text-2xl font-extrabold">تم الدفع بنجاح!</h2>
                  <p className="text-sm text-emerald-100">
                    عملية رقم #{showSuccess.invoiceNo}
                  </p>
                </div>

                <div className="bg-neutral-50 p-6">
                  <div className="mb-6 space-y-3">
                    <div className="flex items-center justify-between border-b border-dashed border-neutral-300 pb-3 text-sm">
                      <span className="text-neutral-500">المبلغ المدفوع</span>
                      <span className="text-lg font-bold text-neutral-900">
                        <Money value={showSuccess.total} />
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-neutral-500">طريقة الدفع</span>
                      <span className="flex items-center gap-2 font-bold text-neutral-900">
                        <CreditCard className="size-3.5" />
                        {showSuccess.method}
                      </span>
                    </div>
                    {showSuccess.payments && showSuccess.payments.length > 1 && (
                      <div className="rounded-md bg-white p-2 text-xs">
                        <div className="mb-1 font-semibold text-neutral-600">تفاصيل الدفعات</div>
                        <ul className="space-y-1">
                          {showSuccess.payments.map((p, i) => (
                            <li key={i} className="flex items-center justify-between">
                              <span className="text-neutral-500">
                                {methodLabels[p.method] ?? (p.method === "deferred" ? "آجل" : p.method)}
                                {p.payerName ? ` — ${p.payerName}` : ""}
                                {p.reference ? ` (${p.reference})` : ""}
                              </span>
                              <span className="font-mono font-bold text-neutral-900">
                                <Money value={p.amount} />
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-neutral-500">حالة ZATCA</span>
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
                        تم التشفير والختم
                      </span>
                    </div>
                  </div>

                  <div className="mb-6 flex items-center gap-4 rounded-xl border border-neutral-200 bg-white p-3">
                    <div className="grid size-16 place-items-center rounded-lg bg-neutral-900 text-xs text-white">
                      <ShieldCheck className="size-8" />
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <p className="mb-1 text-[10px] uppercase text-neutral-400">
                        UUID
                      </p>
                      <p className="truncate font-mono text-[10px] text-neutral-600">
                        {showSuccess.uuid}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      onClick={() => window.print()}
                      className="h-11 bg-[#2563EB] text-sm font-bold text-white hover:bg-[#1D4ED8] print:hidden"
                    >
                      طباعة فاتورة
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setShowSuccess(null)}
                      className="h-11 border-neutral-200 bg-white text-sm font-bold text-neutral-700 hover:bg-neutral-50"
                    >
                      إرسال رقمي
                    </Button>
                  </div>
                  {shipResult ? (
                    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 print:hidden">
                      <div className="font-bold mb-1 flex items-center gap-2">
                        <Truck className="size-3.5" />
                        تم إنشاء بوليصة الشحن
                      </div>
                      <div className="font-mono">AWB: {shipResult.awbNumber}</div>
                      {shipResult.labelUrl && (
                        <a
                          href={shipResult.labelUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-700 underline"
                        >
                          فتح/طباعة البوليصة
                        </a>
                      )}
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => setShipDialog(true)}
                      className="mt-3 w-full h-11 border-neutral-200 bg-white text-sm font-bold text-neutral-700 hover:bg-neutral-50 print:hidden gap-2"
                    >
                      <Truck className="size-4" />
                      إنشاء بوليصة شحن
                    </Button>
                  )}
                  <button
                    onClick={() => {
                      setShipResult(null);
                      setShowSuccess(null);
                    }}
                    className="mt-3 w-full text-sm font-medium text-[#2563EB] hover:underline print:hidden"
                  >
                    بيع جديد
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {shipDialog && showSuccess && (
          <PosCreateAwbDialog
            invoiceNo={showSuccess.invoiceNo}
            carriers={(shippingCarriers ?? []).filter((c) => c.isEnabled)}
            onClose={() => setShipDialog(false)}
            onSuccess={(out) => {
              setShipResult(out);
              setShipDialog(false);
            }}
          />
        )}
      </main>
    </div>
  );
}

function PosCreateAwbDialog({
  invoiceNo,
  carriers,
  onClose,
  onSuccess,
}: {
  invoiceNo: string;
  carriers: PosShippingCarrier[];
  onClose: () => void;
  onSuccess: (out: PosCreatedShipment) => void;
}) {
  const { toast } = useToast();
  const [carrierId, setCarrierId] = useState<string>(
    carriers[0]?.id ? String(carriers[0].id) : "",
  );
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [line1, setLine1] = useState("");
  const [city, setCity] = useState("");
  const [weightKg, setWeightKg] = useState("1");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!carrierId) {
      toast({ title: "اختر شركة الشحن", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const out = await apiPost<PosCreatedShipment>("/integrations/shipments", {
        carrierId: Number(carrierId),
        deliveryOrderRef: invoiceNo,
        toAddress: { name, phone, line1, city, country: "SA" },
        weightKg: Number(weightKg) || 1,
      });
      toast({
        title: "تم إنشاء بوليصة الشحن",
        description: `AWB: ${out.awbNumber}`,
      });
      onSuccess(out);
    } catch (e) {
      toast({
        title: "تعذّر إنشاء البوليصة",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إنشاء بوليصة شحن — {invoiceNo}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>شركة الشحن</Label>
            <Select value={carrierId} onValueChange={setCarrierId}>
              <SelectTrigger><SelectValue placeholder="اختر شركة الشحن" /></SelectTrigger>
              <SelectContent>
                {carriers.length === 0 && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    لا توجد شركات شحن مفعّلة. أضِفها من الإعدادات.
                  </div>
                )}
                {carriers.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.displayName} ({c.provider})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>اسم المستلم</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>الجوال</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>العنوان</Label>
            <Input value={line1} onChange={(e) => setLine1(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>المدينة</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div>
              <Label>الوزن (كجم)</Label>
              <Input
                type="number"
                step="0.1"
                value={weightKg}
                onChange={(e) => setWeightKg(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button
            onClick={submit}
            disabled={busy || !carrierId || !name || !phone || !line1 || !city}
          >
            {busy ? "جاري الإنشاء…" : "إنشاء البوليصة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
