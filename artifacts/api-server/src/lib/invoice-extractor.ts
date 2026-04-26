import { getOpenAI, isOpenAIConfigured } from "./openai-client";

export type ExtractedInvoiceItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

export type ExtractedInvoice = {
  supplierName: string;
  supplierVatNumber: string | null;
  invoiceNumber: string;
  invoiceDate: string | null; // ISO date
  dueDate: string | null;
  currency: string; // e.g. "SAR"
  subtotal: number;
  vat: number;
  total: number;
  items: ExtractedInvoiceItem[];
  rawText: string | null;
  confidence: number; // 0..1 self-assessed
};

const SYSTEM_PROMPT = `أنت وكيل ذكي متخصص في استخراج بيانات فواتير الموردين السعودية والعربية.
ستستلم صورة فاتورة وسيُطلب منك استخراج البيانات بدقة.

أعد استجابة JSON فقط (لا نص آخر) بهذا الشكل بالضبط:
{
  "supplierName": "اسم المورد كما يظهر في الفاتورة",
  "supplierVatNumber": "الرقم الضريبي للمورد أو null",
  "invoiceNumber": "رقم الفاتورة",
  "invoiceDate": "YYYY-MM-DD أو null",
  "dueDate": "YYYY-MM-DD أو null إذا لم يُذكر",
  "currency": "SAR أو رمز العملة",
  "subtotal": 0,
  "vat": 0,
  "total": 0,
  "items": [
    { "description": "وصف المنتج", "quantity": 1, "unitPrice": 0, "total": 0 }
  ],
  "rawText": "نص موجز جداً يلخص ما رأيت (اختياري)",
  "confidence": 0.9
}

قواعد:
- استخدم أرقاماً (numbers) لجميع المبالغ، ليس نصاً.
- إذا لم تستطع قراءة حقل معين، استخدم null أو 0 أو "" حسب النوع.
- التاريخ بصيغة ISO (YYYY-MM-DD).
- العملة الافتراضية SAR.
- اجعل confidence بين 0 و 1 يمثل ثقتك في الاستخراج.`;

export async function extractInvoiceFromImage(imageDataUri: string): Promise<ExtractedInvoice> {
  if (!isOpenAIConfigured()) {
    throw new Error("OpenAI Vision غير مهيأ. تواصل مع مدير النظام.");
  }
  if (!imageDataUri.startsWith("data:image/")) {
    throw new Error("نوع الصورة غير صالح. يجب أن تكون data URI لصورة.");
  }

  const openai = getOpenAI();

  const completion = await openai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "استخرج بيانات هذه الفاتورة وأعدها كـ JSON فقط:" },
          { type: "image_url", image_url: { url: imageDataUri, detail: "high" } },
        ],
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content?.trim() ?? "{}";
  let parsed: Partial<ExtractedInvoice>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("فشل تحليل استجابة الوكيل. حاول بصورة أوضح.");
  }

  // Defensive normalization
  const items: ExtractedInvoiceItem[] = Array.isArray(parsed.items)
    ? parsed.items.map((it) => ({
        description: String(it?.description ?? "").trim() || "بند",
        quantity: Number(it?.quantity ?? 1) || 1,
        unitPrice: Number(it?.unitPrice ?? 0) || 0,
        total: Number(it?.total ?? 0) || 0,
      }))
    : [];

  const total = Number(parsed.total ?? 0) || 0;
  const subtotal = Number(parsed.subtotal ?? 0) || total / 1.15;
  const vat = Number(parsed.vat ?? 0) || total - subtotal;

  return {
    supplierName: String(parsed.supplierName ?? "").trim() || "مورد غير معروف",
    supplierVatNumber: parsed.supplierVatNumber ? String(parsed.supplierVatNumber) : null,
    invoiceNumber: String(parsed.invoiceNumber ?? "").trim() || `INV-${Date.now()}`,
    invoiceDate: parsed.invoiceDate ? String(parsed.invoiceDate) : null,
    dueDate: parsed.dueDate ? String(parsed.dueDate) : null,
    currency: String(parsed.currency ?? "SAR"),
    subtotal,
    vat,
    total,
    items,
    rawText: parsed.rawText ? String(parsed.rawText) : null,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.7))),
  };
}
