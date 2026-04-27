import React, { useState } from "react";
import {
  useGetAccountingSummary,
  useListJournalEntries,
  useGetZatcaStatus,
  useCreateJournalEntry,
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
import { format } from "date-fns";
import { arSA } from "date-fns/locale";
import { 
  Calculator, 
  ArrowUpRight, 
  ArrowDownRight, 
  CheckCircle2, 
  XCircle, 
  Plus,
  RefreshCcw,
  ShieldCheck
} from "lucide-react";

export default function Accounting() {
  const { data: summary, isLoading: isLoadingSummary } = useGetAccountingSummary();
  const { data: entries, isLoading: isLoadingEntries } = useListJournalEntries();
  const { data: zatca, isLoading: isLoadingZatca } = useGetZatcaStatus();

  return (
    <div className="space-y-6 pb-8 max-w-7xl mx-auto">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">المحاسبة والامتثال</h1>
          <p className="text-muted-foreground">إدارة التدفق النقدي، القيود المحاسبية، وحالة الامتثال مع هيئة الزكاة</p>
        </div>
        <Button className="gap-2">
          <Plus className="size-4" />
          قيد يومية جديد
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="md:col-span-3">
          <CardContent className="p-0">
            <div className="grid grid-cols-3 divide-x divide-x-reverse">
              <div className="p-6">
                <p className="text-sm font-medium text-muted-foreground mb-2">صافي التدفق النقدي</p>
                {isLoadingSummary ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div>
                    <h3 className="text-2xl font-bold">
                      <Money value={summary?.netCashFlow} />
                    </h3>
                    <p className={`text-sm mt-1 flex items-center gap-1 ${summary?.cashFlowChange && summary.cashFlowChange > 0 ? "text-green-600" : "text-red-600"}`}>
                      {summary?.cashFlowChange && summary.cashFlowChange > 0 ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                      {Math.abs(summary?.cashFlowChange || 0)}% هذا الشهر
                    </p>
                  </div>
                )}
              </div>
              <div className="p-6">
                <p className="text-sm font-medium text-muted-foreground mb-2">الذمم المدينة (المستحقات)</p>
                {isLoadingSummary ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div>
                    <h3 className="text-2xl font-bold text-blue-600">
                      <Money value={summary?.receivables} />
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">من {summary?.receivablesCount || 0} عملاء</p>
                  </div>
                )}
              </div>
              <div className="p-6">
                <p className="text-sm font-medium text-muted-foreground mb-2">الذمم الدائنة (الالتزامات)</p>
                {isLoadingSummary ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <div>
                    <h3 className="text-2xl font-bold text-orange-600">
                      <Money value={summary?.payables} />
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">متوسط الدفع: {summary?.avgPaymentDays || 0} يوم</p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-50 dark:bg-slate-900/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" />
              حالة ZATCA (فاتورة)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingZatca ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">الربط مع الهيئة</span>
                  {zatca?.connected ? (
                    <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-none"><CheckCircle2 className="size-3 mr-1" /> متصل</Badge>
                  ) : (
                    <Badge variant="destructive"><XCircle className="size-3 mr-1" /> غير متصل</Badge>
                  )}
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>صلاحية الشهادة</span>
                    <span>{zatca?.certExpiry || 0} يوم</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5">
                    <div 
                      className={`h-1.5 rounded-full ${zatca?.certExpiry && zatca.certExpiry > 30 ? 'bg-green-500' : 'bg-red-500'}`} 
                      style={{ width: `${Math.min(100, (zatca?.certExpiry || 0) / 3.65)}%` }} 
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <RefreshCcw className="size-3" /> آخر مزامنة: {zatca?.lastSync ? format(new Date(zatca.lastSync), 'PPp', { locale: arSA }) : '---'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>أحدث القيود اليومية</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>التاريخ</TableHead>
                <TableHead>البيان</TableHead>
                <TableHead>رقم المرجع</TableHead>
                <TableHead>الحساب المدين</TableHead>
                <TableHead>الحساب الدائن</TableHead>
                <TableHead className="text-left">المبلغ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingEntries ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell className="text-left"><Skeleton className="h-5 w-24 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : entries?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">لا توجد قيود مسجلة</TableCell>
                </TableRow>
              ) : (
                entries?.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {format(new Date(entry.date), 'dd/MM/yyyy')}
                    </TableCell>
                    <TableCell className="font-medium">
                      {entry.description}
                      {entry.isAutomatic && (
                        <Badge variant="outline" className="ml-2 text-[10px] h-4 px-1 leading-none">تلقائي</Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{entry.reference || '---'}</TableCell>
                    <TableCell>{entry.debitAccount}</TableCell>
                    <TableCell>{entry.creditAccount}</TableCell>
                    <TableCell className="text-left font-bold text-primary">
                      <Money value={entry.amount} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
