import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  ShoppingBag,
  Upload,
  Download,
  RefreshCw,
  Trash2,
  Plus,
  History,
  Boxes,
  Pause,
  Play,
} from "lucide-react";

const BASE = "/api";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
  }
  return (await r.json()) as T;
}

type Platform = "salla" | "zid" | "shopify";

interface Connector {
  id: number;
  platform: Platform;
  displayName: string;
  branchId: number | null;
  storeUrl: string | null;
  environment: string;
  isEnabled: boolean;
  defaultWarehouseId: number | null;
  webhookSecret: string | null;
  lastSyncAt: string | null;
  createdAt: string;
}

interface SyncLog {
  id: number;
  operation: string;
  direction: string;
  success: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  errorMessage: string | null;
  externalRef: string | null;
  createdAt: string;
}

interface Warehouse {
  id: number;
  name: string;
}

const PLATFORM_META: Record<
  Platform,
  { label: string; color: string; description: string }
> = {
  salla: {
    label: "سلة",
    color: "bg-fuchsia-500/15 text-fuchsia-600",
    description: "متجر سعودي شائع — رفع المنتجات وسحب الطلبات.",
  },
  zid: {
    label: "زد",
    color: "bg-violet-500/15 text-violet-600",
    description: "منصة سعودية للتجارة الإلكترونية.",
  },
  shopify: {
    label: "Shopify",
    color: "bg-emerald-500/15 text-emerald-600",
    description: "منصة عالمية مع واجهة Admin API.",
  },
};

