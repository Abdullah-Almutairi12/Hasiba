import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useCreateCompany,
  useUpdateCompany,
  getListCompaniesQueryKey,
  type Company,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ME_KEY } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Building2,
  Receipt,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";

/**
 * Zod schema mirroring the OpenAPI contract for company create/edit.
 * Field-level errors surface inline via react-hook-form + FormMessage.
 */
export const companyFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "الاسم يجب أن يكون حرفين على الأقل")
    .max(120, "الاسم طويل جداً"),
  nameEn: z.string().trim().max(120).optional().or(z.literal("")),
  vatNumber: z
    .string()
    .trim()
    .regex(/^$|^\d{15}$/, "الرقم الضريبي يجب أن يكون 15 رقماً")
    .optional()
    .or(z.literal("")),
  crNumber: z.string().trim().max(40).optional().or(z.literal("")),
  baseCurrency: z
    .string()
    .trim()
    .length(3, "العملة 3 أحرف (مثل SAR)")
    .transform((v) => v.toUpperCase()),
  fiscalYearStartMonth: z
    .number({ error: "أدخل شهرًا بين 1 و12" })
    .int()
    .min(1, "الشهر بين 1 و 12")
    .max(12, "الشهر بين 1 و 12"),
  logoUrl: z
    .string()
    .trim()
    .url("رابط غير صالح")
    .optional()
    .or(z.literal("")),
});

type CompanyFormValues = z.infer<typeof companyFormSchema>;

const empty: CompanyFormValues = {
  name: "",
  nameEn: "",
  vatNumber: "",
  crNumber: "",
  baseCurrency: "SAR",
  fiscalYearStartMonth: 1,
  logoUrl: "",
};

function fromCompany(c: Company): CompanyFormValues {
  return {
    name: c.name,
    nameEn: c.nameEn ?? "",
    vatNumber: c.vatNumber ?? "",
    crNumber: c.crNumber ?? "",
    baseCurrency: c.baseCurrency,
    fiscalYearStartMonth: c.fiscalYearStartMonth,
    logoUrl: c.logoUrl ?? "",
  };
}

const STEPS = [
  { key: "basic", title: "البيانات الأساسية", icon: Building2, fields: ["name", "nameEn", "vatNumber", "crNumber"] as const },
  { key: "tax", title: "الضريبة والعملة", icon: Receipt, fields: ["baseCurrency", "fiscalYearStartMonth"] as const },
  { key: "branding", title: "الشعار", icon: ImageIcon, fields: ["logoUrl"] as const },
] as const;

export function CompanyFormDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing?: Company | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const isEdit = Boolean(editing);

  const form = useForm<CompanyFormValues>({
    resolver: zodResolver(companyFormSchema),
    defaultValues: empty,
    mode: "onChange",
  });

  useEffect(() => {
    if (open) {
      setStep(0);
      form.reset(editing ? fromCompany(editing) : empty);
    }
  }, [open, editing, form]);

  const createMut = useCreateCompany();
  const updateMut = useUpdateCompany();
  const isPending = createMut.isPending || updateMut.isPending;

  const goNext = async () => {
    const ok = await form.trigger(STEPS[step].fields as readonly (keyof CompanyFormValues)[]);
    if (ok) setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const logoUrlValue = form.watch("logoUrl");

  const onSubmit = async (values: CompanyFormValues) => {
    const payload = {
      name: values.name,
      nameEn: values.nameEn?.trim() ? values.nameEn.trim() : null,
      vatNumber: values.vatNumber?.trim() ? values.vatNumber.trim() : null,
      crNumber: values.crNumber?.trim() ? values.crNumber.trim() : null,
      baseCurrency: values.baseCurrency,
      fiscalYearStartMonth: values.fiscalYearStartMonth,
      logoUrl: values.logoUrl?.trim() ? values.logoUrl.trim() : null,
    };
    try {
      if (isEdit && editing) {
        await updateMut.mutateAsync({ id: editing.id, data: payload });
        toast({ title: "تم تحديث الشركة" });
      } else {
        await createMut.mutateAsync({ data: payload });
        toast({ title: "تم إنشاء الشركة" });
      }
      await qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
      await qc.invalidateQueries({ queryKey: ME_KEY });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "تعذّر الحفظ",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "تعديل شركة" : "إضافة شركة جديدة"}</DialogTitle>
          <DialogDescription>
            {STEPS[step].title} — الخطوة {step + 1} من {STEPS.length}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 py-2">
          {STEPS.map((s, idx) => {
            const Icon = s.icon;
            const done = idx < step;
            const active = idx === step;
            return (
              <div key={s.key} className="flex flex-1 items-center gap-2">
                <div
                  className={`grid size-9 shrink-0 place-items-center rounded-full border-2 ${
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : done
                        ? "border-emerald-500 bg-emerald-50 text-emerald-600"
                        : "border-muted bg-muted/40 text-muted-foreground"
                  }`}
                >
                  <Icon className="size-4" />
                </div>
                {idx < STEPS.length - 1 && (
                  <div
                    className={`h-0.5 flex-1 ${done ? "bg-emerald-500" : "bg-muted"}`}
                  />
                )}
              </div>
            );
          })}
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            {step === 0 && (
              <>
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>الاسم التجاري (عربي) *</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="company-form-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="nameEn"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Trade Name (English)</FormLabel>
                      <FormControl>
                        <Input dir="ltr" {...field} data-testid="company-form-name-en" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid gap-3 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="vatNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>الرقم الضريبي (VAT)</FormLabel>
                        <FormControl>
                          <Input dir="ltr" {...field} data-testid="company-form-vat" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="crNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>السجل التجاري</FormLabel>
                        <FormControl>
                          <Input dir="ltr" {...field} data-testid="company-form-cr" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </>
            )}

            {step === 1 && (
              <div className="grid gap-3 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="baseCurrency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>العملة الأساسية (3 أحرف)</FormLabel>
                      <FormControl>
                        <Input
                          dir="ltr"
                          maxLength={3}
                          {...field}
                          onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                          data-testid="company-form-currency"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="fiscalYearStartMonth"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>بداية السنة المالية (شهر 1-12)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={12}
                          {...field}
                          onChange={(event) => field.onChange(event.target.valueAsNumber)}
                          data-testid="company-form-fy-month"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <FormField
                  control={form.control}
                  name="logoUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>رابط الشعار (Logo URL)</FormLabel>
                      <FormControl>
                        <Input
                          dir="ltr"
                          placeholder="https://..."
                          {...field}
                          data-testid="company-form-logo"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {logoUrlValue && (
                  <div className="grid place-items-center rounded-lg border bg-muted/30 p-3">
                    <img
                      src={logoUrlValue}
                      alt="logo preview"
                      className="max-h-24 object-contain"
                    />
                  </div>
                )}
              </div>
            )}

            <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                disabled={step === 0 || isPending}
                onClick={() => setStep((s) => Math.max(0, s - 1))}
              >
                <ChevronRight className="me-1 size-4" /> السابق
              </Button>
              {step < STEPS.length - 1 ? (
                <Button
                  type="button"
                  onClick={goNext}
                  data-testid="company-form-next"
                >
                  التالي <ChevronLeft className="ms-1 size-4" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={isPending}
                  data-testid="company-form-submit"
                >
                  {isPending && <Loader2 className="me-2 size-4 animate-spin" />}
                  {isEdit ? "حفظ التعديلات" : "إنشاء الشركة"}
                </Button>
              )}
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
