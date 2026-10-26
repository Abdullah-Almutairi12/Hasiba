import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { db, invoicesTable, suppliersTable, auditLogsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { FinancialRequestError, financialTransaction } from "./financial-transaction";
import { postJournalEntry, reverseJournalEntry, type DbOrTx } from "./journal-posting";
import { supplierInvoiceActor, assertSupplierInvoice, invoiceMatchingOrder, invoiceDecisionAuthority } from "./supplier-invoice-access";
import { lockApprovalAuthority } from "./approval-authority";
import { getCompanyId } from "./scoped-db";
import { approvalSourceFingerprint } from "./approval-source";
import {allocateInvoiceReceipts} from "./supplier-invoice-receipts";
import { submitForApproval, registerOnApprove, registerOnReject, assertDeferredInvoiceApproval } from "./workflow-engine";

export const supplierDraftInput=z.object({
  supplierId:z.number().int().positive(), invoiceNumber:z.string().trim().min(1).max(160),
  invoiceDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/), branchId:z.number().int().positive(),
  poId:z.number().int().positive().nullable().optional(),
  kind:z.enum(["goods","service","expense"]), expenseAccountId:z.number().int().positive().nullable().optional(),
  notes:z.string().max(4000).default(""),
  items:z.array(z.object({description:z.string().trim().min(1).max(500),
    quantity:z.number().finite().positive().max(1e6).refine(v=>v===Number(v.toFixed(6))),
    unitPrice:z.number().finite().min(0).max(1e7).refine(v=>v===Number(v.toFixed(6))),
    taxRate:z.union([z.literal(0),z.literal(15)]).default(0),
    poLineId:z.number().int().positive().nullable().optional(),
    productId:z.number().int().positive().nullable().optional(),unit:z.string().trim().min(1).max(60).default("piece"),
  }).strict()).min(1).max(500),
}).strict();
type Draft=z.infer<typeof supplierDraftInput>;
const fail=(message:string,status=409):never=>{throw new FinancialRequestError(message,status);};
export const normalizedSupplierNumber=(value:string)=>value.normalize("NFC").trim()
  .replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-0x660)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-0x6f0));

