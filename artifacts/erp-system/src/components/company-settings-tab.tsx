import { useEffect, useRef, useState } from "react";
import {
  useGetCompanySettings,
  useUpdateCompanySettings,
  useUploadCompanyLogo,
} from "@workspace/api-client-react";
import type { CompanySettings } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Upload, Image as ImageIcon, Save, Building2 } from "lucide-react";

type FormState = {
  nameEn: string;
  nameAr: string;
  vatNumber: string;
  address: string;
  phone: string;
  email: string;
  bankName: string;
  bankIban: string;
  termsEn: string;
  termsAr: string;
};

const EMPTY: FormState = {
  nameEn: "",
  nameAr: "",
  vatNumber: "",
  address: "",
  phone: "",
  email: "",
  bankName: "",
  bankIban: "",
  termsEn: "",
  termsAr: "",
};

function fromRow(row: CompanySettings | undefined): FormState {
  if (!row) return EMPTY;
  return {
    nameEn: row.nameEn ?? "",
    nameAr: row.nameAr ?? "",
    vatNumber: row.vatNumber ?? "",
    address: row.address ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    bankName: row.bankName ?? "",
    bankIban: row.bankIban ?? "",
    termsEn: row.termsEn ?? "",
    termsAr: row.termsAr ?? "",
  };
}

export function CompanySettingsTab() {
  const { data, refetch, isLoading } = useGetCompanySettings();
  const updateMut = useUpdateCompanySettings();
  const uploadMut = useUploadCompanyLogo();
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (data) setForm(fromRow(data));
  }, [data]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    try {
      await updateMut.mutateAsync({
        data: {
          nameEn: form.nameEn || null,
          nameAr: form.nameAr || null,
          vatNumber: form.vatNumber || null,
          address: form.address || null,
          phone: form.phone || null,
          email: form.email || null,
          bankName: form.bankName || null,
          bankIban: form.bankIban || null,
          termsEn: form.termsEn || null,
          termsAr: form.termsAr || null,
        },
      });
      toast({ title: "تم حفظ بيانات الشركة" });
      void refetch();
    } catch {
      toast({ title: "فشل الحفظ", variant: "destructive" });
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "الحد الأقصى 5MB", variant: "destructive" });
      return;
    }
    const allowed = ["image/png", "image/jpeg"] as const;
    type AllowedType = (typeof allowed)[number];
    if (!(allowed as readonly string[]).includes(file.type)) {
      toast({ title: "يُقبل PNG أو JPEG فقط", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result);
      try {
        await uploadMut.mutateAsync({
          data: { image: dataUrl, contentType: file.type as AllowedType },
        });
        toast({ title: "تم رفع الشعار" });
        void refetch();
      } catch {
        toast({ title: "فشل رفع الشعار", variant: "destructive" });
      } finally {
        if (fileRef.current) fileRef.current.value = "";
      }
    };
    reader.readAsDataURL(file);
  };

  const logoUrl = data?.logoObjectKey
    ? `/api/storage/objects/${data.logoObjectKey}`
    : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-5 text-primary" />
            بيانات الشركة (ترويسة الفواتير وأوامر الشراء)
          </CardTitle>
          <CardDescription>
            هذه الحقول تظهر في رأس وذيل ملفات PDF لأوامر الشراء والفواتير. عند ترك أي حقل فارغاً يتم استخدام القيمة الافتراضية من متغيرات النظام.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-[200px_1fr]">
            <div className="space-y-2">
              <Label>شعار الشركة</Label>
              <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoUrl}
                    alt="شعار الشركة"
                    className="max-h-full max-w-full object-contain"
                    data-testid="img-company-logo"
                  />
                ) : (
                  <ImageIcon className="size-10 text-muted-foreground" />
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={handleFile}
                data-testid="input-logo-file"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-32"
                onClick={() => fileRef.current?.click()}
                disabled={uploadMut.isPending}
                data-testid="button-upload-logo"
              >
                {uploadMut.isPending ? (
                  <Loader2 className="me-2 size-4 animate-spin" />
                ) : (
                  <Upload className="me-2 size-4" />
                )}
                رفع شعار
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>الاسم (عربي)</Label>
                <Input
                  value={form.nameAr}
                  onChange={(e) => set("nameAr", e.target.value)}
                  placeholder="حاسبة.AI"
                  data-testid="input-company-name-ar"
                />
              </div>
              <div>
                <Label>الاسم (إنجليزي)</Label>
                <Input
                  value={form.nameEn}
                  onChange={(e) => set("nameEn", e.target.value)}
                  placeholder="Hasaba.AI"
                  dir="ltr"
                  data-testid="input-company-name-en"
                />
              </div>
              <div>
                <Label>الرقم الضريبي (VAT)</Label>
                <Input
                  value={form.vatNumber}
                  onChange={(e) => set("vatNumber", e.target.value)}
                  placeholder="300000000000003"
                  dir="ltr"
                  data-testid="input-vat"
                />
              </div>
              <div>
                <Label>الهاتف</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  dir="ltr"
                  data-testid="input-phone"
                />
              </div>
              <div>
                <Label>البريد الإلكتروني</Label>
                <Input
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  type="email"
                  dir="ltr"
                  data-testid="input-email"
                />
              </div>
              <div className="sm:col-span-2">
                <Label>العنوان</Label>
                <Input
                  value={form.address}
                  onChange={(e) => set("address", e.target.value)}
                  placeholder="الرياض، المملكة العربية السعودية"
                  data-testid="input-address"
                />
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>اسم البنك</Label>
              <Input
                value={form.bankName}
                onChange={(e) => set("bankName", e.target.value)}
                placeholder="مصرف الراجحي"
                data-testid="input-bank-name"
              />
            </div>
            <div>
              <Label>رقم الآيبان (IBAN)</Label>
              <Input
                value={form.bankIban}
                onChange={(e) => set("bankIban", e.target.value)}
                placeholder="SA00 0000 0000 0000 0000 0000"
                dir="ltr"
                data-testid="input-iban"
              />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <Label>شروط أمر الشراء (عربي)</Label>
              <Textarea
                rows={6}
                value={form.termsAr}
                onChange={(e) => set("termsAr", e.target.value)}
                data-testid="textarea-terms-ar"
              />
            </div>
            <div>
              <Label>Purchase Order Terms (English)</Label>
              <Textarea
                rows={6}
                value={form.termsEn}
                onChange={(e) => set("termsEn", e.target.value)}
                dir="ltr"
                data-testid="textarea-terms-en"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={updateMut.isPending || isLoading}
              data-testid="button-save-company-settings"
            >
              {updateMut.isPending ? (
                <Loader2 className="me-2 size-4 animate-spin" />
              ) : (
                <Save className="me-2 size-4" />
              )}
              حفظ التغييرات
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
