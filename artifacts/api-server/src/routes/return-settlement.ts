import { randomUUID, createHash } from "node:crypto";
import { Router } from "express";
import { captureIssuer, saveIssuer } from "../lib/document-identity";
import { z } from "zod/v4";
import { db, pool, posSessionsTable, creditNotesTable } from "@workspace/db";
import { sql, eq, and } from "drizzle-orm";
import { returnActor, returnAuthorize, returnTemplates, returnCapabilities, authorizeReturnApproval, assertReturnSnapshot } from "../lib/return-access";
import { FinancialRequestError } from "../lib/financial-transaction";
import { postJournalEntry, ClosedPeriodError } from "../lib/journal-posting";
import { recordAudit } from "../lib/audit";
import { actOnApproval } from "../lib/workflow-engine";
import { createCreditNoteHandler, creditNoteLimit } from "./sales";
import { returnRequestGuard } from "../lib/return-access";
import { lockApprovalAuthority } from "../lib/approval-authority";
import { managedProfile, selectedResponsibility } from "../lib/responsibility-context";
import { scopedPayoutSource } from "../lib/scoped-pos-operations";

const router = Router();
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Row = Record<string, unknown>;
const fail = (message: string, status = 409): never => { throw new FinancialRequestError(message, status); };
const id = z.number().int().positive();
const amount = z.number().positive().max(999999999).refine(v => Number(v.toFixed(2)) === v, "المبلغ بدقة هللتين");
const cents = (v: unknown) => Math.round(Number(v) * 100);
const money = (v: number) => (v / 100).toFixed(2);
async function query(tx: Tx, statement: ReturnType<typeof sql>) { return (await tx.execute(statement)).rows as Row[]; }

const sourceJoins = `FROM customer_invoices i
 JOIN sales_orders so ON so.id=i.so_id AND so.company_id=i.company_id AND so.source='pos'
 JOIN pos_orders o ON so.notes='POS '||o.order_number AND o.company_id=i.company_id
 JOIN pos_sessions s ON s.id=o.session_id
 JOIN branches b ON b.id=s.branch_id AND b.company_id=i.company_id`;

// Cash totals use the actual tender rows, not a card selection or totalSales.
export async function sessionCash(tx: Tx, sessionId: number, companyId: number) {
  const rows = await query(tx, sql`SELECT s.id,s.session_number,s.branch_id,s.status,s.opening_cash,
    coalesce((SELECT sum(p.amount) FROM pos_order_payments p JOIN pos_orders o ON o.id=p.order_id
      WHERE o.session_id=s.id AND o.company_id=${companyId} AND o.status='paid' AND p.method='cash'),0) AS cash_in,
    coalesce((SELECT sum(r.amount) FROM return_payouts r WHERE r.session_id=s.id AND r.company_id=${companyId}
      AND r.method='cash' AND r.status='confirmed'),0) AS cash_refunds,
    coalesce((SELECT sum(e.amount) FROM pos_cash_expenses e WHERE e.session_id=s.id AND e.company_id=${companyId}),0) AS cash_expenses,
    c.counted,c.difference,c.status AS closing_status,c.created_by AS closing_created_by
    FROM pos_sessions s JOIN branches b ON b.id=s.branch_id
    LEFT JOIN pos_cash_closings c ON c.session_id=s.id AND c.company_id=${companyId}
    WHERE s.id=${sessionId} AND b.company_id=${companyId}`);
  const row = rows[0];
  if (!row) fail("الوردية غير متاحة", 404);
  const out = cents(row.cash_refunds) + cents(row.cash_expenses);
  return { ...row, id: Number(row.id), branch_id: Number(row.branch_id), opening: Number(row.opening_cash), cash_in: Number(row.cash_in), cash_out: Number(money(out)),
    expected: Number(money(cents(row.opening_cash) + cents(row.cash_in) - out)) };
}