async function draftFacts(req:Request,tx:DbOrTx,body:Draft,action:string) {
  const actor=await supplierInvoiceActor(req,action,tx);
  const branch=await tx.execute(sql`SELECT id FROM branches WHERE id=${body.branchId}
    AND company_id=${actor.companyId} AND is_active`);
  if(!branch.rows.length || actor.branches && !actor.branches.includes(body.branchId)) fail("الفرع خارج نطاق الفاتورة",403);
  const [supplier]=await tx.select().from(suppliersTable).where(and(eq(suppliersTable.id,body.supplierId),eq(suppliersTable.companyId,actor.companyId)));
  if(!supplier) fail("مرجع المورد غير متاح",404);
  const linked=await tx.execute(sql`SELECT linked_company_id FROM suppliers WHERE id=${supplier.id}`);
  if(linked.rows[0]?.linked_company_id) fail("فاتورة شركة مقابلة تتطلب دورتها المعتمدة المنفصلة",403);
  if(body.poId) {
    const {order}=await invoiceMatchingOrder(req,body.poId,action,tx);
    if(order.currencyCode!=="SAR"||Number(order.exchangeRate)!==1)
      fail("هذه الدورة تدعم الريال دون تحويل عملة عميل؛ المصدر المختلف يحتاج دورة العملات المعتمدة");
    const w=await tx.execute(sql`SELECT branch_id FROM warehouses WHERE id=${order.warehouseId} AND company_id=${actor.companyId}`);
    if(order.supplierId!==supplier.id || w.rows[0]?.branch_id!==body.branchId) fail("المورد أو الفرع لا يطابق مصدر أمر الشراء");
    for(const item of body.items) {
      // Native PO billed_qty is numeric(18,4); do not round source quantities.
      const scale=4;
      if(item.quantity!==Number(item.quantity.toFixed(scale))) fail(`الكمية تتجاوز دقة مصدر الشراء (${scale} خانات)؛ لم تقرب صامتًا`,400);
      const rows=await tx.execute(sql`SELECT l.product_id,p.unit FROM purchase_order_lines l
        LEFT JOIN products p ON p.id=l.product_id AND p.company_id=${actor.companyId}
        WHERE l.id=${item.poLineId??null} AND l.po_id=${order.id}`);
      if(!rows.rows.length) fail("يلزم ربط كل بند بسطر من أمر الشراء");
      if(item.productId!=null && item.productId!==rows.rows[0].product_id) fail("الصنف لا يطابق بند المصدر");
      if(item.unit!==(rows.rows[0].unit??"piece")) fail("الوحدة لا تطابق المصدر؛ يلزم تحويل موثق قبل الفوترة");
      item.productId=rows.rows[0].product_id as number|null;
      if(body.kind!=="goods" && item.productId!=null) fail("لا يجوز استعمال فاتورة خدمات لتجاوز استلام بضاعة");
    }
  } else if(body.kind==="goods" || body.items.some(i=>i.poLineId!=null || i.productId!=null)) {
    fail("فاتورة البضاعة تتطلب أمرًا واستلامًا؛ فاتورة الخدمة أو المصروف لا تنشئ مخزونًا");
  } else if(actor.grant?.warehouseIds.length) fail("الفاتورة بلا مستودع لا تحقق منحة مقيدة بمستودع",403);
  if(body.expenseAccountId!=null) {
    const account=await tx.execute(sql`SELECT id FROM accounts WHERE id=${body.expenseAccountId}
      AND type='expense' AND is_active AND NOT is_group FOR SHARE`);
    if(!account.rows.length) fail("حساب المصروف أو فرق السعر غير صالح في الشركة");
  } else if(body.kind!=="goods") fail("يلزم حساب مصروف معتمد لهذه الفاتورة");
  const date=new Date(`${body.invoiceDate}T00:00:00Z`);
  if(!Number.isFinite(date.valueOf()) || date.toISOString().slice(0,10)!==body.invoiceDate) fail("تاريخ الفاتورة غير صالح",400);
  const totals=await tx.execute(sql`WITH items AS (
    SELECT round(quantity*"unitPrice",2) AS net,round(round(quantity*"unitPrice",2)*"taxRate"/100,2) AS vat
    FROM jsonb_to_recordset(${JSON.stringify(body.items)}::jsonb) AS x(quantity numeric,"unitPrice" numeric,"taxRate" numeric))
    SELECT sum(net)::text AS net,sum(vat)::text AS vat,(sum(net)+sum(vat))::text AS total FROM items`);
  const amounts=totals.rows[0] as {net:string;vat:string;total:string};
  if(Number(amounts.total)<=0 || Number(amounts.total)>99999999.99) fail("إجمالي الفاتورة خارج الحدود المسموحة",400);
  if(actor.grant?.amountLimit!=null) {
    const limit=await tx.execute(sql`SELECT ${amounts.total}::numeric<=${actor.grant.amountLimit}::numeric AS allowed`);
    if(!limit.rows[0]?.allowed) fail("إجمالي الفاتورة المحسوب يتجاوز حد المسؤولية",403);
  }
  return {actor,supplier,amounts,date};
}

