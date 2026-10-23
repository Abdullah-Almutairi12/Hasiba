import { useEffect, useRef, useState } from "react";
import {
  useGetPrintProfile,
  useUpdatePrintProfile,
  useUploadPrintLogo,
  getGetPrintProfileQueryKey,
} from "@workspace/api-client-react";
import type { GetPrintProfile200Profile, UpdatePrintProfileBodyReceiptWidthsItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Upload, Image as ImageIcon, Save, Building2, History, RefreshCw } from "lucide-react";
import { fmtDate, withBase } from "@/lib/print-docs";

type Text = "nameAr" | "nameEn" | "vatNumber" | "crNumber" | "phone" | "email" | "bankName" | "bankIban" | "termsAr" | "termsEn";
type FormState = Record<Text, string> & {
  address: Record<string, string>;
  logoObjectKey: string | null;
  wide58: boolean;
};

export const ADDRESS_KEYS: Array<[string, string]> = [
  ["buildingNumber", "رقم المبنى"], ["street", "الشارع"], ["district", "الحي"],
  ["city", "المدينة"], ["postalCode", "الرمز البريدي"], ["country", "الدولة"],
];

export function fromProfile(p: GetPrintProfile200Profile): FormState {
  const address: Record<string, string> = {};
  for (const [k] of ADDRESS_KEYS) address[k] = "";
  Object.assign(address, p.addressFields ?? {});
  return {
    nameAr: p.nameAr ?? "", nameEn: p.nameEn ?? "", vatNumber: p.vatNumber ?? "", crNumber: p.crNumber ?? "",
    phone: p.phone ?? "", email: p.email ?? "", bankName: p.bankName ?? "", bankIban: p.bankIban ?? "",
    termsAr: p.termsAr ?? "", termsEn: p.termsEn ?? "", address,
    logoObjectKey: p.logoObjectKey ?? null,
    wide58: (p.receiptWidths ?? []).includes(58),
  };
}

export function toPatch(revision: number, f: FormState) {
  const address: Record<string, string> = {};
  for (const [k, v] of Object.entries(f.address)) if (v.trim()) address[k] = v.trim();
  const receiptWidths: UpdatePrintProfileBodyReceiptWidthsItem[] = f.wide58 ? [58, 80] : [80];
  return {
    revision, nameAr: f.nameAr.trim(), nameEn: f.nameEn.trim(), vatNumber: f.vatNumber.trim(), crNumber: f.crNumber.trim(),
    address, phone: f.phone.trim(), email: f.email.trim(), bankName: f.bankName.trim(), bankIban: f.bankIban.trim(),
    termsAr: f.termsAr, termsEn: f.termsEn, logoObjectKey: f.logoObjectKey, receiptWidths,
  };
}

const HIST_FIELD: Record<string, string> = {
  nameAr: "الاسم العربي", nameEn: "الاسم الإنجليزي", vatNumber: "الرقم الضريبي", crNumber: "السجل التجاري",
  address: "العنوان", phone: "الهاتف", email: "البريد", bankName: "البنك", bankIban: "الآيبان",
  termsAr: "الشروط (عربي)", termsEn: "الشروط (إنجليزي)", logoObjectKey: "الشعار", receiptWidths: "عروض الإيصال",
};
const s = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");

