import type { RequestHandler } from "express";
import { db } from "@workspace/db";
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { getCompanyId } from "./scoped-db";
import type { DbOrTx } from "./journal-posting";

/**
 * Ownership follows every tenant-bearing edge, not just the header stamp.
 * Old endpoints could create mixed-company graphs; those must fail closed.
 * Identifiers below are fixed server-owned SQL, never request-supplied names.
 */
const definitions = {
  product: ["products", "x.company_id = $company"],
  warehouse: ["warehouses", "x.company_id = $company"],
  branch: ["branches", "x.company_id = $company"],
  supplier: ["suppliers", "x.company_id = $company"],
  bankAccount: ["bank_accounts", "x.company_id = $company"],
  lot: ["stock_lots", "x.product_id IN ($product)"],
  variant: ["product_variants", "x.product_id IN ($product)"],
  serial: ["stock_serials", "x.product_id IN ($product) AND (x.current_warehouse_id IS NULL OR x.current_warehouse_id IN ($warehouse))"],
  quant: ["stock_quants", "x.product_id IN ($product) AND x.warehouse_id IN ($warehouse) AND (x.lot_id IS NULL OR x.lot_id IN ($lot)) AND (x.variant_id IS NULL OR x.variant_id IN ($variant))"],
  move: ["stock_moves", "x.product_id IN ($product) AND (x.from_warehouse_id IS NULL OR x.from_warehouse_id IN ($warehouse)) AND (x.to_warehouse_id IS NULL OR x.to_warehouse_id IN ($warehouse)) AND (x.lot_id IS NULL OR x.lot_id IN ($lot)) AND (x.serial_id IS NULL OR x.serial_id IN ($serial)) AND (x.variant_id IS NULL OR x.variant_id IN ($variant))"],
  reorder: ["reorder_rules", "x.product_id IN ($product) AND x.warehouse_id IN ($warehouse)"],
  take: ["stock_takes", "x.warehouse_id IN ($warehouse) AND NOT EXISTS (SELECT 1 FROM stock_take_lines l WHERE l.stock_take_id = x.id AND (l.product_id NOT IN ($product) OR (l.lot_id IS NOT NULL AND l.lot_id NOT IN ($lot)) OR (l.variant_id IS NOT NULL AND l.variant_id NOT IN ($variant))))"],
  takeLine: ["stock_take_lines", "x.stock_take_id IN ($take) AND x.product_id IN ($product)"],
  workCenter: ["work_centers", "x.company_id = $company"],
  routing: ["routings", "x.company_id = $company AND NOT EXISTS (SELECT 1 FROM routing_operations o WHERE o.routing_id = x.id AND o.work_center_id NOT IN ($workCenter))"],
  operation: ["routing_operations", "x.routing_id IN ($routing) AND x.work_center_id IN ($workCenter)"],
  bom: ["boms", "x.company_id = $company AND x.product_id IN ($product) AND (x.routing_id IS NULL OR x.routing_id IN ($routing)) AND NOT EXISTS (SELECT 1 FROM bom_lines l WHERE l.bom_id = x.id AND l.component_id NOT IN ($product)) AND NOT EXISTS (SELECT 1 FROM bom_qc_templates q WHERE q.bom_id = x.id AND q.operation_id IS NOT NULL AND q.operation_id NOT IN ($operation))"],
  workOrder: ["work_orders", "x.company_id = $company AND x.product_id IN ($product) AND x.bom_id IN ($bom) AND x.warehouse_id IN ($warehouse) AND NOT EXISTS (SELECT 1 FROM work_orders parent WHERE parent.id = x.parent_work_order_id AND parent.company_id <> $company) AND NOT EXISTS (SELECT 1 FROM work_order_reservations r WHERE r.work_order_id = x.id AND (r.component_id NOT IN ($product) OR r.warehouse_id NOT IN ($warehouse))) AND NOT EXISTS (SELECT 1 FROM work_order_consumptions c WHERE c.work_order_id = x.id AND (c.component_id NOT IN ($product) OR (c.lot_id IS NOT NULL AND c.lot_id NOT IN ($lot)) OR (c.serial_id IS NOT NULL AND c.serial_id NOT IN ($serial)))) AND NOT EXISTS (SELECT 1 FROM work_order_productions p WHERE p.work_order_id = x.id AND ((p.lot_id IS NOT NULL AND p.lot_id NOT IN ($lot)) OR (p.serial_id IS NOT NULL AND p.serial_id NOT IN ($serial)))) AND NOT EXISTS (SELECT 1 FROM quality_checks q WHERE q.work_order_id = x.id AND q.operation_id IS NOT NULL AND q.operation_id NOT IN ($operation))"],
  reservation: ["work_order_reservations", "x.work_order_id IN ($workOrder)"],
  qualityCheck: ["quality_checks", "x.work_order_id IN ($workOrder) AND (x.operation_id IS NULL OR x.operation_id IN ($operation))"],
  scrap: ["scrap_records", "x.product_id IN ($product) AND x.from_warehouse_id IN ($warehouse) AND (x.to_warehouse_id IS NULL OR x.to_warehouse_id IN ($warehouse)) AND (x.work_order_id IS NULL OR x.work_order_id IN ($workOrder))"],
  requisition: ["purchase_requisitions", "x.company_id = $company AND (x.branch_id IS NULL OR x.branch_id IN ($branch)) AND (x.warehouse_id IS NULL OR x.warehouse_id IN ($warehouse)) AND NOT EXISTS (SELECT 1 FROM purchase_requisition_lines l WHERE l.requisition_id = x.id AND (l.company_id <> $company OR (l.product_id IS NOT NULL AND l.product_id NOT IN ($product))))"],
  rfq: ["rfqs", "x.company_id = $company AND (x.requisition_id IS NULL OR x.requisition_id IN ($requisition)) AND (x.awarded_supplier_id IS NULL OR x.awarded_supplier_id IN ($supplier)) AND NOT EXISTS (SELECT 1 FROM rfq_suppliers s WHERE s.rfq_id = x.id AND s.supplier_id NOT IN ($supplier)) AND NOT EXISTS (SELECT 1 FROM rfq_quote_lines l WHERE l.rfq_id = x.id AND (l.supplier_id NOT IN ($supplier) OR (l.product_id IS NOT NULL AND l.product_id NOT IN ($product))))"],
  agreement: ["blanket_agreements", "x.supplier_id IN ($supplier) AND NOT EXISTS (SELECT 1 FROM blanket_agreement_items l WHERE l.agreement_id = x.id AND l.product_id NOT IN ($product))"],
  purchaseOrder: ["purchase_orders", "x.company_id = $company AND x.supplier_id IN ($supplier) AND (x.warehouse_id IS NULL OR x.warehouse_id IN ($warehouse)) AND (x.requisition_id IS NULL OR x.requisition_id IN ($requisition)) AND (x.rfq_id IS NULL OR x.rfq_id IN ($rfq)) AND (x.agreement_id IS NULL OR x.agreement_id IN ($agreement)) AND NOT EXISTS (SELECT 1 FROM purchase_order_lines l WHERE l.po_id = x.id AND l.product_id IS NOT NULL AND l.product_id NOT IN ($product))"],
  poLine: ["purchase_order_lines", "x.po_id IN ($purchaseOrder)"],
  receipt: ["goods_receipts", "x.po_id IN ($purchaseOrder) AND x.warehouse_id IN ($warehouse)"],
  invoice: ["invoices", "x.company_id = $company AND (x.supplier_id IS NULL OR x.supplier_id IN ($supplier))"],
  paymentRun: ["payment_runs", "x.company_id = $company AND (x.bank_account_id IS NULL OR x.bank_account_id IN ($bankAccount)) AND NOT EXISTS (SELECT 1 FROM payment_run_lines l WHERE l.run_id = x.id AND (l.supplier_id NOT IN ($supplier) OR (l.invoice_id IS NOT NULL AND l.invoice_id NOT IN ($invoice))))"],
} as const;