export async function saveSupplierDraft(req:Request,id?:number) {
  const body=supplierDraftInput.parse(req.body);
  return financialTransaction(req,async tx=>{
    await lockApprovalAuthority(tx);
    if(id) {
      await assertSupplierInvoice(req,id,"edit",tx);
      await tx.execute(sql`SELECT id FROM invoices WHERE id=${id} FOR UPDATE`);
      const {invoice}=await assertSupplierInvoice(req,id,"edit",tx);
      if(invoice.lifecycleVersion!==1 || !["draft","pending_approval","approved","rejected"].includes(invoice.status)) fail("الفاتورة المرحلة لا تعدل؛ استخدم العكس");
      await tx.execute(sql`INSERT INTO supplier_invoice_revisions(invoice_id,company_id,changed_by,facts)
        SELECT i.id,i.company_id,${req.session.userId},jsonb_build_object('header',to_jsonb(i),'lines',
          (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.position),'[]'::jsonb) FROM supplier_invoice_lines l WHERE l.invoice_id=i.id))
        FROM invoices i WHERE i.id=${id} AND i.company_id=${invoice.companyId}`);
      await tx.update(invoicesTable).set({status:"draft",reviewedBy:null,reviewAuthority:null,reviewedSource:null}).where(eq(invoicesTable.id,id));
    }
    const {actor,supplier,amounts,date}=await draftFacts(req,tx,body,id?"edit":"create");
    const key=normalizedSupplierNumber(body.invoiceNumber);
    // A draft has no issued financial number; retain the supplier's ORIGINAL
    // number separately, rather than overloading the old global internal key.
    const values={companyId:actor.companyId,supplierId:supplier.id,supplierName:supplier.name,
      supplierDocumentNumber:body.invoiceNumber,normalizedDocumentNumber:key,amount:amounts.total,
      netAmount:amounts.net,vatAmount:amounts.vat,invoiceDate:date,branchId:body.branchId,poId:body.poId??null,
      invoiceKind:body.kind,expenseAccountId:body.expenseAccountId??null,notes:body.notes,
      status:"draft",lifecycleVersion:1,lineEvidenceVersion:1,currencyCode:"SAR"};
    const invoice=id?(await tx.update(invoicesTable).set(values).where(eq(invoicesTable.id,id)).returning())[0]
      :(await tx.insert(invoicesTable).values({...values,invoiceNumber:`DRAFT-${randomUUID()}`,createdBy:actor.userId}).returning())[0];
    if(id) await tx.execute(sql`DELETE FROM supplier_invoice_lines WHERE invoice_id=${id} AND company_id=${actor.companyId}`);
    for(const [position,item] of body.items.entries()) {
      await tx.execute(sql`INSERT INTO supplier_invoice_lines
        (invoice_id,company_id,position,description,quantity,unit_price,source_total,net_amount,unit,product_id,po_line_id,tax_rate)
        VALUES(${invoice.id},${actor.companyId},${position},${item.description},${String(item.quantity)}::numeric,
          ${String(item.unitPrice)}::numeric,round(${String(item.quantity)}::numeric*${String(item.unitPrice)}::numeric,2),
          round(${String(item.quantity)}::numeric*${String(item.unitPrice)}::numeric,2),${item.unit},${item.productId??null},
          ${item.poLineId??null},${String(item.taxRate)}::numeric)`);
    }
    await audit(tx,req,invoice.id,id?"edit":"create");
    return {id:invoice.id,status:"draft",amount:amounts.total};
  });
}

async function audit(tx:DbOrTx,req:Request,id:number,action:string) {
  await tx.insert(auditLogsTable).values({companyId:getCompanyId(req),userId:req.session.userId!,
    userName:(req.session as {userName?:string}).userName??"مستخدم",action:`supplier.invoice.${action}`,entity:"invoice",
    details:JSON.stringify({invoiceId:id}),severity:"info",ipAddress:req.socket.remoteAddress??"unknown"});
}

async function lockedInvoice(req:Request,id:number,action:string,tx:DbOrTx) {
  await lockApprovalAuthority(tx);
  await assertSupplierInvoice(req,id,action,tx);
  await tx.execute(sql`SELECT id FROM invoices WHERE id=${id} FOR UPDATE`);
  const {invoice,actor}=await assertSupplierInvoice(req,id,action,tx);
  if(invoice.lifecycleVersion!==1) fail("الفاتورة القديمة تتبع مسارها التاريخي؛ لا يعاد بناء دليلها");
  if(invoice.poId) await tx.execute(sql`SELECT id FROM purchase_orders WHERE id=${invoice.poId} AND company_id=${invoice.companyId} FOR UPDATE`);
  await assertSupplierInvoice(req,id,action,tx);
  if(invoice.poId) await invoiceMatchingOrder(req,invoice.poId,action,tx);
  await supplierInvoiceActor(req,action,tx);
  return {invoice,actor};
}

