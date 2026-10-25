import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

/** Encodes only in browser memory. No image URL, network request or persisted seed. */
export function TotpQr({ uri }: { uri: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    setFailed(false);
    // The callback form renders synchronously to this canvas; cleanup erases pixels.
    QRCode.toCanvas(node, uri, { width: 240, margin: 4, errorCorrectionLevel: "M" }, (error) => {
      if (error) setFailed(true);
    });
    return () => { node.width = 0; node.height = 0; };
  }, [uri]);
  return <div className="space-y-2">
    <p className="text-sm">امسح الرمز بتطبيق المصادقة، أو استخدم المفتاح اليدوي أدناه.</p>
    {failed && <p role="alert">تعذّر رسم رمز QR. استخدم الإدخال اليدوي.</p>}
    <canvas ref={canvas} role="img" aria-label="رمز QR لإعداد تطبيق المصادقة" data-testid="totp-qr"
      className="max-w-full rounded-md bg-white" hidden={failed} />
    <p className="text-xs text-muted-foreground">يُنشأ داخل جهازك دون إرسال المفتاح إلى خدمة صور. لا تشاركه؛ يختفي عند انتهاء الإعداد أو مغادرة الصفحة.</p>
  </div>;
}