router.get("/pos/returns/workspace", async (req, res) => {
  try {
    const companyId = req.session.companyId!, userId = req.session.userId!;
    const actor = await returnAuthorize(userId, companyId, "view");
    const managed = await managedProfile(userId, companyId);
    const responsibility = managed ? await selectedResponsibility(userId, companyId) : null;
    const warehouseIds = responsibility?.warehouseIds ?? null;
    const scoped = actor.branches;
    const branchRows = (await pool.query("SELECT id,name_ar FROM branches WHERE company_id=$1 ORDER BY id", [companyId])).rows
      .filter(b => !scoped || scoped.includes(b.id));
    const allowed = branchRows.map(b => b.id);
    const invoices = (await pool.query(`SELECT i.id,i.reference,i.customer_id,i.total,so.warehouse_id,s.branch_id,
      (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM customer_invoice_lines l WHERE l.invoice_id=i.id) AS lines,
      (SELECT jsonb_agg(jsonb_build_object('id',r.id,'amount',a.amount,'payment_method',r.payment_method,'reference',r.reference))
       FROM customer_receipt_allocations a JOIN customer_receipts r ON r.id=a.receipt_id WHERE a.invoice_id=i.id) AS receipts
      ${sourceJoins} WHERE i.company_id=$1 AND s.branch_id=ANY($2::int[])
      AND ($3::int[] IS NULL OR so.warehouse_id=ANY($3::int[]))
      ORDER BY i.id DESC LIMIT 100`, [companyId, allowed, warehouseIds])).rows;
    const notes = (await pool.query(`SELECT n.id,n.reference,n.status,n.total,n.invoice_id,n.reason,
      c.branch_id,b.name_ar AS branch_name,c.created_by,c.approval_id,c.proof_ref,c.disposition,c.settlement_method,
      coalesce(p.refunded,0) AS refunded,coalesce(p.reserved,0) AS reserved,
      CASE WHEN n.status='issued' THEN greatest(n.total-coalesce(p.refunded,0),0) ELSE 0 END AS due,
      CASE WHEN n.status='issued' THEN greatest(n.total-coalesce(p.refunded,0)-coalesce(p.reserved,0),0) ELSE 0 END AS remaining,
      (SELECT jsonb_agg(jsonb_build_object('id',r.id,'amount',a.amount,'payment_method',r.payment_method,'reference',r.reference))
        FROM customer_receipt_allocations a JOIN customer_receipts r ON r.id=a.receipt_id WHERE a.invoice_id=n.invoice_id) AS receipts
      FROM return_controls c JOIN credit_notes n ON n.id=c.note_id AND n.company_id=c.company_id
      JOIN branches b ON b.id=c.branch_id AND b.company_id=c.company_id
      LEFT JOIN LATERAL (SELECT sum(amount) FILTER(WHERE status IN ('confirmed','external_confirmed')) AS refunded,
        sum(amount) FILTER(WHERE status='requested') AS reserved FROM return_payouts WHERE note_id=n.id AND company_id=$1) p ON true
      WHERE c.company_id=$1 AND c.branch_id=ANY($2::int[])
      AND ($3::int[] IS NULL OR EXISTS(SELECT 1 FROM customer_invoices i JOIN sales_orders so ON so.id=i.so_id
        AND so.company_id=i.company_id WHERE i.id=n.invoice_id AND i.company_id=n.company_id AND so.warehouse_id=ANY($3::int[])))
      ORDER BY n.id DESC LIMIT 200`, [companyId, allowed, warehouseIds])).rows;
    const sessions = await db.transaction(async tx => {
      const ids = await query(tx, sql`SELECT s.id FROM pos_sessions s JOIN branches b ON b.id=s.branch_id
        WHERE b.company_id=${companyId} ORDER BY s.id DESC LIMIT 100`);
      const results = [];
      for (const row of ids) {
        const summary = await sessionCash(tx, Number(row.id), companyId);
        if (allowed.includes(Number(summary.branch_id))) results.push(summary);
      }
      return results;
    });
    const payouts = (await pool.query(`SELECT p.* FROM return_payouts p JOIN return_controls c ON c.note_id=p.note_id
      AND c.company_id=p.company_id WHERE p.company_id=$1 AND c.branch_id=ANY($2::int[])
      AND ($3::int[] IS NULL OR EXISTS(SELECT 1 FROM customer_invoices i JOIN sales_orders so ON so.id=i.so_id
        AND so.company_id=i.company_id WHERE i.id=p.invoice_id AND i.company_id=p.company_id AND so.warehouse_id=ANY($3::int[])))
      ORDER BY p.id DESC LIMIT 200`, [companyId, allowed, warehouseIds])).rows;
    const configure = actor.capabilities.includes("configure");
    const reports = actor.capabilities.includes("reports") ? (await pool.query(`SELECT c.branch_id,b.name_ar AS branch_name,
      count(*)::int AS notes_count,sum(n.total) FILTER(WHERE n.status='issued') AS total,
      coalesce(sum(p.paid),0) AS refunded,coalesce(sum(p.held),0) AS reserved,
      coalesce(sum(CASE WHEN n.status='issued' THEN greatest(n.total-coalesce(p.paid,0),0) ELSE 0 END),0) AS due
      FROM return_controls c JOIN credit_notes n ON n.id=c.note_id AND n.company_id=c.company_id
      JOIN branches b ON b.id=c.branch_id
      LEFT JOIN LATERAL (SELECT sum(amount) FILTER(WHERE status IN ('confirmed','external_confirmed')) AS paid,
        sum(amount) FILTER(WHERE status='requested') AS held FROM return_payouts WHERE note_id=n.id AND company_id=$1) p ON true
      WHERE c.company_id=$1 AND c.branch_id=ANY($2::int[]) GROUP BY c.branch_id,b.name_ar`, [companyId, allowed])).rows : [];
    const members = configure ? (await pool.query(`SELECT uc.user_id,u.name,uc.role FROM user_companies uc
      JOIN users u ON u.id=uc.user_id WHERE uc.company_id=$1`, [companyId])).rows : [];
    const access = configure ? (await pool.query("SELECT * FROM return_access WHERE company_id=$1", [companyId])).rows : [];
    const policies = (await pool.query("SELECT * FROM return_policies WHERE company_id=$1", [companyId])).rows
      .filter(p => p.branch_id === 0 || allowed.includes(p.branch_id));
    const accounts = actor.capabilities.includes("expense") ? (await pool.query("SELECT id,name_ar FROM accounts WHERE type='expense' AND NOT is_group AND is_active")).rows : [];
    res.json({ notes, invoices, sessions, payouts, accounts, reports, branches: branchRows, capabilities: actor.capabilities,
      templates: configure ? returnTemplates : {}, members, policies, access });
  } catch (error) { sendError(req, res, error); }
});