async function currentMatch(tx:DbOrTx,invoice:typeof invoicesTable.$inferSelect) {
  const consistency=await tx.execute(sql`SELECT
    sum(round(quantity*unit_price,2))=${invoice.netAmount}::numeric
    AND sum(round(round(quantity*unit_price,2)*tax_rate/100,2))=${invoice.vatAmount}::numeric
    AND ${invoice.netAmount}::numeric+${invoice.vatAmount}::numeric=${invoice.amount}::numeric
    AND bool_and(quantity>0 AND unit_price>=0 AND tax_rate IN(0,15) AND net_amount=round(quantity*unit_price,2)) AS valid
    FROM supplier_invoice_lines WHERE invoice_id=${invoice.id} AND company_id=${invoice.companyId}`);
  if(!consistency.rows[0]?.valid) fail("مبالغ الفاتورة لا تطابق بنودها الأصلية؛ لم ينشأ قيد");
  const lines=await tx.execute(sql`SELECT e.*,l.quantity AS ordered,l.received_qty,l.billed_qty,l.unit_price AS ordered_price
    FROM supplier_invoice_lines e LEFT JOIN purchase_order_lines l ON l.id=e.po_line_id AND l.po_id=${invoice.poId}
    WHERE e.invoice_id=${invoice.id} AND e.company_id=${invoice.companyId} ORDER BY e.position`);
  if(!lines.rows.length) fail("لا توجد بنود أصلية");
  if(invoice.poId) {
    const orders=await tx.execute(sql`SELECT supplier_id,status FROM purchase_orders WHERE id=${invoice.poId} AND company_id=${invoice.companyId}`);
    if(orders.rows[0]?.supplier_id!==invoice.supplierId || !["confirmed","partially_received","fully_received"].includes(String(orders.rows[0]?.status)))
      fail("مصدر أمر الشراء تغير أو لم يعد صالحًا للفوترة");
    const tolerance=Number(process.env.PO_INVOICE_PRICE_TOLERANCE_PCT??"5");
    if(!Number.isFinite(tolerance) || tolerance<0 || tolerance>100) fail("سياسة التفاوت غير صالحة",503);
    const invalid=await tx.execute(sql`WITH wanted AS (
      SELECT po_line_id,sum(quantity) AS quantity,min(unit_price) AS lo,max(unit_price) AS hi
      FROM supplier_invoice_lines WHERE invoice_id=${invoice.id} AND company_id=${invoice.companyId} GROUP BY po_line_id)
      SELECT w.po_line_id FROM wanted w LEFT JOIN purchase_order_lines l ON l.id=w.po_line_id AND l.po_id=${invoice.poId}
      WHERE l.id IS NULL OR w.quantity>CASE WHEN l.product_id IS NULL THEN l.quantity ELSE l.received_qty END-l.billed_qty
        OR l.unit_price=0 AND (w.lo<>0 OR w.hi<>0)
        OR l.unit_price>0 AND (abs(w.lo-l.unit_price)*100>l.unit_price*${tolerance}::numeric
          OR abs(w.hi-l.unit_price)*100>l.unit_price*${tolerance}::numeric)`);
    if(invalid.rows.length) fail("توجد فروق كمية أو سعر غير مقبولة وفق السياسة؛ راجع الاستلام أو صحح المسودة ثم أعد المراجعة");
  }
  return lines.rows;
}

