import { z } from "zod/v4";
import { InvoiceDesignSchema } from "./invoice-design";

export const editorSections = ["identity", "customer", "references", "items", "totals", "qr", "notes", "footer"] as const;
export const EditorLayoutSchema = z.object({
  order: z.array(z.enum(editorSections)).length(8),
  gap: z.number().int().min(0).max(8),
  margin: z.number().int().min(3).max(18),
  align: z.enum(["start", "center", "end"]),
  metadataColumns: z.number().int().min(1).max(2),
  logoGap: z.number().int().min(0).max(8),
  widths: z.array(z.number().int().min(8).max(55)).length(5),
  showSequence: z.boolean(),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.order).size !== 8)
    ctx.addIssue({ code: "custom", message: "كل قسم مطلوب مرة واحدة؛ لا يجوز حذف البيانات الإلزامية" });
  if (value.widths.reduce((a, b) => a + b, 0) !== 100 || value.widths[0]! < 25 || value.widths[4]! < 15)
    ctx.addIssue({ code: "custom", message: "مجموع الأعمدة 100؛ الوصف 25 على الأقل والإجمالي 15 على الأقل" });
});
export const EditorDesignSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(80),
  base: InvoiceDesignSchema,
  a4: EditorLayoutSchema,
  thermal80: EditorLayoutSchema,
}).strict().superRefine((value, ctx) => {
  if (value.a4.margin < 8 || value.thermal80.margin > 5)
    ctx.addIssue({ code: "custom", message: "هوامش A4 من 8 إلى18 مم؛ وهوامش80 من3 إلى5 مم" });
});
export type EditorDesign = z.infer<typeof EditorDesignSchema>;
export interface EditorSnapshot {
  rendererVersion: 3;
  releaseId: string;
  design: EditorDesign;
}
export const defaultEditorLayout = {
  order: [...editorSections], gap: 1, margin: 12, align: "start" as const,
  metadataColumns: 2, logoGap: 1, widths: [43, 8, 18, 10, 21], showSequence: false,
};
