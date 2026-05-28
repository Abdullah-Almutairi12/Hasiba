import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  customersTable,
  suppliersTable,
  employeesTable,
  invoicesTable,
  purchaseOrdersTable,
  purchaseOrderLinesTable,
  quotationsTable,
  payslipsTable,
  payrollLinesTable,
  payrollRunsTable,
  leaveRequestsTable,
  leaveTypesTable,
  leaveBalancesTable,
  attendancePunchesTable,
  supportTicketsTable,
} from "@workspace/db";
import { requirePortalSession } from "../middlewares/require-portal-session";

const router = Router();

// =========================================================================
// Customer portal
// =========================================================================
router.get(
  "/portal/customer/overview",
  requirePortalSession(["customer"]),
  async (req, res) => {
    try {
      const { principalId } = req.portal!;
      const [cust] = await db
        .select()
        .from(customersTable)
        .where(eq(customersTable.id, principalId))
        .limit(1);
      if (!cust) return res.status(404).json({ error: "العميل غير موجود" });

      const quotes = await db
        .select({
          id: quotationsTable.id,
          reference: quotationsTable.reference,
          status: quotationsTable.status,
          quoteDate: quotationsTable.quoteDate,
          validUntil: quotationsTable.validUntil,
          total: quotationsTable.total,
        })
        .from(quotationsTable)
        .where(eq(quotationsTable.customerId, principalId))
        .orderBy(desc(quotationsTable.createdAt))
        .limit(50);

      // Statement of account from POS orders / customer totals.
      return res.json({
        customer: {
          id: cust.id,
          name: cust.name,
          email: cust.email,
          phone: cust.phone,
          totalSpent: cust.totalSpent,
          totalOrders: cust.totalOrders,
          creditLimit: cust.creditLimit,
        },
        quotations: quotes.map((q) => ({ ...q, total: Number(q.total) })),
      });
    } catch (err) {
      req.log.error({ err }, "portal customer overview failed");
      return res.status(500).json({ error: "حدث خطأ في الخادم" });
    }
  },
);

router.post(
  "/portal/customer/quotations/:id/accept",
  requirePortalSession(["customer"]),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { principalId } = req.portal!;
      const [q] = await db
        .select()
        .from(quotationsTable)
        .where(and(eq(quotationsTable.id, id), eq(quotationsTable.customerId, principalId)))
        .limit(1);
      if (!q) return res.status(404).json({ error: "العرض غير موجود" });
      if (q.status === "accepted") return res.json({ ok: true, status: "accepted" });
      if (q.status === "rejected" || q.status === "expired") {
        return res.status(409).json({ error: "لا يمكن قبول هذا العرض" });
      }
      await db
        .update(quotationsTable)
        .set({ status: "accepted", acceptedAt: new Date() })
        .where(eq(quotationsTable.id, id));
      return res.json({ ok: true, status: "accepted" });
    } catch (err) {
      req.log.error({ err }, "portal accept quote failed");
      return res.status(500).json({ error: "حدث خطأ في الخادم" });
    }
  },
);

const RejectBody = z.object({ reason: z.string().max(500).optional() });

router.post(
  "/portal/customer/quotations/:id/reject",
  requirePortalSession(["customer"]),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { principalId } = req.portal!;
      const parsed = RejectBody.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });
      const [q] = await db
        .select()
        .from(quotationsTable)
        .where(and(eq(quotationsTable.id, id), eq(quotationsTable.customerId, principalId)))
        .limit(1);
      if (!q) return res.status(404).json({ error: "العرض غير موجود" });
      await db
        .update(quotationsTable)
        .set({
          status: "rejected",
          rejectedAt: new Date(),
          rejectionReason: parsed.data.reason ?? null,
        })
        .where(eq(quotationsTable.id, id));
      return res.json({ ok: true, status: "rejected" });
    } catch (err) {
      req.log.error({ err }, "portal reject quote failed");
      return res.status(500).json({ error: "حدث خطأ في الخادم" });
    }
  },
);