export async function processSupplierInvoice(req:Request,id:number,action:"review"|"submit"|"post"|"cancel"|"reverse") {
  // Recover a committed response with CURRENT read access. Execution authority
  // is rechecked only for a genuinely new effect, under the same fence/locks.
  await assertSupplierInvoice(req,id,"read");
  return financialTransaction(req,async tx=>{
    const {invoice,actor}=await lockedInvoice(req,id,action,tx);
    if(action==="cancel") {
      if(!["draft","pending_approval","approved","rejected"].includes(invoice.status)) fail("الفاتورة المرحلة تصحح بعكس موثق");
      await tx.update(invoicesTable).set({status:"cancelled"}).where(eq(invoicesTable.id,id));
      await tx.execute(sql`UPDATE approval_requests SET review_invalidated_at=clock_timestamp(),
        review_invalidated_reason='ألغيت الفاتورة؛ لا يجوز تنفيذ اعتمادها',
        status=CASE WHEN status='pending' THEN 'changes_requested' ELSE status END
        WHERE company_id=${invoice.companyId} AND doc_type='supplier_invoice' AND record_id=${id}
          AND review_invalidated_at IS NULL`);
    } else if(action==="review") {
      if(invoice.status!=="draft") fail("راجع مسودة حالية فقط");
      await currentMatch(tx,invoice);
      const authority=await invoiceDecisionAuthority(tx,invoice.companyId,actor.userId,id,"review");
      if(!authority) fail("صلاحية المراجع غير متاحة",403);
      await tx.update(invoicesTable).set({reviewedBy:actor.userId,reviewAuthority:authority}).where(eq(invoicesTable.id,id));
      const fingerprint=await approvalSourceFingerprint(invoice.companyId,"supplier_invoice",id,tx);
      await tx.update(invoicesTable).set({reviewedSource:fingerprint}).where(eq(invoicesTable.id,id));
    } else if(action==="submit") {
      if(invoice.status!=="draft" || !invoice.reviewedSource) fail("يلزم مراجعة المسودة الحالية أولًا");
      await reviewStillValid(tx,invoice);
      const result=await submitForApproval({companyId:invoice.companyId,docType:"supplier_invoice",recordId:id,
        recordRef:invoice.supplierDocumentNumber,amount:Number(invoice.amount),branchId:invoice.branchId,
        submittedByUserId:actor.userId},tx);
      await tx.update(invoicesTable).set({status:result.required&&!result.autoApproved?"pending_approval":"approved"}).where(eq(invoicesTable.id,id));
    } else if(action==="post") {
      if(invoice.status!=="approved") fail("يلزم اعتماد صالح أو إكمال المراجعة وفق سياسة لا تتطلب اعتمادًا");
      await reviewStillValid(tx,invoice);
      const approved=await assertDeferredInvoiceApproval(invoice.companyId,id,tx);
      if(!approved) {
        const fresh=await submitForApproval({companyId:invoice.companyId,docType:"supplier_invoice",recordId:id,
          recordRef:invoice.supplierDocumentNumber,amount:Number(invoice.amount),branchId:invoice.branchId,
          submittedByUserId:invoice.createdBy},tx);
        if(fresh.required&&!fresh.autoApproved) fail("تغيرت سياسة الاعتماد؛ أعد تقديم الفاتورة");
      }
      const lines=await currentMatch(tx,invoice);
      if(invoice.expenseAccountId!=null) {
        const valid=await tx.execute(sql`SELECT id FROM accounts WHERE id=${invoice.expenseAccountId}
          AND type='expense' AND is_active AND NOT is_group FOR SHARE`);
        if(!valid.rows.length)fail("حساب المصروف المعتمد لم يعد صالحًا؛ أعد إعداد المسودة ومراجعتها");
      }
      const company=await tx.execute(sql`SELECT vat_registration_status FROM companies WHERE id=${invoice.companyId}`);
      const recoverVat=["registered","voluntary"].includes(String(company.rows[0]?.vat_registration_status));
      const net=Number(invoice.netAmount),vat=Number(invoice.vatAmount);
      let clearing=net;
      if(invoice.poId && invoice.invoiceKind==="goods") {
        clearing=await allocateInvoiceReceipts(tx,invoice);
      }
      const journalLines:Array<{systemKey?:string;accountId?:number;debit?:number;credit?:number}>=[];
      if(invoice.invoiceKind==="goods") {
        if(clearing>0) journalLines.push({systemKey:"gr_ir",debit:clearing});
      } else journalLines.push({accountId:invoice.expenseAccountId!,debit:net+(recoverVat?0:vat)});
      const difference=Math.round((net-clearing+(recoverVat?0:vat))*100)/100;
      if(invoice.invoiceKind==="goods" && difference!==0) {
        if(!invoice.expenseAccountId) fail("الخدمة أو فرق السعر أو الضريبة غير القابلة للاسترداد تحتاج حساب مصروف صريحًا ضمن الحقائق المعتمدة");
        journalLines.push({accountId:invoice.expenseAccountId!,...(difference>0?{debit:difference}:{credit:-difference})});
      }
      if(recoverVat&&vat>0) journalLines.push({systemKey:"vat_input",debit:vat});
      journalLines.push({systemKey:"ap",credit:Number(invoice.amount)});
      const journal=await postJournalEntry(tx,{companyId:invoice.companyId,entryDate:invoice.invoiceDate??new Date(),
        description:`فاتورة مورد ${invoice.supplierDocumentNumber}`,reference:`SINV-${id}`,source:"supplier_invoice",
        sourceRef:`SINV-${id}`,createdBy:actor.userId},journalLines);
      for(const l of lines) if(l.po_line_id) await tx.execute(sql`UPDATE purchase_order_lines
        SET billed_qty=billed_qty+${l.quantity}::numeric WHERE id=${l.po_line_id} AND po_id=${invoice.poId}`);
      await tx.update(suppliersTable).set({balance:sql`${suppliersTable.balance}+${invoice.amount}::numeric`})
        .where(and(eq(suppliersTable.id,invoice.supplierId!),eq(suppliersTable.companyId,invoice.companyId)));
      await tx.update(invoicesTable).set({status:"done",isLocked:true,lockedAt:new Date(),journalEntryId:journal.id,
        billedQuantitiesApplied:!!invoice.poId}).where(eq(invoicesTable.id,id));
    } else {
      const reason=z.object({reason:z.string().trim().min(1).max(1000)}).parse(req.body).reason;
      if(invoice.status!=="done"||!invoice.journalEntryId||invoice.reversedById||invoice.reversesId) fail("الفاتورة ليست قابلة لعكس جديد");
      const reversalJournal=await reverseJournalEntry(tx,invoice.journalEntryId!,actor.userId,invoice.companyId,reason);
      const [reverse]=await tx.insert(invoicesTable).values({companyId:invoice.companyId,
        invoiceNumber:`REV-${randomUUID()}`,supplierDocumentNumber:`REV-${invoice.supplierDocumentNumber}`,
        documentType:"reversal",supplierId:invoice.supplierId,supplierName:invoice.supplierName,
        amount:String(-Number(invoice.amount)),netAmount:String(-Number(invoice.netAmount)),vatAmount:String(-Number(invoice.vatAmount)),
        lifecycleVersion:1,currencyCode:invoice.currencyCode,createdBy:actor.userId,branchId:invoice.branchId,poId:invoice.poId,invoiceKind:invoice.invoiceKind,
        status:"done",isLocked:true,lockedAt:new Date(),invoiceDate:new Date(),reversesId:id,reversedReason:reason,
        journalEntryId:reversalJournal.id}).returning();
      const lines=await tx.execute(sql`SELECT * FROM supplier_invoice_lines WHERE invoice_id=${id} AND company_id=${invoice.companyId} ORDER BY position`);
      for(const line of lines.rows) {
        await tx.execute(sql`INSERT INTO supplier_invoice_lines(invoice_id,company_id,position,description,quantity,unit_price,
          source_total,net_amount,unit,product_id,po_line_id,tax_rate)
          VALUES(${reverse.id},${invoice.companyId},${line.position},${line.description},-${line.quantity}::numeric,
            ${line.unit_price}::numeric,-${line.source_total}::numeric,-${line.net_amount}::numeric,${line.unit},
            ${line.product_id},${line.po_line_id},${line.tax_rate}::numeric)`);
      }
      if(invoice.billedQuantitiesApplied) {
        const released=await tx.execute(sql`WITH qty AS(SELECT po_line_id,sum(quantity) AS quantity FROM supplier_invoice_lines
          WHERE invoice_id=${id} AND company_id=${invoice.companyId} GROUP BY po_line_id)
          UPDATE purchase_order_lines l SET billed_qty=l.billed_qty-q.quantity FROM qty q
          WHERE l.id=q.po_line_id AND l.po_id=${invoice.poId} AND l.billed_qty>=q.quantity RETURNING l.id`);
        if(released.rows.length!==new Set(lines.rows.map(l=>l.po_line_id)).size) fail("رصيد الفوترة لا يطابق دليل الفاتورة؛ يلزم تحقيق مستقل");
      }
      await tx.update(suppliersTable).set({balance:sql`${suppliersTable.balance}-${invoice.amount}::numeric`})
        .where(and(eq(suppliersTable.id,invoice.supplierId!),eq(suppliersTable.companyId,invoice.companyId)));
      await tx.update(invoicesTable).set({lineEvidenceVersion:1}).where(eq(invoicesTable.id,reverse.id));
      await tx.execute(sql`UPDATE supplier_invoice_receipt_allocations a SET reversed_at=clock_timestamp()
        FROM supplier_invoice_lines e WHERE e.id=a.invoice_line_id AND e.invoice_id=${id}
          AND a.company_id=${invoice.companyId} AND a.reversed_at IS NULL`);
      await tx.update(invoicesTable).set({status:"reversed",reversedById:reverse.id,reversedReason:reason,billedQuantitiesApplied:false}).where(eq(invoicesTable.id,id));
    }
    await audit(tx,req,id,action);
    const [saved]=await tx.select().from(invoicesTable).where(eq(invoicesTable.id,id));
    return {id,status:saved.status,amount:saved.amount,journalEntryId:saved.journalEntryId,reversedById:saved.reversedById};
  });
}

