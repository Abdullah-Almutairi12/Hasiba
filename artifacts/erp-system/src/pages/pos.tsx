import React, { useState, useMemo } from "react";
import { useLocation } from "wouter";
import {
  useListProducts,
  useListProductCategories,
  useCreatePosOrder,
  useCreatePosSession,
  useListPosSessions,
  useGetPosSummary,
  useGetZatcaStatus,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  ShoppingCart,
  Trash2,
  ArrowRight,
  User,
  PackageSearch,
  ScanLine,
  Crown,
  ShieldCheck,
  Gift,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";

export default function POS() {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  
  const { data: categories } = useListProductCategories();
  const { data: products, isLoading: isLoadingProducts } = useListProducts({ 
    search: search || undefined,
    category: categoryId?.toString() 
  });
  
  const { data: sessions } = useListPosSessions();
  const { data: zatca } = useGetZatcaStatus();
  const createSession = useCreatePosSession();
  const createOrder = useCreatePosOrder();
  
  const activeSession = sessions?.find(s => s.status === 'open');

  const [cart, setCart] = useState<Array<{ product: any, quantity: number }>>([]);
  const [discount, setDiscount] = useState(0);
  const [customer, setCustomer] = useState<{ name: string; loyaltyPoints: number; tier: string } | null>(null);

  const addToCart = (product: any) => {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        return prev.map(item => 
          item.product.id === product.id 
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const removeFromCart = (productId: number) => {
    setCart(prev => prev.filter(item => item.product.id !== productId));
  };

  const updateQuantity = (productId: number, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.product.id === productId) {
        const newQ = item.quantity + delta;
        return newQ > 0 ? { ...item, quantity: newQ } : item;
      }
      return item;
    }));
  };

  const subtotal = useMemo(() => cart.reduce((acc, item) => acc + (item.product.price * item.quantity), 0), [cart]);
  const loyaltyDiscount = customer ? Math.min(customer.loyaltyPoints * 0.05, subtotal * 0.1) : 0;
  // Combined discount sent to backend (manual + loyalty redemption) so UI total matches persisted total.
  const effectiveDiscount = discount + loyaltyDiscount;
  // Mirror server-side formula: tax = (subtotal - discount) * 0.15
  const tax = Math.max(0, (subtotal - effectiveDiscount)) * 0.15;
  const total = Math.max(0, subtotal - effectiveDiscount) + tax;
  const earnedPoints = Math.floor(total / 10);

  const handleCheckout = () => {
    if (!activeSession) {
      toast({ title: "لا يوجد جلسة بيع مفتوحة", variant: "destructive" });
      return;
    }
    
    if (cart.length === 0) return;

    createOrder.mutate({
      data: {
        sessionId: activeSession.id,
        paymentMethod: "card",
        items: cart.map(item => ({ productId: item.product.id, quantity: item.quantity })),
        discount: effectiveDiscount,
      }
    }, {
      onSuccess: () => {
        toast({ title: "تم إكمال الطلب بنجاح" });
        setCart([]);
        setDiscount(0);
        if (customer) {
          setCustomer({ ...customer, loyaltyPoints: customer.loyaltyPoints + earnedPoints });
        }
      }
    });
  };

  const handleStartSession = () => {
    createSession.mutate({
      data: {
        branchId: 1, // Default to branch 1
        cashierName: "الكاشير",
        openingCash: 0,
      }
    });
  };

  if (!activeSession && sessions !== undefined) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-md p-6 text-center shadow-lg border-border">
          <ShoppingCart className="mx-auto mb-4 size-16 text-muted-foreground" />
          <h2 className="mb-2 text-2xl font-bold">جلسة البيع مغلقة</h2>
          <p className="mb-6 text-muted-foreground">يجب فتح جلسة بيع جديدة للبدء في استقبال الطلبات.</p>
          <Button onClick={handleStartSession} size="lg" className="w-full" disabled={createSession.isPending}>
            {createSession.isPending ? "جاري الفتح..." : "فتح جلسة جديدة"}
          </Button>
          <Button variant="ghost" onClick={() => setLocation("/")} className="mt-2 w-full">العودة للوحة القيادة</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Left side - Products Grid */}
      <div className="flex flex-1 flex-col overflow-hidden bg-muted/20">
        <header className="flex h-16 shrink-0 items-center justify-between border-b px-4 bg-background">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/")} title="العودة">
              <ArrowRight className="size-5" />
            </Button>
            <h1 className="text-xl font-bold">نقطة البيع</h1>
          </div>
          <div className="flex items-center gap-2 w-1/2">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input 
                className="pl-4 pr-10" 
                placeholder="ابحث عن منتج أو امسح الباركود..." 
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <Button variant="outline" size="icon" title="مسح الباركود">
              <ScanLine className="size-5" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {zatca && (
              <Badge
                variant="outline"
                className={
                  zatca.connected
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "border-red-300 bg-red-50 text-red-700"
                }
              >
                <ShieldCheck className="ms-1 size-3" />
                ZATCA {zatca.connected ? "متصل" : "غير متصل"}
              </Badge>
            )}
            {activeSession && (
              <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700">
                <span className="me-1.5 size-2 animate-pulse rounded-full bg-emerald-500" />
                جلسة #{activeSession.id} مفتوحة
              </Badge>
            )}
          </div>
        </header>

        {/* Categories */}
        <div className="flex items-center gap-2 overflow-x-auto p-4 hide-scrollbar border-b bg-background">
          <Button 
            variant={categoryId === null ? "default" : "outline"} 
            className="shrink-0 rounded-full"
            onClick={() => setCategoryId(null)}
          >
            الكل
          </Button>
          {categories?.map(c => (
            <Button 
              key={c.id} 
              variant={categoryId === c.id ? "default" : "outline"} 
              className="shrink-0 rounded-full"
              onClick={() => setCategoryId(c.id)}
            >
              {c.nameAr || c.name}
            </Button>
          ))}
        </div>

        {/* Products */}
        <ScrollArea className="flex-1 p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {isLoadingProducts ? (
              Array.from({ length: 15 }).map((_, i) => (
                <Skeleton key={i} className="h-40 w-full rounded-xl" />
              ))
            ) : products?.map((product) => (
              <motion.div
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                key={product.id}
                className="cursor-pointer"
                onClick={() => addToCart(product)}
              >
                <Card className="h-full overflow-hidden border hover:border-primary transition-colors">
                  <div className="aspect-square bg-muted p-4 flex items-center justify-center">
                    {product.imageUrl ? (
                      <img src={product.imageUrl} alt={product.name} className="object-contain w-full h-full mix-blend-multiply" />
                    ) : (
                      <PackageSearch className="size-10 text-muted-foreground/30" />
                    )}
                  </div>
                  <CardContent className="p-3">
                    <div className="font-semibold text-sm line-clamp-2 min-h-10">{product.nameAr || product.name}</div>
                    <div className="text-primary font-bold mt-1">
                      {new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(product.price)}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Right side - Cart */}
      <div className="flex w-[400px] shrink-0 flex-col border-r bg-background">
        <div className="flex h-16 shrink-0 items-center justify-between border-b px-4 bg-muted/10">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <ShoppingCart className="size-5" />
            سلة الشراء
          </h2>
          {customer ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setCustomer(null)}
            >
              إزالة
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={() =>
                setCustomer({ name: "نوره الحربي", loyaltyPoints: 240, tier: "ذهبي" })
              }
            >
              <User className="size-4 ml-2" /> إضافة عميل
            </Button>
          )}
        </div>

        {/* Loyalty Customer Widget */}
        {customer && (
          <div className="border-b bg-gradient-to-l from-amber-50 to-yellow-50 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="grid size-10 place-items-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white">
                  <Crown className="size-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800">{customer.name}</p>
                  <Badge
                    variant="outline"
                    className="mt-0.5 border-amber-400 bg-amber-100 text-amber-800"
                  >
                    عضو {customer.tier}
                  </Badge>
                </div>
              </div>
              <div className="text-left">
                <p className="text-xs text-slate-600">رصيد النقاط</p>
                <p className="text-lg font-bold tabular-nums text-amber-700">
                  {customer.loyaltyPoints}
                </p>
              </div>
            </div>
            {cart.length > 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-white/60 p-2 text-xs">
                <Gift className="size-4 text-amber-600" />
                <span className="text-slate-700">
                  سيكسب{" "}
                  <span className="font-bold text-amber-700">{earnedPoints} نقطة</span> من
                  هذه العملية
                </span>
              </div>
            )}
          </div>
        )}

        <ScrollArea className="flex-1 p-4">
          {cart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-muted-foreground p-8 text-center">
              <ShoppingCart className="size-12 mb-4 opacity-20" />
              <p>السلة فارغة. قم بإضافة منتجات للبدء.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {cart.map((item) => (
                <div key={item.product.id} className="flex gap-3">
                  <div className="flex-1">
                    <div className="font-medium text-sm">{item.product.nameAr || item.product.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(item.product.price)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 border rounded-md px-2 h-8">
                    <button onClick={() => updateQuantity(item.product.id, -1)} className="text-muted-foreground hover:text-foreground">-</button>
                    <span className="w-4 text-center text-sm">{item.quantity}</span>
                    <button onClick={() => updateQuantity(item.product.id, 1)} className="text-muted-foreground hover:text-foreground">+</button>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeFromCart(item.product.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Totals */}
        <div className="shrink-0 border-t p-4 bg-muted/10 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">المجموع الفرعي</span>
            <span>{new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">ضريبة القيمة المضافة (15%)</span>
            <span>{new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(tax)}</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-sm text-green-600">
              <span>الخصم اليدوي</span>
              <span>-{new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(discount)}</span>
            </div>
          )}
          {loyaltyDiscount > 0 && (
            <div className="flex justify-between text-sm text-amber-600">
              <span className="flex items-center gap-1"><Gift className="size-3" /> خصم الولاء</span>
              <span>-{new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(loyaltyDiscount)}</span>
            </div>
          )}
          <div className="border-t pt-3 flex justify-between font-bold text-lg">
            <span>الإجمالي</span>
            <span>{new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(total)}</span>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button size="lg" variant="outline" className="w-full" disabled={cart.length === 0}>
              دفع شبكة
            </Button>
            <Button size="lg" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground" onClick={handleCheckout} disabled={cart.length === 0 || createOrder.isPending}>
              {createOrder.isPending ? "جاري الدفع..." : "دفع كاش"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