export type SupplyResource = keyof typeof definitions;

function ownedIds(resource: SupplyResource, companyId: number): SQL {
  const [table, condition] = definitions[resource];
  // Each nested SELECT has its own x alias. Only literal definitions are expanded.
  const pieces = condition.split(/(\$[A-Za-z]+)/g).map((piece): SQL => {
    if (piece === "$company") return sql`${companyId}`;
    if (piece.startsWith("$")) return ownedIds(piece.slice(1) as SupplyResource, companyId);
    return sql.raw(piece);
  });
  return sql`SELECT x.id FROM ${sql.raw(table)} x WHERE ${sql.join(pieces, sql.raw(""))}`;
}

export function supplyScope(resource: SupplyResource, id: SQLWrapper, companyId: number): SQL {
  if (!Number.isInteger(companyId) || companyId <= 0) throw new Error("Missing company context");
  return sql`${id} IN (${ownedIds(resource, companyId)})`;
}

export async function requireSupplyReference(
  resource: SupplyResource, value: unknown, companyId: number, conn: DbOrTx = db,
): Promise<void> {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error("Invalid reference"), { status: 400 });
  const result = await conn.execute(sql`SELECT 1 WHERE ${id} IN (${ownedIds(resource, companyId)})`);
  if (!(result as { rows: unknown[] }).rows.length) {
    throw Object.assign(new Error("Not found"), { status: 404 });
  }
}

