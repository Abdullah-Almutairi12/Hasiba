import { z } from "zod";

export const TEAM_ACTIONS = [
  {key:"sales.read",label:"عرض فواتير العملاء وتفاصيلها ضمن الفرع — لا PDF أو طباعة أو تصدير ضمني",resource:"sales",available:true},
  {key:"sales.invoices.print",label:"معاينة PDF للطباعة وطباعة فاتورة عميل — يحتاج عرض الفواتير، لا تصدير ضمني",resource:"sales",available:true},
  {key:"sales.invoices.export",label:"تصدير PDF لفاتورة عميل — يحتاج عرض الفواتير، لا طباعة ضمنية",resource:"sales",available:true},
  ...["create","edit","review","submit","approve","post","cancel","reverse"].map((action,i)=>({
    key:`procurement.invoices.${action}`,label:["إنشاء مسودة فاتورة مورد","تعديل مسودة فاتورة مورد","مراجعة مطابقة فاتورة مورد","تقديم فاتورة مورد للاعتماد","اعتماد فاتورة مورد","ترحيل فاتورة مورد","إلغاء مسودة فاتورة مورد","عكس فاتورة مورد مرحلة"][i]!,
    resource:"procurement" as const,available:true,
  })),
  { key: "procurement.invoices.read", label: "عرض فواتير الموردين وتفاصيلها ومرفقها ضمن النطاق", resource: "procurement", available: true },
  { key: "procurement.invoices.compare", label: "معاينة مطابقة فاتورة المورد — لا قرار مراجعة أو اعتماد أو ترحيل", resource: "procurement", available: true },
  { key: "procurement.invoices.print", label: "طباعة فاتورة مورد", resource: "procurement", available: true },
  { key: "procurement.invoices.export", label: "تنزيل نسخة PDF من فاتورة مورد", resource: "procurement", available: true },
  ...[
    ["read", "اختيار مسؤولية الموردين وأوامر الشراء — دون منح قراءة المستندات ضمنيًا"],
    ["suppliers.read", "عرض بيانات الموردين — لا فواتيرهم أو دفعاتهم"],
    ["suppliers.create", "إنشاء مورد"],
    ["suppliers.edit", "تعديل مورد"],
    ["suppliers.export", "تصدير دليل الموردين"],
    ["orders.read", "عرض أوامر الشراء ضمن النطاق والحد"],
    ["orders.create", "إنشاء أمر شراء"],
    ["orders.confirm", "تقديم وتأكيد أمر شراء — دون استلام أو صرف"],
    ["orders.approve", "اعتماد أمر شراء لشخص آخر"],
    ["orders.cancel", "إلغاء أمر شراء"],
    ["orders.close", "إغلاق أمر شراء مستلم بالكامل — لا استلام مخزني"],
    ["orders.print", "طباعة أمر شراء"],
    ["orders.export", "تنزيل ملف أمر شراء"],
    ["orders.send", "إرسال أمر شراء وإعادة محاولته بصلاحية مستقلة"],
    ["receipts.read", "قراءة بنود استلام المشتريات والكميات — دون أسعار أو أرصدة"],
    ["receipts.receive", "استلام مشتريات مؤكدة كاملًا أو جزئيًا في الوجهة المحددة — لا اعتماد أو صرف أو عكس"],
    ["receipts.receive_self", "استلام أمر شراء أنشأته بنفسي — فقط عند تفعيل سياسة المنشأة، بالإضافة لإذن الاستلام"],
  ].map(([key, label]) => ({ key: `procurement.${key}`, label, resource: "procurement", available: true })),
  { key: "inventory.read", label: "عرض مخزون المستودعات المحددة", resource: "inventory", available: true },
  { key: "inventory.cost.read", label: "عرض تكلفة المخزون", resource: "inventory", available: true },
  { key: "inventory.move.receipt", label: "استلام يدوي للصنف العادي بالتكلفة الخادمية — لا تسوية أو شراء أو تعديل تكلفة", resource: "inventory", available: true },
  { key: "inventory.move.issue", label: "صرف مخزون يدوي للصنف العادي — لا صرف نقد أو تعديل تكلفة", resource: "inventory", available: true },
  { key: "inventory.transfer.send", label: "إرسال تحويل للصنف العادي — يحتاج منحًا صريحة على المصدر والوجهة، ولا يمنح الاستلام", resource: "inventory", available: true },
  { key: "inventory.transfer.receive", label: "استلام تحويل قائم كاملًا في مستودع الوجهة المحدد — لا إرسال أو تسوية", resource: "inventory", available: true },
  { key: "inventory.stocktake.count", label: "عدّ جرد قائم في المستودع المحدد — دون إنشاء أو إقفال أو تكلفة", resource: "inventory", available: true },
  { key: "inventory.stocktake.approve", label: "اعتماد فروق الجرد بقيمتها الخادمية ضمن المستودع والحد — دون ترحيل", resource: "inventory", available: true },
  { key: "inventory.stocktake.post", label: "ترحيل فروق الجرد المعتمدة بالخدمات الأصلية — دون عد أو اعتماد ضمني", resource: "inventory", available: true },
  { key: "inventory.stocktake.approve_self", label: "استثناء صريح لاعتماد جلسة شاركت في عدها — يحتاج سياسة وتأكيد هوية وسبب وحد مالي صريح", resource: "inventory", available: true },
  { key: "pos.read", label: "عرض نقطة البيع المحددة", resource: "pos", available: true },
  { key: "pos.receipts.print", label: "إنشاء ومعاينة وطباعة إيصالات البيع", resource: "pos", available: true },
  { key: "pos.receipts.export", label: "تصدير ملفات إيصالات البيع", resource: "pos", available: true },
  { key: "pos.sell", label: "تنفيذ بيع ضمن النطاق والحد المالي", resource: "pos", available: true },
  { key: "pos.shift.open", label: "فتح وردية", resource: "pos", available: true },
  { key: "pos.payment.record", label: "تسجيل تحصيل غير نقدي أو آجل — ليس تنفيذ دفع شبكي", resource: "pos", available: true },
  { key: "pos.discount", label: "خصم يخضع لسياسة وحدود الشركة", resource: "pos", available: true },
  { key: "pos.discount.request", label: "طلب استثناء خصم باعتماد مستقل للعملية، دون دخول مدير", resource: "pos", available: true },
  { key: "pos.shift.close", label: "عد الصندوق وطلب إقفال ورديات الفرع المحدد، ولو فتحها موظف آخر", resource: "pos", available: true },
  { key: "pos.shift.difference", label: "اعتماد فرق صندوق قدمه شخص آخر", resource: "pos", available: true },
  { key: "pos.shift.responsibility", label: "قرار مسؤولية فرق صندوق — دون مديونية أو خصم راتب", resource: "pos", available: true },
  { key: "pos.return.request", label: "طلب مرتجع يتطلب مراجعة مستقلة", resource: "pos", available: true },
  { key: "pos.return.approve", label: "مراجعة واعتماد مرتجع شخص آخر ضمن المصدر والفرع والمستودع والمبلغ", resource: "pos", available: true },
  { key: "pos.return.direct", label: "مرتجع مباشر ما لم تلزم سياسة الشركة الموافقة", resource: "pos", available: true },
  { key: "pos.return.receive", label: "إثبات استلام البضاعة وإعادتها للمستودع المحدد", resource: "pos", available: true },
  { key: "pos.return.payout", label: "رد النقد أو تسجيل طلب رد غير نقدي", resource: "pos", available: true },
  { key: "pos.return.external", label: "توثيق دليل تنفيذ الرد الخارجي", resource: "pos", available: true },
  ...["inventory.write","inventory.approve","pos.refund","pos.close","finance.read",
    "hr.read","payroll.read","crm.read","reports.export","ai.read","team.manage"].map(key => ({
      key, label: key, resource: key.split(".")[0], available: false,
    })),
] as const;
export const GrantInput = z.object({
  templateId:z.number().int().positive().nullable().optional(),
  templateRevision:z.number().int().positive().nullable().optional(),
  templateMode:z.enum(["inherit","override"]).nullable().optional(),
  resource: z.enum(["inventory", "pos", "procurement", "sales"]),
  branchId: z.number().int().positive(),
  warehouseIds: z.array(z.number().int().positive()).max(100),
  actions: z.array(z.string()).min(1).max(20),
  amountLimit: z.string().regex(/^\d{1,14}(\.\d{1,4})?$/).nullable(),
  startsAt: z.string().datetime({ offset: true }).nullable(),
  endsAt: z.string().datetime({ offset: true }).nullable(),
}).strict().superRefine((g, ctx) => {
  if (!["procurement","sales"].includes(g.resource) && !g.warehouseIds.length)
    ctx.addIssue({code:"custom",message:"هذه المسؤولية تحتاج مستودعًا واحدًا على الأقل"});
  if(g.templateId ? !g.templateRevision || !g.templateMode : g.templateRevision || g.templateMode)
    ctx.addIssue({code:"custom",message:"ربط القالب يحتاج المصدر والإصدار ونمط الوراثة معًا"});
  if (g.resource === "inventory" && g.amountLimit !== null &&
    !g.actions.some(a=>["inventory.move.receipt","inventory.move.issue","inventory.transfer.send","inventory.transfer.receive",
      "inventory.stocktake.approve","inventory.stocktake.post"].includes(a))) {
    ctx.addIssue({ code: "custom", message: "سقف قيمة المخزون يحتاج إذن حركة صريحًا؛ لا يخص القراءة وحدها" });
  }
  if (!g.actions.includes(`${g.resource}.read`)) {
    ctx.addIssue({ code: "custom", message: "عرض نطاق المسؤولية شرط للأفعال التابعة له؛ لا يضاف ضمنيًا" });
  }
  if (g.actions.includes("pos.return.direct") && !g.actions.includes("pos.return.request")) {
    ctx.addIssue({ code: "custom", message: "المرتجع المباشر يحتاج صلاحية طلب المرتجع صراحةً؛ ولا يمنح استلام البضاعة أو صرف المال" });
  }
  if (g.actions.some(key => !TEAM_ACTIONS.some(a => a.key === key && a.available && a.resource === g.resource))) {
    ctx.addIssue({ code: "custom", message: "هذا الفعل غير مغطى بمسار صلاحيات محدد؛ لا يمكن منحه" });
  }
  if (g.endsAt && new Date(g.endsAt) <= new Date(g.startsAt ?? Date.now())) {
    ctx.addIssue({ code: "custom", message: "نهاية المسؤولية يجب أن تلي بدايتها" });
  }
});
export const TeamPersonInput = z.object({
  creationKey: z.string().uuid(),
  name: z.string().trim().min(2).max(200),
  email: z.string().email().transform(s => s.toLowerCase()).nullable(),
  loginKinds: z.array(z.enum(["platform", "pos"])).max(2),
  grants: z.array(GrantInput).max(30),
  deniedActions: z.array(z.string()).max(30),
}).strict().superRefine((p, ctx) => {
  if (!p.loginKinds.length && p.grants.length) ctx.addIssue({ code: "custom", message: "سجل بلا دخول لا يمنح مسؤوليات دخول" });
  if (p.loginKinds.includes("platform") && !p.email) ctx.addIssue({ code: "custom", message: "حساب المنصة يحتاج بريدًا حقيقيًا لمسار التفعيل" });
  if (p.grants.some(g => g.resource === "pos" && !p.loginKinds.includes("pos") ||
    g.resource !== "pos" && !p.loginKinds.includes("platform"))) {
    ctx.addIssue({ code: "custom", message: "نوع الدخول لا يدعم إحدى المسؤوليات المختارة" });
  }
  if (p.deniedActions.some(key => !TEAM_ACTIONS.some(a => a.key === key))) {
    ctx.addIssue({ code: "custom", message: "منع غير معروف" });
  }
});
export type TeamGrant = z.infer<typeof GrantInput>;
export type TeamPerson = z.infer<typeof TeamPersonInput>;
export const TEAM_MODULES = ["inventory","pos","procurement","sales","finance","hr","payroll","crm","reports","ai","team"];
export const TEAM_TEMPLATES = [
  { key: "inventory_reader", label: "موظف مخزون — قراءة", resource: "inventory", actions: ["inventory.read"] },
  { key: "cashier", label: "كاشير — بيع مباشر بلا تجاوز", resource: "pos", actions: ["pos.read","pos.sell","pos.shift.open"] },
];
