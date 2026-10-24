import { z } from "zod";

export const TEAM_ACTIONS = [
  { key: "inventory.read", label: "عرض مخزون المستودعات المحددة", resource: "inventory", available: true },
  { key: "inventory.cost.read", label: "عرض تكلفة المخزون", resource: "inventory", available: true },
  { key: "pos.read", label: "عرض نقطة البيع المحددة", resource: "pos", available: true },
  { key: "pos.sell", label: "بيع نقدي بالأسعار المعتمدة", resource: "pos", available: true },
  { key: "pos.shift.open", label: "فتح وردية", resource: "pos", available: true },
  ...["inventory.write","inventory.approve","pos.discount","pos.refund","pos.close","finance.read",
    "hr.read","payroll.read","crm.read","reports.export","ai.read","team.manage"].map(key => ({
      key, label: key, resource: key.split(".")[0], available: false,
    })),
] as const;
export const GrantInput = z.object({
  resource: z.enum(["inventory", "pos"]),
  branchId: z.number().int().positive(),
  warehouseIds: z.array(z.number().int().positive()).min(1).max(100),
  actions: z.array(z.string()).min(1).max(10),
  amountLimit: z.string().regex(/^\d{1,14}(\.\d{1,4})?$/).nullable(),
  startsAt: z.string().datetime({ offset: true }).nullable(),
  endsAt: z.string().datetime({ offset: true }).nullable(),
}).strict().superRefine((g, ctx) => {
  if (g.resource === "inventory" && g.amountLimit !== null) {
    ctx.addIssue({ code: "custom", message: "حد المبلغ المباشر يخص البيع فقط، ولا يطبق على عرض المخزون" });
  }
  if (!g.actions.includes(`${g.resource}.read`)) {
    ctx.addIssue({ code: "custom", message: "عرض نطاق المسؤولية شرط للأفعال التابعة له؛ لا يضاف ضمنيًا" });
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
    g.resource === "inventory" && !p.loginKinds.includes("platform"))) {
    ctx.addIssue({ code: "custom", message: "نوع الدخول لا يدعم إحدى المسؤوليات المختارة" });
  }
  if (p.deniedActions.some(key => !TEAM_ACTIONS.some(a => a.key === key))) {
    ctx.addIssue({ code: "custom", message: "منع غير معروف" });
  }
});
export type TeamGrant = z.infer<typeof GrantInput>;
export type TeamPerson = z.infer<typeof TeamPersonInput>;
export const TEAM_MODULES = ["inventory","pos","finance","hr","payroll","crm","reports","ai","team"];
export const TEAM_TEMPLATES = [
  { key: "inventory_reader", label: "موظف مخزون — قراءة", resource: "inventory", actions: ["inventory.read"] },
  { key: "cashier", label: "كاشير — بيع مباشر بلا تجاوز", resource: "pos", actions: ["pos.read","pos.sell","pos.shift.open"] },
];