async function payout(tx: Tx, companyId: number, userId: number, input: unknown) {
  const b = z.object({ noteId: id, receiptId: id, sessionId: id, amount, method: z.enum(["cash", "card", "transfer", "stc"]),
    reference: z.string().min(3).max(200), delivered: z.boolean().default(false), idempotencyKey: z.string().min(8).max(200) }).parse(input);
  const [note] = await tx.select().from(creditNotesTable)
    .where(and(eq(creditNotesTable.id, b.noteId), eq(creditNotesTable.companyId, companyId))).for("update");
  if (!note) fail("المرتجع غير متاح", 404);
  const [control] = await query(tx, sql`SELECT * FROM return_controls WHERE note_id=${note.id} AND company_id=${companyId}`);
  if (!control) fail("يتطلب المستند توثيق مصدر الاستحقاق أولًا");
  await returnAuthorize(userId, companyId, "payout", Number(control.branch_id), tx);
  await scopedPayoutSource(tx, userId, companyId, note.id);
  const fingerprint = createHash("sha256").update(JSON.stringify({ ...b, userId })).digest("hex");
  const [previous] = await query(tx, sql`SELECT * FROM return_payouts WHERE company_id=${companyId} AND idempotency_key=${b.idempotencyKey}`);
  if (previous) {
    if (previous.fingerprint !== fingerprint) fail("استعمل مفتاح الطلب لبيانات مختلفة");
    return previous;
  }
  await scopedPayoutSource(tx, userId, companyId, note.id, b.amount);
  if (note.status !== "issued") fail("يلزم مرتجع معتمد غير ملغى أو مسوّى");
  await assertReturnSnapshot(tx, note.id);
  if (control.settlement_method !== b.method) fail("طريقة الصرف تختلف عن المعتمدة؛ يلزم طلب واعتماد جديد");
  if (note.currencyCode !== "SAR") fail("الصرف التشغيلي الأجنبي غير مفعل؛ لا يُنشأ قيد بتقدير ضمني");
  // Invoice lock serializes different credit notes against the same collection.
  const [invoice] = await query(tx, sql`SELECT * FROM customer_invoices WHERE id=${note.invoiceId!} AND company_id=${companyId} FOR UPDATE`);
  if (!invoice) fail("الفاتورة غير متاحة", 404);
  const [receipt] = await query(tx, sql`SELECT r.*,a.amount AS allocated FROM customer_receipts r
    JOIN customer_receipt_allocations a ON a.receipt_id=r.id AND a.invoice_id=${note.invoiceId!}
    WHERE r.id=${b.receiptId} AND r.customer_id=${note.customerId} FOR UPDATE OF r`);
  if (!receipt) fail("يجب استخدام قبض الفاتورة الأصلية نفسها", 400);
  if (receipt.payment_method !== b.method && !(b.method === "transfer" && receipt.payment_method === "bank")) fail("الرد لا يطابق وسيلة القبض الأصلية", 400);
  const [spent] = await query(tx, sql`SELECT
    coalesce(sum(amount) FILTER(WHERE note_id=${note.id}),0) AS note_used,
    coalesce(sum(amount) FILTER(WHERE receipt_id=${b.receiptId}),0) AS receipt_used
    FROM return_payouts WHERE company_id=${companyId} AND status<>'cancelled'
      AND (note_id=${note.id} OR receipt_id=${b.receiptId})`);
  if (cents(b.amount) > cents(note.total) - cents(spent.note_used) || cents(b.amount) > cents(receipt.allocated) - cents(spent.receipt_used)) {
    fail("المبلغ يتجاوز الاستحقاق أو المقبوض المتبقي؛ لا يمكن صرف الرصيد مرتين");
  }
  const [session] = await tx.select().from(posSessionsTable).where(eq(posSessionsTable.id, b.sessionId)).for("update");
  if (!session || session.status !== "open") fail("الوردية مغلقة أو بانتظار التسوية");
  await returnAuthorize(userId, companyId, "payout", session.branchId, tx);
  if (session.branchId !== Number(control.branch_id)) fail("الصرف يجب أن يكون من وردية الفرع الأصلي المسموح");
  if (b.method === "cash" && !b.delivered) fail("يلزم تأكيد تسليم النقد لصاحب الاستحقاق", 400);
  const cash = await sessionCash(tx, session.id, companyId);
  if (b.method === "cash" && cents(b.amount) > cents(cash.expected)) fail("النقد المتوقع في الصندوق لا يكفي");
  let journalId: number | null = null;
  const reference = `RFD-${randomUUID()}`;
  if (b.method === "cash") {
    const journal = await postJournalEntry(tx, { companyId, entryDate: new Date().toISOString().slice(0, 10),
      description: `رد نقدي ${reference} عن ${note.reference}`, reference, source: "payment", sourceRef: reference, createdBy: userId, status: "posted" },
    [{ systemKey: "ar", debit: b.amount }, { systemKey: "cash", credit: b.amount }]);
    journalId = journal.id;
  }
  const [created] = await query(tx, sql`INSERT INTO return_payouts(company_id,note_id,invoice_id,receipt_id,session_id,amount,method,status,
    reference,idempotency_key,fingerprint,created_by,confirmed_by,journal_id,confirmed_at)
    VALUES(${companyId},${note.id},${note.invoiceId!},${b.receiptId},${b.sessionId},${String(b.amount)},${b.method},
      ${b.method === "cash" ? "confirmed" : "requested"},${reference + " / " + b.reference},${b.idempotencyKey},${fingerprint},${userId},
      ${b.method === "cash" ? userId : null},${journalId},${b.method === "cash" ? new Date() : null}) RETURNING *`);
  await saveIssuer(tx,"refund",Number(created.id),await captureIssuer(tx,companyId));
  return created;
}

