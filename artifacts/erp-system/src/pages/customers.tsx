import React, { useState } from "react";
import { Money } from "@/components/riyal";
import {
  useListCustomers,
  useCreateCustomer,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Plus, UserCircle, Users } from "lucide-react";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";

export default function Customers() {
  const [search, setSearch] = useState("");
  const { data: customers, isLoading } = useListCustomers({ search: search || undefined });

  return (
    <div className="space-y-6 pb-8 max-w-7xl mx-auto">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">العملاء</h1>
          <p className="text-muted-foreground">إدارة بيانات العملاء وتتبع سجلات الشراء</p>
        </div>
        <Button className="gap-2">
          <Plus className="size-4" />
          إضافة عميل
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
          <div className="flex gap-4 flex-1 max-w-md">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="ابحث عن عميل بالاسم أو الهاتف..."
                className="pl-4 pr-10"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>العميل</TableHead>
                <TableHead>رقم الهاتف</TableHead>
                <TableHead>البريد الإلكتروني</TableHead>
                <TableHead className="text-center">إجمالي الطلبات</TableHead>
                <TableHead className="text-left">إجمالي الإنفاق</TableHead>
                <TableHead className="text-left">تاريخ الانضمام</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell className="text-center"><Skeleton className="h-5 w-12 mx-auto" /></TableCell>
                    <TableCell className="text-left"><Skeleton className="h-5 w-24 ml-auto" /></TableCell>
                    <TableCell className="text-left"><Skeleton className="h-5 w-24 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : customers?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center">
                      <Users className="size-8 mb-2 opacity-20" />
                      لا يوجد عملاء مطابقين للبحث
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                customers?.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell className="font-medium flex items-center gap-3">
                      <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                        <UserCircle className="size-5" />
                      </div>
                      {customer.name}
                    </TableCell>
                    <TableCell dir="ltr" className="text-right text-muted-foreground">{customer.phone || '---'}</TableCell>
                    <TableCell className="text-muted-foreground">{customer.email || '---'}</TableCell>
                    <TableCell className="text-center font-bold">{customer.totalOrders}</TableCell>
                    <TableCell className="text-left font-bold text-primary">
                      <Money value={customer.totalSpent} />
                    </TableCell>
                    <TableCell className="text-left text-sm text-muted-foreground">
                      {format(new Date(customer.createdAt), 'dd MMM yyyy', { locale: arSA })}
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