async function reviewStillValid(tx:DbOrTx,invoice:typeof invoicesTable.$inferSelect) {
  if(!invoice.reviewedBy || !invoice.reviewAuthority || !invoice.reviewedSource ||
    invoice.reviewAuthority!==await invoiceDecisionAuthority(tx,invoice.companyId,invoice.reviewedBy,invoice.id,"review") ||
    invoice.reviewedSource!==await approvalSourceFingerprint(invoice.companyId,"supplier_invoice",invoice.id,tx))
    fail("تغير المصدر أو سحبت أهلية المراجع؛ أعد المراجعة",403);
}
registerOnApprove("supplier_invoice",async(id,_request,context)=>{
  const saved=await context.connection.update(invoicesTable).set({status:"approved"})
    .where(and(eq(invoicesTable.id,id),eq(invoicesTable.companyId,context.companyId),
      eq(invoicesTable.lifecycleVersion,1),sql`${invoicesTable.status} IN ('draft','pending_approval')`,
      eq(invoicesTable.isLocked,false))).returning({id:invoicesTable.id});
  if(!saved.length)fail("تغيرت حالة الفاتورة؛ لا يطبق قرار قديم");
});
registerOnReject("supplier_invoice",async(id,_request,_reason,context)=>{
  await context.connection.update(invoicesTable).set({status:"rejected"})
    .where(and(eq(invoicesTable.id,id),eq(invoicesTable.companyId,context.companyId),
      eq(invoicesTable.lifecycleVersion,1),eq(invoicesTable.status,"pending_approval")));
});