export function CompanySettingsTab() {
  const qc = useQueryClient();
  const q = useGetPrintProfile();
  const updateMut = useUpdatePrintProfile();
  const uploadMut = useUploadPrintLogo();
  const { toast } = useToast();
  const [form, setForm] = useState<FormState | null>(null);
  const initRev = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const profile = q.data?.profile;
  const canEdit = !!q.data?.canEdit;
  useEffect(() => {
    if (!profile) return;
    const k = `${profile.companyId}:${profile.revision}`;
    if (initRev.current === k) return;
    initRev.current = k;
    setForm(fromProfile(profile));
  }, [profile]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const setAddr = (k: string, v: string) => setForm((f) => (f ? { ...f, address: { ...f.address, [k]: v } } : f));

  const handleSave = async () => {
    if (!profile || !form) return;
    if (!form.nameAr.trim() || !form.vatNumber.trim() || !form.crNumber.trim()) {
      toast({ title: "الاسم العربي والرقم الضريبي والسجل التجاري مطلوبة", variant: "destructive" });
      return;
    }
    try {
      await updateMut.mutateAsync({ data: toPatch(profile.revision, form) });
      toast({ title: "تم حفظ الهوية القانونية للطباعة" });
      await qc.invalidateQueries({ queryKey: getGetPrintProfileQueryKey() });
    } catch (e) {
      const status = (e as { status?: number } | null)?.status;
      toast({
        title: status === 409 ? "عدّل مستخدم آخر البيانات؛ أعد التحميل ثم راجع التغييرات" : status === 403 ? "لا تملك صلاحية التعديل" : "فشل الحفظ",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast({ title: "الحد الأقصى 2MB", variant: "destructive" }); return; }
    if (!["image/png", "image/jpeg"].includes(file.type)) { toast({ title: "يُقبل PNG أو JPEG فقط", variant: "destructive" }); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const contentBase64 = String(reader.result).replace(/^data:[^,]*,/, "");
      try {
        const r = await uploadMut.mutateAsync({ data: { contentBase64 } });
        set("logoObjectKey", r.objectKey);
        toast({ title: "تم رفع الشعار — اضغط «حفظ التغييرات» لاعتماده" });
      } catch {
        toast({ title: "فشل رفع الشعار", variant: "destructive" });
      } finally {
        if (fileRef.current) fileRef.current.value = "";
      }
    };
    reader.readAsDataURL(file);
  };

  if (q.isError) {
    return (
      <Card><CardContent className="flex items-center justify-between gap-3 p-6 text-sm">
        <span>تعذر تحميل الهوية القانونية للشركة.</span>
        <Button variant="outline" size="sm" onClick={() => q.refetch()}><RefreshCw className="me-1 size-4" />إعادة المحاولة</Button>
      </CardContent></Card>
    );
  }
  if (!form || !profile) {
    return <div className="space-y-3" data-testid="print-profile-loading"><Skeleton className="h-10 w-1/3" /><Skeleton className="h-64 w-full" /></div>;
  }

  const logoUrl = form.logoObjectKey ? withBase(`/api/storage/objects/${form.logoObjectKey}`) : null;
  const history = q.data?.history ?? [];
  const field = (k: Text, label: string, opts: { dir?: "ltr"; type?: string; testId: string; ph?: string }) => (
    <div>
      <Label>{label}</Label>
      <Input value={form[k]} onChange={(e) => set(k, e.target.value)} dir={opts.dir} type={opts.type}
        placeholder={opts.ph} disabled={!canEdit} data-testid={opts.testId} />
    </div>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-5 text-primary" />
            الهوية القانونية للطباعة (الشركة النشطة)
          </CardTitle>
          <CardDescription>
            هذه البيانات هي هوية الشركة الرسمية وتظهر في الإيصالات والإشعارات الدائنة وسندات الصرف وتقارير الإغلاق والفواتير. المراجعة رقم {profile.revision}.
            {!canEdit && " — عرض فقط، لا تملك صلاحية التعديل."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-[200px_1fr]">
            <div className="space-y-2">
              <Label>شعار الشركة</Label>
              <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
                {logoUrl ? (
                  <img src={logoUrl} alt="شعار الشركة" className="max-h-full max-w-full object-contain" data-testid="img-company-logo" />
                ) : (
                  <ImageIcon className="size-10 text-muted-foreground" />
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleFile} data-testid="input-logo-file" />
              {canEdit && (
                <div className="flex flex-col gap-1">
                  <Button type="button" variant="outline" size="sm" className="w-32" onClick={() => fileRef.current?.click()}
                    disabled={uploadMut.isPending} data-testid="button-upload-logo">
                    {uploadMut.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <Upload className="me-2 size-4" />}
                    رفع شعار
                  </Button>
                  {form.logoObjectKey && (
                    <Button type="button" variant="ghost" size="sm" className="w-32" onClick={() => set("logoObjectKey", null)} data-testid="button-remove-logo">
                      إزالة الشعار
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {field("nameAr", "الاسم القانوني (عربي) *", { testId: "input-company-name-ar" })}
              {field("nameEn", "الاسم القانوني (إنجليزي)", { dir: "ltr", testId: "input-company-name-en" })}
              {field("vatNumber", "الرقم الضريبي (VAT) *", { dir: "ltr", testId: "input-vat", ph: "300000000000003" })}
              {field("crNumber", "السجل التجاري *", { dir: "ltr", testId: "input-cr" })}
              {field("phone", "الهاتف", { dir: "ltr", testId: "input-phone" })}
              {field("email", "البريد الإلكتروني", { dir: "ltr", type: "email", testId: "input-email" })}
            </div>
          </div>

          <fieldset className="grid gap-4 sm:grid-cols-3" disabled={!canEdit}>
            <legend className="mb-2 text-sm font-semibold">العنوان الوطني</legend>
            {Object.keys(form.address).map((k) => (
              <div key={k}>
                <Label>{ADDRESS_KEYS.find(([key]) => key === k)?.[1] ?? k}</Label>
                <Input value={form.address[k]} onChange={(e) => setAddr(k, e.target.value)} data-testid={`input-address-${k}`} />
              </div>
            ))}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            {field("bankName", "اسم البنك", { testId: "input-bank-name" })}
            {field("bankIban", "رقم الآيبان (IBAN)", { dir: "ltr", testId: "input-iban", ph: "SA00 0000 0000 0000 0000 0000" })}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <Label>الشروط والأحكام (عربي)</Label>
              <Textarea rows={5} value={form.termsAr} disabled={!canEdit} onChange={(e) => set("termsAr", e.target.value)} data-testid="textarea-terms-ar" />
            </div>
            <div>
              <Label>Terms &amp; Conditions (English)</Label>
              <Textarea rows={5} value={form.termsEn} disabled={!canEdit} dir="ltr" onChange={(e) => set("termsEn", e.target.value)} data-testid="textarea-terms-en" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>عروض الإيصال الحراري</Label>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked disabled /> 80 مم (أساسي)</label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={form.wide58} disabled={!canEdit} onChange={(e) => set("wide58", e.target.checked)} data-testid="checkbox-width-58" /> 58 مم
              </label>
            </div>
          </div>

          {canEdit && (
            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={updateMut.isPending || uploadMut.isPending} data-testid="button-save-company-settings">
                {updateMut.isPending ? <Loader2 className="me-2 size-4 animate-spin" /> : <Save className="me-2 size-4" />}
                حفظ التغييرات
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><History className="size-4 text-primary" /> سجل التعديلات</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="print-history-empty">لا توجد تعديلات مسجلة بعد.</p>
          ) : (
            <ol className="space-y-2 text-sm" data-testid="print-history">
              {history.map((h, i) => {
                const changed = Array.isArray(h.changedFields) ? h.changedFields.map(s) : h.changes && typeof h.changes === "object" ? Object.keys(h.changes) : [];
                return (
                  <li key={s(h.id) || i} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                      <span>{fmtDate(h.createdAt ?? h.changedAt ?? h.at)}</span>
                      {s(h.revision) && <span>مراجعة {s(h.revision)}</span>}
                      <span>{s(h.actorName ?? h.userName ?? h.changedByName) || (s(h.userId ?? h.changedBy) ? `مستخدم #${s(h.userId ?? h.changedBy)}` : "—")}</span>
                    </div>
                    {changed.length > 0 && <div className="mt-1">{changed.map((c) => HIST_FIELD[c] ?? c).join("، ")}</div>}
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
