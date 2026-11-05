import {sql} from "drizzle-orm";
import {db,productsTable,productVariantsTable} from "@workspace/db";
import {FinancialRequestError} from "./financial-transaction";
import {selectedResponsibility} from "./responsibility-context";
import {getCompanyId} from "./scoped-db";
import {authorizeParkedSource} from "./pos-parked-access";
import type {Request} from "express";

// Shared exact string predicate with the existing inventory barcode reader.
export const barcodeIdentity=(barcode:typeof productsTable.barcode|typeof productVariantsTable.barcode,
  sku:typeof productsTable.sku|typeof productVariantsTable.sku,code:string)=>sql`(${barcode}=${code} OR ${sku}=${code})`;

export async function posBarcode(req:Request,code:string,sessionId:number){
  return db.transaction(async tx=>{
    const shift=await authorizeParkedSource(tx,req,sessionId);
    if(shift.status!=="open")throw new FinancialRequestError("الوردية مغلقة؛ اختر وردية مفتوحة مؤكدة.",409);
    const companyId=getCompanyId(req);
    const grant=await selectedResponsibility(req.session.userId!,companyId);
    const products=await tx.execute(sql`SELECT p.id,p.name,p.name_ar AS "nameAr",p.sku,p.price::float8 AS price,
      p.category_id AS "categoryId",coalesce(c.name_ar,'') AS "categoryName",p.unit,p.image_url AS "imageUrl",
      p.is_active AS "isActive",p.barcode,p.tracking_mode AS "trackingMode",p.costing_method AS "costingMethod",
      p.min_stock AS "minStock",p.created_at AS "createdAt",
      EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id) AS "hasVariants",
      coalesce((SELECT sum(q.quantity) FROM stock_quants q JOIN warehouses w ON w.id=q.warehouse_id
        WHERE q.product_id=p.id AND w.company_id=${companyId} AND w.branch_id=${shift.branchId}
        AND NOT w.is_scrap ${grant?.resource==="pos"?sql`AND w.id=ANY(${sql.param(grant.warehouseIds)}::integer[])`:sql``}),0)::float8 AS stock
      FROM products p LEFT JOIN categories c ON c.id=p.category_id
      WHERE p.company_id=${companyId} AND (p.barcode=${code} OR p.sku=${code}) LIMIT 2`);
    const variants=await tx.execute(sql`SELECT v.id FROM product_variants v JOIN products p ON p.id=v.product_id
      WHERE p.company_id=${companyId} AND (v.barcode=${code} OR v.sku=${code}) LIMIT 2`);
    if(products.rows.length+variants.rows.length>1)
      throw new FinancialRequestError("الباركود ملتبس بين أكثر من صنف؛ راجع المسؤول دون اختيار تلقائي.",409);
    if(variants.rows.length)throw new FinancialRequestError("باركود متغير غير مدعوم في مسح الأصناف العادية.",422);
    const product=products.rows[0];
    if(!product)throw new FinancialRequestError("لم يُعثر على صنف بهذا الباركود.",404);
    if(!product.isActive)throw new FinancialRequestError("الصنف معطل وغير متاح للبيع.",422);
    if(product.trackingMode!=="none"||product.hasVariants)
      throw new FinancialRequestError("الصنف متتبع أو له متغيرات؛ استخدم مساره المخصص وليس مسح الصنف العادي.",422);
    const {hasVariants,...safeProduct}=product;
    return safeProduct;
  });
}