const references: Record<string, SupplyResource> = {
  productId: "product", componentId: "product", warehouseId: "warehouse",
  fromWarehouseId: "warehouse", toWarehouseId: "warehouse", currentWarehouseId: "warehouse",
  branchId: "branch", supplierId: "supplier", bankAccountId: "bankAccount",
  lotId: "lot", serialId: "serial", variantId: "variant", bomId: "bom",
  workOrderId: "workOrder", reservationId: "reservation", operationId: "operation",
  routingId: "routing", workCenterId: "workCenter", requisitionId: "requisition",
  rfqId: "rfq", poId: "purchaseOrder", poLineId: "poLine", invoiceId: "invoice",
  agreementId: "agreement",
};

/**
 * Validate ALL supplied references before any handler side effect, including
 * nested line/pick payloads and query filters. Role guards remain unchanged.
 * Point routes use router.param below; lists still need supplyScope predicates.
 */
export const supplyReferencesGuard: RequestHandler = async (req, res, next) => {
  try {
    const companyId = getCompanyId(req);
    const pending = new Map<string, [SupplyResource, unknown]>();
    function collect(value: unknown): void {
      if (Array.isArray(value)) { value.forEach(collect); return; }
      if (!value || typeof value !== "object") return;
      for (const [key, item] of Object.entries(value)) {
        const resource = references[key] ?? (key === "supplierIds" ? "supplier" : undefined);
        if (resource && item != null) {
          for (const id of Array.isArray(item) ? item : [item]) {
            pending.set(`${resource}:${String(id)}`, [resource, id]);
          }
        } else if (item && typeof item === "object") collect(item);
      }
    }
    collect(req.query);
    if (!["GET", "HEAD"].includes(req.method)) collect(req.body);
    for (const [resource, id] of pending.values()) await requireSupplyReference(resource, id, companyId);
    next();
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 400 || status === 404) { res.status(status).json({ error: status === 404 ? "Not found" : "Invalid reference" }); return; }
    next(err);
  }
};

export function supplyParam(resourceForPath: (path: string) => SupplyResource | undefined) {
  return async (req: import("express").Request, res: import("express").Response,
    next: import("express").NextFunction, value: string) => {
    try {
      const resource = resourceForPath(req.route.path);
      if (!resource) throw new Error("Missing resource authorization mapping");
      await requireSupplyReference(resource, value, getCompanyId(req));
      next();
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 400 || status === 404) { res.status(status).json({ error: status === 404 ? "Not found" : "Invalid reference" }); return; }
      next(err);
    }
  };
}
