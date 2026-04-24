import React, { useState } from "react";
import {
  useListInvoices,
  useGetInvoiceStats,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, UploadCloud, CheckCircle2, Clock, AlertTriangle, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";

export default function Invoices() {
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: stats, isLoading: isLoadingStats } = useGetInvoiceStats();
  const { data: invoices, isLoading: isLoadingInvoices } = useListInvoices({
    status: statusFilter === "all" ? undefined : (statusFilter as any),
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "done":
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-none"><CheckCircle2 className="size-3 mr-1" /> مكتمل</Badge>;
      case "processing":
        return <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-100 border-none"><Clock className="size-3 mr-1" /> قيد المعالجة</Badge>;
      case "needs_review":
        return <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200"><AlertTriangle className="size-3 mr-1" /> يحتاج مراجعة</Badge>;
      case "failed":
        return <Badge variant="destructive" className="bg-red-100 text-red-800 hover:bg-red-100 border-none"><AlertCircle className="size-3 mr-1" /> فشل</Badge>;
      default:
        return <Badge variant="outline">معلق</Badge>;
    }
  };

  return (
    <div className="space-y-6 pb-8 max-w-7xl mx-auto">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">فواتير الموردين (AI)</h1>
          <p className="text-muted-foreground">استخراج بيانات الفواتير تلقائياً باستخدام الذكاء الاصطناعي</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium text-muted-foreground">فواتير اليوم</p>
              <FileText className="size-4 text-muted-foreground" />
            </div>
            {isLoadingStats ? <Skeleton className="h-8 w-16" /> : <div className="text-2xl font-bold">{stats?.todayCount || 0}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium text-muted-foreground">قيد المعالجة</p>
              <Clock className="size-4 text-blue-500" />
            </div>
            {isLoadingStats ? <Skeleton className="h-8 w-16" /> : <div className="text-2xl font-bold">{stats?.processingCount || 0}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium text-muted-foreground">تحتاج مراجعة</p>
              <AlertTriangle className="size-4 text-yellow-500" />
            </div>
            {isLoadingStats ? <Skeleton className="h-8 w-16" /> : <div className="text-2xl font-bold">{stats?.needsReviewCount || 0}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
              <p className="text-sm font-medium text-muted-foreground">نسبة الدقة (AI)</p>
              <CheckCircle2 className="size-4 text-green-500" />
            </div>
            {isLoadingStats ? <Skeleton className="h-8 w-16" /> : <div className="text-2xl font-bold text-green-600">{stats?.accuracyRate || 0}%</div>}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-1 border-dashed border-2 bg-muted/30">
          <CardContent className="p-10 flex flex-col items-center justify-center text-center h-full min-h-[300px] cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <UploadCloud className="size-8 text-primary" />
            </div>
            <h3 className="font-semibold text-lg mb-1">رفع فاتورة جديدة</h3>
            <p className="text-sm text-muted-foreground mb-4">اسحب الفاتورة هنا أو اضغط لاختيار ملف (PDF, JPG, PNG)</p>
            <Button>تصفح الملفات</Button>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
            <CardTitle>أحدث الفواتير</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant={statusFilter === "all" ? "default" : "outline"} size="sm" onClick={() => setStatusFilter("all")}>الكل</Button>
              <Button variant={statusFilter === "needs_review" ? "default" : "outline"} size="sm" onClick={() => setStatusFilter("needs_review")}>للمراجعة</Button>
              <Button variant={statusFilter === "processing" ? "default" : "outline"} size="sm" onClick={() => setStatusFilter("processing")}>قيد المعالجة</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>رقم الفاتورة</TableHead>
                  <TableHead>المورد</TableHead>
                  <TableHead>المبلغ</TableHead>
                  <TableHead className="text-center">الدقة</TableHead>
                  <TableHead className="text-left">الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingInvoices ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell className="text-center"><Skeleton className="h-5 w-12 mx-auto" /></TableCell>
                      <TableCell className="text-left"><Skeleton className="h-6 w-24 ml-auto rounded-full" /></TableCell>
                    </TableRow>
                  ))
                ) : invoices?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">لا توجد فواتير</TableCell>
                  </TableRow>
                ) : (
                  invoices?.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-mono text-sm">{invoice.invoiceNumber || '---'}</TableCell>
                      <TableCell className="font-medium">{invoice.supplierName || 'جاري الاستخراج...'}</TableCell>
                      <TableCell className="font-semibold">
                        {invoice.amount ? new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(invoice.amount) : '---'}
                      </TableCell>
                      <TableCell className="text-center">
                        {invoice.confidence ? (
                          <span className={invoice.confidence > 90 ? "text-green-600" : invoice.confidence > 70 ? "text-yellow-600" : "text-red-600"}>
                            {invoice.confidence}%
                          </span>
                        ) : '---'}
                      </TableCell>
                      <TableCell className="text-left">{getStatusBadge(invoice.status)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