const TicketBody = z.object({
  subject: z.string().min(2).max(200),
  message: z.string().min(2).max(4000),
  category: z.string().max(50).optional(),
});

router.post(
  "/portal/customer/tickets",
  requirePortalSession(["customer"]),
  async (req, res) => {
    try {
      const parsed = TicketBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });
      const { principalId, email } = req.portal!;
      const [cust] = await db
        .select({ name: customersTable.name })
        .from(customersTable)
        .where(eq(customersTable.id, principalId))
        .limit(1);
      const [t] = await db
        .insert(supportTicketsTable)
        .values({
          subject: parsed.data.subject,
          message: parsed.data.message,
          customerName: cust?.name ?? email,
          customerEmail: email,
          category: parsed.data.category ?? "portal",
          priority: "medium",
          status: "open",
        })
        .returning();
      return res.status(201).json(t);
    } catch (err) {
      req.log.error({ err }, "portal create ticket failed");
      return res.status(500).json({ error: "حدث خطأ في الخادم" });
    }
  },
);

// =========================================================================
// Supplier portal
// =========================================================================
router.get(
  "/portal/supplier/overview",
  requirePortalSession(["supplier"]),
  async (req, res) => {
    try {
      const { principalId } = req.portal!;
      const [sup] = await db
        .select()
        .from(suppliersTable)
        .where(eq(suppliersTable.id, principalId))
        .limit(1);
      if (!sup) return res.status(404).json({ error: "المورد غير موجود" });

      const pos = await db
        .select({
          id: purchaseOrdersTable.id,
          reference: purchaseOrdersTable.reference,
          status: purchaseOrdersTable.status,
          orderDate: purchaseOrdersTable.orderDate,
          expectedDate: purchaseOrdersTable.expectedDate,
          total: purchaseOrdersTable.total,
          currencyCode: purchaseOrdersTable.currencyCode,
        })
        .from(purchaseOrdersTable)
        .where(eq(purchaseOrdersTable.supplierId, principalId))
        .orderBy(desc(purchaseOrdersTable.createdAt))
        .limit(100);

      const invs = await db
        .select({
          id: invoicesTable.id,
          invoiceNumber: invoicesTable.invoiceNumber,
          amount: invoicesTable.amount,
          status: invoicesTable.status,
          invoiceDate: invoicesTable.invoiceDate,
          dueDate: invoicesTable.dueDate,
          poId: invoicesTable.poId,
        })
        .from(invoicesTable)
        .where(eq(invoicesTable.supplierId, principalId))
        .orderBy(desc(invoicesTable.createdAt))
        .limit(100);

      return res.json({
        supplier: {
          id: sup.id,
          name: sup.name,
          email: sup.email,
          phone: sup.phone,
          balance: sup.balance,
          paymentTermsDays: sup.paymentTermsDays,
        },
        purchaseOrders: pos.map((p) => ({ ...p, total: Number(p.total) })),
        invoices: invs.map((i) => ({ ...i, amount: Number(i.amount) })),
      });
    } catch (err) {
      req.log.error({ err }, "portal supplier overview failed");
      return res.status(500).json({ error: "حدث خطأ في الخادم" });
    }
  },
);

router.get(
  "/portal/supplier/purchase-orders/:id",
  requirePortalSession(["supplier"]),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { principalId } = req.portal!;
      const [po] = await db
        .select()
        .from(purchaseOrdersTable)
        .where(and(eq(purchaseOrdersTable.id, id), eq(purchaseOrdersTable.supplierId, principalId)))
        .limit(1);
      if (!po) return res.status(404).json({ error: "أمر الشراء غير موجود" });
      const lines = await db
        .select()
        .from(purchaseOrderLinesTable)
        .where(eq(purchaseOrderLinesTable.poId, id));
      return res.json({ po, lines });
    } catch (err) {
      req.log.error({ err }, "portal supplier PO detail failed");
      return res.status(500).json({ error: "حدث خطأ في الخادم" });
    }
  },
);

