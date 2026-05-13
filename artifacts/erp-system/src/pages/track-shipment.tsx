import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PackageCheck,
  PackageX,
  Truck,
  PackagePlus,
  RotateCcw,
  AlertCircle,
} from "lucide-react";

interface TrackingEvent {
  code: string;
  description: string;
  at: string;
}
interface TrackingResponse {
  awbNumber: string;
  status: string;
  carrier: string;
  carrierDisplayName: string;
  history: TrackingEvent[];
  updatedAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  created: "تم إنشاء البوليصة",
  in_transit: "قيد التوصيل",
  delivered: "تم التسليم",
  returned: "مرتجع",
  cancelled: "ملغي",
};

function statusIcon(s: string) {
  if (s === "delivered") return <PackageCheck className="size-5 text-emerald-600" />;
  if (s === "returned") return <RotateCcw className="size-5 text-amber-600" />;
  if (s === "cancelled") return <PackageX className="size-5 text-rose-600" />;
  if (s === "in_transit") return <Truck className="size-5 text-blue-600" />;
  return <PackagePlus className="size-5 text-muted-foreground" />;
}

export default function TrackShipmentPage() {
  const [, params] = useRoute<{ awb: string }>("/track/:awb");
  const awb = params?.awb ?? "";
  const [data, setData] = useState<TrackingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!awb) return;
    setLoading(true);
    setError(null);
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    fetch(`${base}/api/integrations/track/${encodeURIComponent(awb)}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        return r.json() as Promise<TrackingResponse>;
      })
      .then((d) => setData(d))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [awb]);

  return (
    <div dir="rtl" className="min-h-screen bg-muted/30 px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="text-center space-y-1">
          <h1 className="text-2xl font-bold">تتبّع الشحنة</h1>
          <p className="text-sm text-muted-foreground">
            رقم البوليصة: <span className="font-mono">{awb}</span>
          </p>
        </header>

        {loading && (
          <Card>
            <CardContent className="p-6 space-y-3">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        )}

        {error && !loading && (
          <Card>
            <CardContent className="p-6 flex items-center gap-3 text-destructive">
              <AlertCircle className="size-5" />
              <span>{error}</span>
            </CardContent>
          </Card>
        )}

        {data && !loading && (
          <>
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {statusIcon(data.status)}
                  <CardTitle className="text-lg">
                    {STATUS_LABEL[data.status] ?? data.status}
                  </CardTitle>
                </div>
                <Badge variant="outline" className="font-normal">
                  {data.carrierDisplayName}
                </Badge>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                آخر تحديث: {new Date(data.updatedAt).toLocaleString("ar-SA")}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">سجل الأحداث</CardTitle>
              </CardHeader>
              <CardContent>
                {data.history.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    لا توجد أحداث متاحة بعد. الرجاء المحاولة لاحقاً.
                  </p>
                ) : (
                  <ol className="relative border-r border-border pr-6 space-y-5">
                    {[...data.history]
                      .sort(
                        (a, b) =>
                          (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0),
                      )
                      .map((e, i) => (
                        <li key={`${e.at}-${i}`} className="relative">
                          <span className="absolute -right-[33px] top-1.5 size-3 rounded-full bg-primary ring-4 ring-background" />
                          <div className="font-medium">
                            {e.description || e.code || "—"}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {e.code && (
                              <span className="font-mono ml-2">{e.code}</span>
                            )}
                            {e.at
                              ? new Date(e.at).toLocaleString("ar-SA")
                              : ""}
                          </div>
                        </li>
                      ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </>
        )}

        <footer className="text-center text-xs text-muted-foreground pt-4">
          مدعوم بواسطة حاسبة.AI
        </footer>
      </div>
    </div>
  );
}