async function changePayout(tx: Tx, companyId: number, userId: number, input: unknown, cancel: boolean) {
  const b = z.object({ payoutId: id, reference: z.string().min(3).max(200).optional(), reason: z.string().min(3).max(200).optional() }).parse(input);
  // Use the same note->invoice->payout lock order as creation.
  const [lookup] = await query(tx, sql`SELECT note_id FROM return_payouts WHERE id=${b.payoutId} AND company_id=${companyId}`);
  if (!lookup) fail("طلب الصرف غير متاح", 404);
  const [note] = await tx.select().from(creditNotesTable).where(and(eq(creditNotesTable.id, Number(lookup.note_id)), eq(creditNotesTable.companyId, companyId))).for("update");
  const [control] = await query(tx, sql`SELECT branch_id FROM return_controls WHERE note_id=${Number(lookup.note_id)} AND company_id=${companyId}`);
  if (!control) fail("المرتجع غير متاح", 404);
  await returnAuthorize(userId, companyId, cancel ? "payout" : "external", Number(control.branch_id), tx);
  await scopedPayoutSource(tx, userId, companyId, Number(lookup.note_id), cancel ? 0 : undefined, !cancel);
  if (!note || note.status !== "issued") fail("المرتجع غير قابل للصرف");
  await assertReturnSnapshot(tx, note.id);
  const [p] = await query(tx, sql`SELECT * FROM return_payouts WHERE id=${b.payoutId} AND company_id=${companyId} FOR UPDATE`);
  if (p.status !== "requested") {
    if ((!cancel && p.status === "external_confirmed") || (cancel && p.status === "cancelled")) return p;
    fail("لا يمكن تغيير سند صرف مؤكد");
  }
  if (!cancel && !b.reference) fail("يلزم مرجع إثبات الرد الخارجي", 400);
  if (cancel && !b.reason) fail("يلزم سبب إلغاء طلب الرد", 400);
  await tx.select().from(posSessionsTable).where(eq(posSessionsTable.id, Number(p.session_id))).for("update");
  let journalId: number | null = null;
  if (!cancel) {
    const journal = await postJournalEntry(tx, { companyId, entryDate: new Date().toISOString().slice(0, 10),
      description: `توثيق رد خارجي ${p.reference}`, reference: `RFX-${p.id}`, source: "payment", sourceRef: `RFX-${p.id}`, createdBy: userId, status: "posted" },
    [{ systemKey: "ar", debit: Number(p.amount) }, { systemKey: "bank", credit: Number(p.amount) }]);
    journalId = journal.id;
  }
  const [updated] = await query(tx, sql`UPDATE return_payouts SET status=${cancel ? "cancelled" : "external_confirmed"},
    reference=reference || ${" / " + (b.reference ?? b.reason)},confirmed_by=${userId},confirmed_at=now(),journal_id=${journalId}
    WHERE id=${b.payoutId} AND company_id=${companyId} RETURNING *`);
  return updated;
}