const SubmitInvoiceBody = z.object({
  invoiceNumber: z.string().min(1).max(80),
  amount: z.number().positive(),
  invoiceDate: z.string().optional(),
  poId: z.number().int().positive().optional(),
});

router.post(
  "/portal/supplier/invoices",
  requirePortalSession(["supplier"]),
  async (req, res) => {
    try {
      const parsed = SubmitInvoiceBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });
      const { principalId } = req.portal!;
      const [sup] = await db
        .select({ name: suppliersTable.name, companyId: suppliersTable.companyId })
        .from(suppliersTable)
        .where(eq(suppliersTable.id, principalId))
        .limit(1);
      if (!sup) return res.status(404).json({ error: "المورد غير موجود" });
      if (sup.companyId == null) {
        return res.status(409).json({ error: "حساب المورد غير مرتبط بشركة" });
      }

      // Ensure PO belongs to this supplier if provided.
      if (parsed.data.poId) {
        const [po] = await db
          .select({ id: purchaseOrdersTable.id })
          .from(purchaseOrdersTable)
          .where(
            and(
              eq(purchaseOrdersTable.id, parsed.data.poId),
              eq(purchaseOrdersTable.supplierId, principalId),
            ),
          )
          .limit(1);
        if (!po) return res.status(404).json({ error: "أمر الشراء غير موجود" });
      }

      // Portal submission: derive the tenant from the supplier record
      // itself — there is no operator session here. The supplier was
      // already looked up via `sup` above, so its companyId is the
      // authoritative tenant for the new invoice.
      const [inv] = await db
        .insert(invoicesTable)
        .values({
          companyId: sup.companyId,
          invoiceNumber: parsed.data.invoiceNumber,
          supplierId: principalId,
          supplierName: sup.name,
          amount: String(parsed.data.amount),
          status: "needs_review",
          invoiceDate: parsed.data.invoiceDate ? new Date(parsed.data.invoiceDate) : null,
          poId: parsed.data.poId ?? null,
        })
        .returning();
      return res.status(201).json(inv);
    } catch (err: unknown) {
      req.log.error({ err }, "portal supplier submit invoice failed");
      if ((err as { code?: string })?.code === "23505") {
        return res.status(409).json({ error: "رقم الفاتورة موجود مسبقاً" });
      }
      return res.status(500).json({ error: "حدث خطأ في الخادم" });
    }
  },
);

