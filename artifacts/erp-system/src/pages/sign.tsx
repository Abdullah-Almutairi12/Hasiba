import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, FileSignature } from "lucide-react";

const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

type SignView = {
  request: { id: number; status: string; documentTitle: string };
  signer: { id: number; name: string; email: string; status: string };
};

export default function SignPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [data, setData] = useState<SignView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedName, setSignedName] = useState("");
  const [declineReason, setDeclineReason] = useState("");
  const [done, setDone] = useState<"signed" | "declined" | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  useEffect(() => {
    fetch(`${API_BASE}/sign/${token}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? "الرابط غير صالح");
        return r.json();
      })
      .then((d: SignView) => {
        setData(d);
        setSignedName(d.signer.name);
        if (d.signer.status === "signed") setDone("signed");
        if (d.signer.status === "declined") setDone("declined");
      })
      .catch((e: Error) => setError(e.message));
  }, [token]);

  // Canvas drawing for signature
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";

    const pos = (e: MouseEvent | TouchEvent) => {
      const rect = c.getBoundingClientRect();
      const pt = "touches" in e ? e.touches[0] : (e as MouseEvent);
      return { x: pt.clientX - rect.left, y: pt.clientY - rect.top };
    };
    const start = (e: MouseEvent | TouchEvent) => { drawing.current = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); };
    const move = (e: MouseEvent | TouchEvent) => { if (!drawing.current) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); };
    const end = () => { drawing.current = false; };
    c.addEventListener("mousedown", start); c.addEventListener("mousemove", move); window.addEventListener("mouseup", end);
    c.addEventListener("touchstart", start); c.addEventListener("touchmove", move); window.addEventListener("touchend", end);
    return () => {
      c.removeEventListener("mousedown", start); c.removeEventListener("mousemove", move); window.removeEventListener("mouseup", end);
      c.removeEventListener("touchstart", start); c.removeEventListener("touchmove", move); window.removeEventListener("touchend", end);
    };
  }, [data]);

  const clearCanvas = () => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
  };

  const sign = async () => {
    const c = canvasRef.current;
    const sigImg = c ? c.toDataURL("image/png") : "";
    const r = await fetch(`${API_BASE}/sign/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signedName, signatureImage: sigImg }),
    });
    if (!r.ok) {
      setError((await r.json()).error ?? "فشل التوقيع");
      return;
    }
    setDone("signed");
  };

  const decline = async () => {
    const r = await fetch(`${API_BASE}/sign/${token}/decline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: declineReason }),
    });
    if (!r.ok) {
      setError((await r.json()).error ?? "فشل");
      return;
    }
    setDone("declined");
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50" dir="rtl">
        <Alert variant="destructive" className="max-w-md"><AlertDescription>{error}</AlertDescription></Alert>
      </div>
    );
  }
  if (!data) return <div className="p-8 text-center" dir="rtl">جاري التحميل...</div>;

  if (done === "signed") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50" dir="rtl">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-12 space-y-3">
            <CheckCircle2 className="size-12 text-green-600 mx-auto" />
            <div className="text-xl font-semibold">تم التوقيع بنجاح</div>
            <p className="text-sm text-muted-foreground">شكراً لك. تم تسجيل توقيعك على وثيقة "{data.request.documentTitle}".</p>
          </CardContent>
        </Card>
      </div>
    );
  }
  if (done === "declined") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50" dir="rtl">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-12 space-y-3">
            <div className="text-xl font-semibold">تم رفض التوقيع</div>
            <p className="text-sm text-muted-foreground">تم إبلاغ مُصدِر الوثيقة برفضك.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4" dir="rtl">
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSignature className="size-5" /> طلب توقيع: {data.request.documentTitle}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm">
            مرحباً <strong>{data.signer.name}</strong>، يرجى توقيع الوثيقة أدناه إلكترونياً.
          </div>

          <div>
            <label className="text-sm font-medium">الاسم الكامل</label>
            <Input value={signedName} onChange={(e) => setSignedName(e.target.value)} />
          </div>

          <div>
            <label className="text-sm font-medium">التوقيع (ارسم بالماوس أو إصبعك)</label>
            <div className="border rounded bg-white">
              <canvas ref={canvasRef} width={600} height={180} className="w-full touch-none" />
            </div>
            <Button variant="ghost" size="sm" onClick={clearCanvas} className="mt-1">مسح</Button>
          </div>

          <div className="flex gap-2">
            <Button onClick={sign} className="flex-1">توقيع الوثيقة</Button>
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">رفض التوقيع</summary>
            <div className="mt-2 space-y-2">
              <Textarea placeholder="السبب (اختياري)" value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} />
              <Button variant="destructive" size="sm" onClick={decline}>رفض</Button>
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