async function closeShift(tx: Tx, companyId: number, userId: number, input: unknown, approve: boolean) {
  const b = z.object({ sessionId: id, counted: z.number().min(0).max(999999999).optional(), reason: z.string().max(500).default(""),
    unresolvedSalesCleared: z.boolean().optional() }).parse(input);
  const [session] = await tx.select().from(posSessionsTable).where(eq(posSessionsTable.id, b.sessionId)).for("update");
  if (!session) fail("الوردية غير متاحة", 404);
  await returnAuthorize(userId, companyId, approve ? "difference" : "close", session.branchId, tx);
  const [old] = await query(tx, sql`SELECT * FROM pos_cash_closings WHERE session_id=${session.id} AND company_id=${companyId}`);
  if (old?.status === "approved") {
    if (!approve && (b.counted == null || cents(b.counted) !== cents(old.counted) || (b.reason ?? null) !== (old.reason ?? null))) {
      fail("الإقفال مؤكد ببيانات مختلفة؛ لا يعدل العد أو السبب بإعادة الطلب");
    }
    return old;
  }
  const pending = await query(tx, sql`SELECT id FROM return_payouts WHERE session_id=${session.id} AND company_id=${companyId} AND status='requested' LIMIT 1`);
  if (pending.length) fail("يوجد طلب رد غير مكتمل؛ وثق نتيجته أو ألغ الطلب قبل الإقفال");
  const summary = await sessionCash(tx, session.id, companyId);
  if (approve) {
    if (!old || old.status !== "pending" || session.status !== "closing") fail("لا يوجد فرق ينتظر الاعتماد");
    if (Number(old.created_by) === userId) fail("اعتماد فرق الصندوق يجب أن يكون من شخص آخر", 403);
    if (cents(old.expected) !== cents(summary.expected)) fail("تغيرت حركة الصندوق؛ يلزم إعادة التسوية");
    const difference = cents(old.difference);
    const key = difference < 0 ? "cash_shortage" : "cash_surplus";
    await query(tx, sql`INSERT INTO accounts(code,name,name_ar,type,currency_code,system_key)
      VALUES(${`SYS-${key}`},${key},${difference < 0 ? "عجز الصندوق المعتمد" : "زيادة الصندوق المعتمدة"},
        ${difference < 0 ? "expense" : "revenue"},'SAR',${key}) ON CONFLICT(system_key) DO NOTHING`);
    await postJournalEntry(tx, { companyId, entryDate: new Date().toISOString().slice(0, 10), description: `فرق وردية ${session.sessionNumber}: ${old.reason}`,
      reference: `SHIFT-VAR-${session.id}`, source: "system", sourceRef: `SHIFT-VAR-${session.id}`, createdBy: userId, status: "posted" },
    difference < 0
      ? [{ systemKey: key, debit: -difference / 100 }, { systemKey: "cash", credit: -difference / 100 }]
      : [{ systemKey: "cash", debit: difference / 100 }, { systemKey: key, credit: difference / 100 }]);
    await query(tx, sql`UPDATE pos_cash_closings SET status='approved',approved_by=${userId},approved_at=now()
      WHERE session_id=${session.id} AND company_id=${companyId}`);
    await tx.update(posSessionsTable).set({ status: "closed", closedAt: new Date() }).where(eq(posSessionsTable.id, session.id));
    return { ...old, status: "approved", approved_by: userId };
  }
  if (old || session.status !== "open") fail("الوردية مغلقة أو قيد اعتماد فرق");
  if (!b.unresolvedSalesCleared || b.counted == null) fail("يلزم النقد المعدود وتأكيد مراجعة نتائج البيع غير المحسومة", 400);
  const counted = b.counted!;
  if (Number(counted.toFixed(2)) !== counted) fail("النقد المعدود بدقة هللتين", 400);
  const difference = cents(b.counted) - cents(summary.expected);
  if (difference !== 0 && b.reason.trim().length < 3) fail("يلزم سبب فرق الصندوق", 400);
  const status = difference === 0 ? "approved" : "pending";
  const [closing] = await query(tx, sql`INSERT INTO pos_cash_closings(session_id,company_id,expected,counted,difference,reason,status,created_by,approved_by,approved_at)
    VALUES(${session.id},${companyId},${String(summary.expected)},${String(b.counted)},${money(difference)},${b.reason},${status},${userId},
      ${difference === 0 ? userId : null},${difference === 0 ? new Date() : null}) RETURNING *`);
  await saveIssuer(tx,"closing",session.id,await captureIssuer(tx,companyId));
  await tx.update(posSessionsTable).set({ status: difference === 0 ? "closed" : "closing", closedAt: difference === 0 ? new Date() : null }).where(eq(posSessionsTable.id, session.id));
  return closing;
}