// =========================================================================
// Employee portal
// =========================================================================
router.get(
  "/portal/employee/overview",
  requirePortalSession(["employee"]),
  async (req, res) => {
    try {
      const { principalId } = req.portal!;
      const [emp] = await db
        .select()
        .from(employeesTable)
        .where(eq(employeesTable.id, principalId))
        .limit(1);
      if (!emp) return res.status(404).json({ error: "الموظف غير موجود" });

      const payslips = await db
        .select({
          id: payslipsTable.id,
          reference: payslipsTable.reference,
          createdAt: payslipsTable.createdAt,
          fileUrl: payslipsTable.fileUrl,
          runId: payslipsTable.runId,
          netPay: payrollLinesTable.netPay,
          runName: payrollRunsTable.id,
        })
        .from(payslipsTable)
        .leftJoin(payrollLinesTable, eq(payrollLinesTable.id, payslipsTable.lineId))
        .leftJoin(payrollRunsTable, eq(payrollRunsTable.id, payslipsTable.runId))
        .where(eq(payslipsTable.employeeId, principalId))
        .orderBy(desc(payslipsTable.createdAt))
        .limit(24);

      const leaves = await db
        .select({
          id: leaveRequestsTable.id,
          reference: leaveRequestsTable.reference,
          startDate: leaveRequestsTable.startDate,
          endDate: leaveRequestsTable.endDate,
          days: leaveRequestsTable.days,
          status: leaveRequestsTable.status,
          leaveTypeId: leaveRequestsTable.leaveTypeId,
          reason: leaveRequestsTable.reason,
        })
        .from(leaveRequestsTable)
        .where(eq(leaveRequestsTable.employeeId, principalId))
        .orderBy(desc(leaveRequestsTable.createdAt))
        .limit(50);

      const year = new Date().getFullYear();
      const balances = await db
        .select({
          leaveTypeId: leaveBalancesTable.leaveTypeId,
          entitlement: leaveBalancesTable.entitlement,
          used: leaveBalancesTable.used,
          pending: leaveBalancesTable.pending,
          typeName: leaveTypesTable.nameAr,
        })
        .from(leaveBalancesTable)
        .leftJoin(leaveTypesTable, eq(leaveTypesTable.id, leaveBalancesTable.leaveTypeId))
        .where(
          and(
            eq(leaveBalancesTable.employeeId, principalId),
            eq(leaveBalancesTable.year, year),
          ),
        );

      // Last 30 days of attendance punches.
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const attendance = await db
        .select({
          id: attendancePunchesTable.id,
          punchAt: attendancePunchesTable.punchAt,
          direction: attendancePunchesTable.direction,
        })
        .from(attendancePunchesTable)
        .where(
          and(
            eq(attendancePunchesTable.employeeId, principalId),
            sql`${attendancePunchesTable.punchAt} >= ${since.toISOString()}`,
          ),
        )
        .orderBy(desc(attendancePunchesTable.punchAt))
        .limit(100);

      return res.json({
        employee: {
          id: emp.id,
          name: emp.name,
          email: emp.email,
          phone: emp.phone,
          employeeNo: emp.employeeNo,
          status: emp.status,
          hireDate: emp.hireDate,
        },
        payslips,
        leaves,
        leaveBalances: balances,
        attendance,
      });
    } catch (err) {
      req.log.error({ err }, "portal employee overview failed");
      return res.status(500).json({ error: "حدث خطأ في الخادم" });
    }
  },
);

const LeaveBody = z.object({
  leaveTypeId: z.number().int().positive(),
  startDate: z.string(),
  endDate: z.string(),
  reason: z.string().max(500).optional(),
});

router.post(
  "/portal/employee/leaves",
  requirePortalSession(["employee"]),
  async (req, res) => {
    try {
      const parsed = LeaveBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });
      const { principalId } = req.portal!;
      const start = new Date(parsed.data.startDate);
      const end = new Date(parsed.data.endDate);
      const days = Math.max(
        1,
        Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1,
      );
      const reference = `LV-P-${Date.now()}`;
      const [emp] = await db
        .select({ companyId: employeesTable.companyId })
        .from(employeesTable)
        .where(eq(employeesTable.id, principalId))
        .limit(1);
      if (!emp) return res.status(404).json({ error: "الموظف غير موجود" });
      const [row] = await db
        .insert(leaveRequestsTable)
        .values({
          companyId: emp.companyId,
          reference,
          employeeId: principalId,
          leaveTypeId: parsed.data.leaveTypeId,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate,
          days: String(days),
          reason: parsed.data.reason ?? null,
          status: "pending",
        })
        .returning();
      return res.status(201).json(row);
    } catch (err) {
      req.log.error({ err }, "portal employee leave request failed");
      return res.status(500).json({ error: "حدث خطأ في الخادم" });
    }
  },
);

const UpdateProfileBody = z.object({
  phone: z.string().max(40).optional(),
  address: z.string().max(500).optional(),
  emergencyContactName: z.string().max(120).optional(),
  emergencyContactPhone: z.string().max(40).optional(),
});

router.patch(
  "/portal/employee/profile",
  requirePortalSession(["employee"]),
  async (req, res) => {
    try {
      const parsed = UpdateProfileBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "بيانات غير صحيحة" });
      const { principalId } = req.portal!;
      await db
        .update(employeesTable)
        .set(parsed.data)
        .where(eq(employeesTable.id, principalId));
      return res.json({ ok: true });
    } catch (err) {
      req.log.error({ err }, "portal employee profile update failed");
      return res.status(500).json({ error: "حدث خطأ في الخادم" });
    }
  },
);

export default router;