export default function MarketplacesTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [openConnector, setOpenConnector] = useState<Connector | null>(null);
  const [openCreate, setOpenCreate] = useState(false);

  const { data: connectors = [], isLoading } = useQuery<Connector[]>({
    queryKey: ["marketplaces"],
    queryFn: () => api<Connector[]>("/integrations/marketplaces"),
  });

  const { data: warehouses = [] } = useQuery<Warehouse[]>({
    queryKey: ["warehouses"],
    queryFn: () => api<Warehouse[]>("/warehouses"),
  });

  const toggleEnabled = useMutation({
    mutationFn: (c: Connector) =>
      api<Connector>(`/integrations/marketplaces/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isEnabled: !c.isEnabled }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketplaces"] });
      toast({ description: "تم تحديث الحالة" });
    },
    onError: (e: Error) => toast({ description: e.message, variant: "destructive" }),
  });

  const removeConnector = useMutation({
    mutationFn: (id: number) =>
      api(`/integrations/marketplaces/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketplaces"] });
      toast({ description: "تم حذف الموصل" });
    },
    onError: (e: Error) => toast({ description: e.message, variant: "destructive" }),
  });

  const pushCatalogue = useMutation({
    mutationFn: (id: number) =>
      api<{ pushed: number; failed: number }>(
        `/integrations/marketplaces/${id}/push-catalogue`,
        { method: "POST", body: JSON.stringify({}) },
      ),
    onSuccess: (r) =>
      toast({
        description: `تم رفع ${r.pushed} منتج، ${r.failed} فشل`,
      }),
    onError: (e: Error) => toast({ description: e.message, variant: "destructive" }),
  });

  const pushInventory = useMutation({
    mutationFn: (id: number) =>
      api<{ scheduled: number }>(
        `/integrations/marketplaces/${id}/push-inventory`,
        { method: "POST", body: JSON.stringify({}) },
      ),
    onSuccess: (r) => toast({ description: `جاري تحديث ${r.scheduled} مخزون` }),
    onError: (e: Error) => toast({ description: e.message, variant: "destructive" }),
  });

  const syncOrders = useMutation({
    mutationFn: (id: number) =>
      api<{ count: number; imported: number; failed: number }>(
        `/integrations/marketplaces/${id}/sync-orders`,
        { method: "POST", body: JSON.stringify({}) },
      ),
    onSuccess: (r) =>
      toast({
        description: `الطلبات: ${r.imported} مستوردة / ${r.failed} فشل من إجمالي ${r.count}`,
      }),
    onError: (e: Error) => toast({ description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold">المتاجر الإلكترونية</h2>
          <p className="text-sm text-muted-foreground">
            ربط المتاجر (سلة، زد، Shopify) — رفع المنتجات، سحب الطلبات، ومزامنة المخزون.
          </p>
        </div>
        <Dialog open={openCreate} onOpenChange={setOpenCreate}>
          <DialogTrigger asChild>
            <Button data-testid="btn-add-marketplace">
              <Plus className="me-2 size-4" /> ربط متجر جديد
            </Button>
          </DialogTrigger>
          <CreateConnectorDialog
            warehouses={warehouses}
            onDone={() => {
              setOpenCreate(false);
              qc.invalidateQueries({ queryKey: ["marketplaces"] });
            }}
          />
        </Dialog>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            جاري التحميل...
          </CardContent>
        </Card>
      ) : connectors.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 p-8 text-center">
            <ShoppingBag className="mx-auto size-10 text-muted-foreground" />
            <p className="text-muted-foreground">
              لا توجد متاجر مربوطة بعد. ابدأ بربط متجر سلة أو زد أو Shopify.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {connectors.map((c) => {
            const meta = PLATFORM_META[c.platform];
            return (
              <Card key={c.id} data-testid={`marketplace-card-${c.id}`}>
                <CardHeader className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <span className={`rounded px-2 py-0.5 text-xs ${meta.color}`}>
                        {meta.label}
                      </span>
                      {c.displayName}
                    </CardTitle>
                    <Switch
                      checked={c.isEnabled}
                      onCheckedChange={() => toggleEnabled.mutate(c)}
                      data-testid={`switch-enabled-${c.id}`}
                    />
                  </div>
                  <CardDescription className="text-xs">
                    {meta.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{c.environment}</Badge>
                    {c.storeUrl && (
                      <span className="truncate" dir="ltr">
                        {c.storeUrl}
                      </span>
                    )}
                  </div>
                  {c.lastSyncAt && (
                    <p className="text-xs text-muted-foreground">
                      آخر مزامنة: {new Date(c.lastSyncAt).toLocaleString("ar-SA")}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!c.isEnabled || pushCatalogue.isPending}
                      onClick={() => pushCatalogue.mutate(c.id)}
                      data-testid={`btn-push-catalogue-${c.id}`}
                    >
                      <Upload className="me-2 size-3.5" /> رفع المنتجات
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!c.isEnabled || syncOrders.isPending}
                      onClick={() => syncOrders.mutate(c.id)}
                      data-testid={`btn-sync-orders-${c.id}`}
                    >
                      <Download className="me-2 size-3.5" /> سحب الطلبات
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!c.isEnabled || pushInventory.isPending}
                      onClick={() => pushInventory.mutate(c.id)}
                      data-testid={`btn-push-inventory-${c.id}`}
                    >
                      <Boxes className="me-2 size-3.5" /> مزامنة المخزون
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setOpenConnector(c)}
                      data-testid={`btn-logs-${c.id}`}
                    >
                      <History className="me-2 size-3.5" /> السجلات
                    </Button>
                  </div>
                  <div className="flex justify-between gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggleEnabled.mutate(c)}
                    >
                      {c.isEnabled ? (
                        <>
                          <Pause className="me-2 size-3.5" /> إيقاف
                        </>
                      ) : (
                        <>
                          <Play className="me-2 size-3.5" /> تفعيل
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm("حذف هذا الموصل؟")) removeConnector.mutate(c.id);
                      }}
                    >
                      <Trash2 className="me-2 size-3.5 text-destructive" />
                      <span className="text-destructive">حذف</span>
                    </Button>
                  </div>
                  <div className="rounded border border-dashed bg-muted/30 p-2 text-[11px]">
                    <p className="font-medium">رابط Webhook</p>
                    <code dir="ltr" className="break-all text-muted-foreground">
                      {window.location.origin}/api/integrations/marketplaces/webhook/
                      {c.id}
                    </code>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!openConnector} onOpenChange={() => setOpenConnector(null)}>
        {openConnector && <LogsDialog connectorId={openConnector.id} />}
      </Dialog>

      {connectors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ربط المنتجات</CardTitle>
            <CardDescription>
              يتم إنشاء الربط تلقائياً عند رفع المنتجات. تعرض هذه القائمة منتجاتك الداخلية المرتبطة بمعرّفات خارجية في كل متجر.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {connectors.map((c) => (
              <MappingsBlock key={c.id} connector={c} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface Mapping {
  id: number;
  connectorId: number;
  productId: number;
  externalProductId: string;
  externalVariantId: string | null;
  lastPushedAt: string | null;
  lastInventoryPushedAt: string | null;
}

function MappingsBlock({ connector }: { connector: Connector }) {
  const { data: mappings = [] } = useQuery<Mapping[]>({
    queryKey: ["marketplace-mappings", connector.id],
    queryFn: () =>
      api<Mapping[]>(`/integrations/marketplaces/${connector.id}/mappings`),
  });
  const meta = PLATFORM_META[connector.platform];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-xs ${meta.color}`}>
          {meta.label}
        </span>
        <span className="text-sm font-medium">{connector.displayName}</span>
        <Badge variant="outline" className="text-[10px]">
          {mappings.length} منتج
        </Badge>
      </div>
      {mappings.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          لا توجد ارتباطات بعد — اضغط "رفع المنتجات" لإنشائها.
        </p>
      ) : (
        <div className="max-h-56 overflow-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>منتج داخلي</TableHead>
                <TableHead>المعرّف الخارجي</TableHead>
                <TableHead>آخر رفع</TableHead>
                <TableHead>آخر مزامنة مخزون</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mappings.slice(0, 50).map((m) => (
                <TableRow key={m.id}>
                  <TableCell>#{m.productId}</TableCell>
                  <TableCell dir="ltr" className="text-xs">
                    {m.externalProductId}
                    {m.externalVariantId ? ` / ${m.externalVariantId}` : ""}
                  </TableCell>
                  <TableCell className="text-xs">
                    {m.lastPushedAt
                      ? new Date(m.lastPushedAt).toLocaleString("ar-SA")
                      : "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {m.lastInventoryPushedAt
                      ? new Date(m.lastInventoryPushedAt).toLocaleString("ar-SA")
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function CreateConnectorDialog({
  warehouses,
  onDone,
}: {
  warehouses: Warehouse[];
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [platform, setPlatform] = useState<Platform>("salla");
  const [displayName, setDisplayName] = useState("");
  const [storeUrl, setStoreUrl] = useState("");
  const [environment, setEnvironment] = useState<"sandbox" | "production">(
    "production",
  );
  const [defaultWarehouseId, setDefaultWarehouseId] = useState<string>("");
  const [accessToken, setAccessToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (displayName.trim().length < 2) {
      toast({ description: "اسم العرض مطلوب", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await api("/integrations/marketplaces", {
        method: "POST",
        body: JSON.stringify({
          platform,
          displayName: displayName.trim(),
          storeUrl: storeUrl.trim() || null,
          environment,
          defaultWarehouseId: defaultWarehouseId ? Number(defaultWarehouseId) : null,
          accessToken: accessToken.trim() || null,
          webhookSecret: webhookSecret.trim() || null,
        }),
      });
      toast({ description: "تم ربط المتجر بنجاح" });
      onDone();
    } catch (e) {
      toast({
        description: e instanceof Error ? e.message : "فشل الربط",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>ربط متجر إلكتروني</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>المنصة</Label>
          <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="salla">سلة (Salla)</SelectItem>
              <SelectItem value="zid">زد (Zid)</SelectItem>
              <SelectItem value="shopify">Shopify</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>اسم العرض</Label>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="مثال: متجر سلة الرئيسي"
            data-testid="input-display-name"
          />
        </div>
        <div className="space-y-1.5">
          <Label>رابط المتجر (Store URL / API)</Label>
          <Input
            value={storeUrl}
            onChange={(e) => setStoreUrl(e.target.value)}
            placeholder="https://example.myshopify.com/admin/api/2024-04"
            dir="ltr"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>البيئة</Label>
            <Select
              value={environment}
              onValueChange={(v) => setEnvironment(v as "sandbox" | "production")}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="production">إنتاج</SelectItem>
                <SelectItem value="sandbox">تجريبي</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>المستودع الافتراضي</Label>
            <Select
              value={defaultWarehouseId}
              onValueChange={setDefaultWarehouseId}
            >
              <SelectTrigger><SelectValue placeholder="اختر..." /></SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={String(w.id)}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>رمز الوصول (Access Token / API Key)</Label>
          <Input
            type="password"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder="••••••••"
            dir="ltr"
          />
          <p className="text-xs text-muted-foreground">
            يُحفظ مشفّراً ولا يُعاد عرضه.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>سر التحقق من Webhook</Label>
          <Input
            type="password"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder="HMAC secret"
            dir="ltr"
          />
        </div>
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={busy} data-testid="btn-create-marketplace">
          {busy ? "جاري الحفظ..." : "حفظ"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function LogsDialog({ connectorId }: { connectorId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: logs = [] } = useQuery<SyncLog[]>({
    queryKey: ["marketplace-logs", connectorId],
    queryFn: () => api<SyncLog[]>(`/integrations/marketplaces/${connectorId}/logs`),
  });

  const retry = useMutation({
    mutationFn: (id: number) =>
      api(`/integrations/marketplaces/logs/${id}/retry`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketplace-logs", connectorId] });
      toast({ description: "أعيد التنفيذ" });
    },
    onError: (e: Error) => toast({ description: e.message, variant: "destructive" }),
  });

  return (
    <DialogContent className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>سجلات المزامنة</DialogTitle>
      </DialogHeader>
      <div className="max-h-[60vh] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الوقت</TableHead>
              <TableHead>العملية</TableHead>
              <TableHead>الاتجاه</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>الزمن</TableHead>
              <TableHead>الخطأ</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="text-xs">
                  {new Date(l.createdAt).toLocaleString("ar-SA")}
                </TableCell>
                <TableCell>{l.operation}</TableCell>
                <TableCell>{l.direction}</TableCell>
                <TableCell>
                  {l.success ? (
                    <Badge variant="outline" className="bg-emerald-500/10">نجاح</Badge>
                  ) : (
                    <Badge variant="destructive">فشل</Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  {l.latencyMs ? `${l.latencyMs}ms` : "—"}
                </TableCell>
                <TableCell className="max-w-xs truncate text-xs text-destructive">
                  {l.errorMessage ?? "—"}
                </TableCell>
                <TableCell>
                  {!l.success && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => retry.mutate(l.id)}
                    >
                      <RefreshCw className="size-3.5" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {logs.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  لا توجد سجلات
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </DialogContent>
  );
}