async function cashExpense(tx: Tx, companyId: number, userId: number, input: unknown) {
  const b = z.object({ sessionId: id, accountId: id, amount, reference: z.string().min(3).max(200),
    delivered: z.literal(true), idempotencyKey: z.string().min(8).max(200) }).parse(input);
  const [session] = await tx.select().from(posSessionsTable).where(eq(posSessionsTable.id, b.sessionId)).for("update");
  if (!session) fail("الوردية غير متاحة", 404);
  await returnAuthorize(userId, companyId, "expense", session.branchId, tx);
  const fingerprint = createHash("sha256").update(JSON.stringify({ ...b, userId })).digest("hex");
  const [old] = await query(tx, sql`SELECT * FROM pos_cash_expenses WHERE company_id=${companyId} AND idempotency_key=${b.idempotencyKey}`);
  if (old) { if (old.fingerprint !== fingerprint) fail("مفتاح الطلب لبيانات مختلفة"); return old; }
  if (session.status !== "open") fail("الوردية ليست مفتوحة");
  const [account] = await query(tx, sql`SELECT id FROM accounts WHERE id=${b.accountId} AND type='expense' AND NOT is_group AND is_active FOR SHARE`);
  if (!account) fail("يلزم حساب مصروف فعال", 400);
  if (cents((await sessionCash(tx, session.id, companyId)).expected) < cents(b.amount)) fail("النقد المتوقع لا يكفي");
  const reference = `CASH-EXP-${randomUUID()}`;
  const journal = await postJournalEntry(tx, { companyId, entryDate: new Date().toISOString().slice(0, 10), description: b.reference,
    reference, source: "payment", sourceRef: reference, createdBy: userId, status: "posted" },
  [{ accountId: b.accountId, debit: b.amount }, { systemKey: "cash", credit: b.amount }]);
  const [created] = await query(tx, sql`INSERT INTO pos_cash_expenses(company_id,session_id,amount,reference,idempotency_key,fingerprint,journal_id,created_by)
    VALUES(${companyId},${session.id},${String(b.amount)},${b.reference},${b.idempotencyKey},${fingerprint},${journal.id},${userId}) RETURNING *`);
  return created;
}

router.post("/pos/returns/actions", async (req, res): Promise<void> => {
  try {
    const b = z.object({ action: z.enum(["request", "approve", "payout", "confirm_external", "cancel_payout", "close", "approve_close", "expense", "export", "configure_access", "configure_policy"]),
      payload: z.record(z.string(), z.unknown()) }).parse(req.body);
    const companyId = req.session.companyId!, userId = req.session.userId!;
    if (b.action === "export") {
      const actor = await returnAuthorize(userId, companyId, "export");
      const records = (await pool.query(`SELECT n.reference,n.status,c.branch_id,n.total,c.disposition,c.settlement_method
        FROM return_controls c JOIN credit_notes n ON n.id=c.note_id AND n.company_id=c.company_id
        WHERE c.company_id=$1 AND ($2::int[] IS NULL OR c.branch_id=ANY($2::int[]))
        ORDER BY n.id DESC LIMIT 10000`, [companyId, actor.branches])).rows;
      const cells = (value: unknown) => `"${String(value ?? "").replace(/^[=+@\\-]/, "'$&").replaceAll('"', '""')}"`;
      const headers = ["reference", "status", "branch_id", "total", "disposition", "settlement_method"];
      const csv = [headers.map(cells).join(","), ...records.map(row => headers.map(h => cells(row[h])).join(","))].join("\r\n");
      res.json({ csv, limitedTo: 10000, rows: records.length }); return;
    }
    if (b.action === "request") {
      const key = typeof b.payload.idempotencyKey === "string" ? b.payload.idempotencyKey : undefined;
      if (key) req.headers["idempotency-key"] = key;
      req.body = { ...b.payload, operationalReturn: true };
      void returnRequestGuard(req, res, () => { void creditNoteLimit(req, res, () => { void createCreditNoteHandler(req, res, () => {}); }); });
      return;
    }
    if (b.action === "approve") {
      const input = z.object({ noteId: id, comment: z.string().min(3).max(500) }).parse(b.payload);
      await authorizeReturnApproval(req, input.noteId);
      const control = await pool.query("SELECT approval_id FROM return_controls WHERE note_id=$1 AND company_id=$2", [input.noteId, companyId]);
      if (!control.rows[0]?.approval_id) fail("لا يوجد طلب اعتماد لهذا المستند");
      let result;
      try { result = await actOnApproval(control.rows[0].approval_id, userId, null, "approve", companyId, input.comment); }
      catch (error) {
        if (error instanceof Error && /لا يمكنك اعتماد|ليست لديك صلاحية/.test(error.message)) throw new FinancialRequestError(error.message, 403);
        if (error instanceof Error && /لم يعد مفتوح|لا يوجد/.test(error.message)) throw new FinancialRequestError(error.message, 409);
        throw error;
      }
      res.json(result); return;
    }
    if (b.action === "configure_access") {
      await returnAuthorize(userId, companyId, "configure");
      const data = z.object({ userId: id, template: z.enum(["cashier", "branch_manager", "branch_accountant", "finance_manager", "auditor"]),
        capabilities: z.array(z.string()).refine(v => v.every(c => returnCapabilities.includes(c))),
        branches: z.array(id).min(1) }).parse(b.payload);
      if (data.userId === userId) fail("لا يمكنك تعديل صلاحياتك بنفسك", 403);
      const member = await pool.query("SELECT user_id,role FROM user_companies WHERE user_id=$1 AND company_id=$2", [data.userId, companyId]);
      const branches = await pool.query("SELECT id FROM branches WHERE company_id=$1 AND id=ANY($2::int[])", [companyId, [...new Set(data.branches)]]);
      if (!member.rowCount || branches.rowCount !== new Set(data.branches).size) fail("عضوية أو فروع غير متاحة", 403);
      if (member.rows[0].role === "owner") fail("صلاحيات المالك لا تخفّض بقالب فرع؛ استخدم إدارة الملكية", 403);
      await pool.query(`INSERT INTO return_access(company_id,user_id,template,capabilities,branches,updated_by)
        VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6) ON CONFLICT(company_id,user_id)
        DO UPDATE SET template=EXCLUDED.template,capabilities=EXCLUDED.capabilities,branches=EXCLUDED.branches,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [companyId, data.userId, data.template, JSON.stringify(data.capabilities), JSON.stringify(data.branches), userId]);
      await recordAudit(req, { action: "update", entity: "return_access", details: JSON.stringify(data) });
      res.json({ ok: true }); return;
    }
    if (b.action === "configure_policy") {
      await returnAuthorize(userId, companyId, "configure");
      const data = z.object({ branchId: z.number().int().min(0), approvalAbove: z.number().nonnegative().max(999999999)
        .refine(v => Math.round(v * 100) / 100 === v).nullable(), allowResale: z.boolean() }).parse(b.payload);
      if (data.branchId) await returnAuthorize(userId, companyId, "configure", data.branchId);
      await pool.query(`INSERT INTO return_policies(company_id,branch_id,approval_above,allow_resale) VALUES($1,$2,$3,$4)
        ON CONFLICT(company_id,branch_id) DO UPDATE SET approval_above=EXCLUDED.approval_above,allow_resale=EXCLUDED.allow_resale`,
      [companyId, data.branchId, data.approvalAbove, data.allowResale]);
      await recordAudit(req, { action: "update", entity: "return_policy", details: JSON.stringify(data) });
      res.json({ ok: true }); return;
    }
    const result = await db.transaction(async tx => {
      await lockApprovalAuthority(tx);
      if (b.action === "payout") return payout(tx, companyId, userId, b.payload);
      if (b.action === "expense") return cashExpense(tx, companyId, userId, b.payload);
      if (b.action === "confirm_external" || b.action === "cancel_payout") return changePayout(tx, companyId, userId, b.payload, b.action === "cancel_payout");
      return closeShift(tx, companyId, userId, b.payload, b.action === "approve_close");
    });
    res.json(result);
  } catch (error) { sendError(req, res, error); }
});
function sendError(req: Parameters<typeof createCreditNoteHandler>[0], res: Parameters<typeof createCreditNoteHandler>[1], error: unknown) {
  const ref = String(req.id ?? randomUUID());
  const cause = error instanceof Error && error.cause && typeof error.cause === "object" ? error.cause as Row : {};
  req.log.warn({ diagnosticRef: ref, errorName: error instanceof Error ? error.name : "unknown",
    code: typeof cause.code === "string" ? cause.code : undefined,
    constraint: typeof cause.constraint === "string" ? cause.constraint : undefined,
    userId: req.session.userId, companyId: req.session.companyId }, "return settlement rejected");
  if (error instanceof FinancialRequestError) res.status(error.status).json({ error: error.message, diagnosticRef: ref });
  else if (error instanceof ClosedPeriodError) res.status(403).json({ error: error.message, diagnosticRef: ref });
  else if (error instanceof z.ZodError) res.status(400).json({ error: "راجع الحقول والمبالغ المطلوبة", diagnosticRef: ref });
  else if (error instanceof Error && "status" in error && typeof error.status === "number" && error.status >= 400 && error.status < 500) res.status(error.status).json({ error: error.message, diagnosticRef: ref });
  else res.status(500).json({ error: "تعذر تأكيد العملية؛ أعد الطلب نفسه برقم المرجع", diagnosticRef: ref });
}
export default router;
