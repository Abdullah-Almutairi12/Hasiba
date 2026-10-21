import type { Role } from "../middlewares/require-role";

export type ColumnType = "string" | "number" | "date" | "datetime" | "boolean";

export interface DataSourceColumn {
  key: string;
  label: string;
  type: ColumnType;
  expr: string;
  aggregatable?: boolean;
}

export interface DataSource {
  key: string;
  label: string;
  module: string;
  fromSql: string;
  companyExpr: string;
  columns: DataSourceColumn[];
  rolesAllowed: Role[];
  defaultDateColumn?: string;
}

export const DATA_SOURCES: DataSource[] = [
  {
    key: "sales_orders",
    companyExpr: "b.company_id",
    label: "طلبات نقطة البيع",
    module: "sales",
    fromSql: `pos_orders po
      left join pos_sessions ps on ps.id = po.session_id
      left join branches b on b.id = ps.branch_id
      left join customers c on c.id = po.customer_id and c.company_id = b.company_id`,
    defaultDateColumn: "created_at",
    columns: [
      { key: "id", label: "المعرف", type: "number", expr: "po.id" },
      { key: "order_number", label: "رقم الطلب", type: "string", expr: "po.order_number" },
      { key: "total", label: "الإجمالي", type: "number", expr: "po.total::numeric", aggregatable: true },
      { key: "subtotal", label: "قبل الضريبة", type: "number", expr: "po.subtotal::numeric", aggregatable: true },
      { key: "vat_amount", label: "ضريبة القيمة المضافة", type: "number", expr: "po.vat_amount::numeric", aggregatable: true },
      { key: "discount", label: "الخصم", type: "number", expr: "po.discount::numeric", aggregatable: true },
      { key: "payment_method", label: "طريقة الدفع", type: "string", expr: "po.payment_method" },
      { key: "branch_id", label: "معرف الفرع", type: "number", expr: "ps.branch_id" },
      { key: "branch_name", label: "اسم الفرع", type: "string", expr: "b.name_ar" },
      { key: "customer_name", label: "العميل", type: "string", expr: "c.name" },
      { key: "created_at", label: "التاريخ", type: "datetime", expr: "po.created_at" },
    ],
    rolesAllowed: ["owner", "manager", "accountant", "auditor", "sales", "marketing"],
  },
  {
    key: "products",
    companyExpr: "p.company_id",
    label: "المنتجات والمخزون",
    module: "inventory",
    fromSql: `products p
      left join categories cat on cat.id = p.category_id`,
    columns: [
      { key: "id", label: "المعرف", type: "number", expr: "p.id" },
      { key: "sku", label: "SKU", type: "string", expr: "p.sku" },
      { key: "name_ar", label: "الاسم", type: "string", expr: "p.name_ar" },
      { key: "category", label: "التصنيف", type: "string", expr: "cat.name_ar" },
      { key: "price", label: "سعر البيع", type: "number", expr: "p.price::numeric", aggregatable: true },
      { key: "cost_price", label: "سعر التكلفة", type: "number", expr: "p.cost_price::numeric", aggregatable: true },
      { key: "stock", label: "المخزون", type: "number", expr: "p.stock", aggregatable: true },
      { key: "min_stock", label: "الحد الأدنى", type: "number", expr: "p.min_stock", aggregatable: true },
      { key: "is_active", label: "نشط", type: "boolean", expr: "p.is_active" },
    ],
    rolesAllowed: ["owner", "manager", "inventory", "accountant", "auditor"],
  },
  {
    key: "supplier_invoices",
    companyExpr: "i.company_id",
    label: "فواتير الموردين",
    module: "purchases",
    fromSql: "invoices i",
    defaultDateColumn: "created_at",
    columns: [
      { key: "id", label: "المعرف", type: "number", expr: "i.id" },
      { key: "invoice_number", label: "رقم الفاتورة", type: "string", expr: "i.invoice_number" },
      { key: "supplier_name", label: "المورد", type: "string", expr: "i.supplier_name" },
      { key: "amount", label: "المبلغ", type: "number", expr: "i.amount::numeric", aggregatable: true },
      { key: "vat_amount", label: "الضريبة", type: "number", expr: "i.vat_amount::numeric", aggregatable: true },
      { key: "status", label: "الحالة", type: "string", expr: "i.status" },
      { key: "created_at", label: "التاريخ", type: "datetime", expr: "i.created_at" },
    ],
    rolesAllowed: ["owner", "manager", "accountant", "inventory", "auditor"],
  },
  {
    key: "customers",
    companyExpr: "c.company_id",
    label: "العملاء",
    module: "sales",
    fromSql: "customers c",
    defaultDateColumn: "created_at",
    columns: [
      { key: "id", label: "المعرف", type: "number", expr: "c.id" },
      { key: "name", label: "الاسم", type: "string", expr: "c.name" },
      { key: "phone", label: "الهاتف", type: "string", expr: "c.phone" },
      { key: "email", label: "البريد", type: "string", expr: "c.email" },
      { key: "loyalty_points", label: "نقاط الولاء", type: "number", expr: "c.loyalty_points", aggregatable: true },
      { key: "created_at", label: "تاريخ التسجيل", type: "datetime", expr: "c.created_at" },
    ],
    rolesAllowed: ["owner", "manager", "accountant", "sales", "marketing", "auditor"],
  },
  {
    key: "journal_entries",
    companyExpr: "je.company_id",
    label: "قيود اليومية",
    module: "accounting",
    fromSql: `journal_entry_lines jl
      inner join journal_entries je on je.id = jl.entry_id
      inner join accounts a on a.id = jl.account_id`,
    defaultDateColumn: "entry_date",
    columns: [
      { key: "entry_number", label: "رقم القيد", type: "string", expr: "je.entry_number" },
      { key: "entry_date", label: "التاريخ", type: "date", expr: "je.entry_date" },
      { key: "description", label: "البيان", type: "string", expr: "je.description" },
      { key: "account_code", label: "رمز الحساب", type: "string", expr: "a.code" },
      { key: "account_name", label: "اسم الحساب", type: "string", expr: "a.name_ar" },
      { key: "account_type", label: "نوع الحساب", type: "string", expr: "a.type" },
      { key: "debit", label: "مدين", type: "number", expr: "jl.debit::numeric", aggregatable: true },
      { key: "credit", label: "دائن", type: "number", expr: "jl.credit::numeric", aggregatable: true },
      { key: "status", label: "الحالة", type: "string", expr: "je.status" },
    ],
    rolesAllowed: ["owner", "manager", "accountant", "auditor"],
  },
];

export function getDataSource(key: string): DataSource | undefined {
  return DATA_SOURCES.find((s) => s.key === key);
}

export function userCanReadSource(role: Role | undefined, source: DataSource): boolean {
  if (!role) return false;
  return source.rolesAllowed.includes(role);
}

export function listSourcesForRole(role: Role | undefined) {
  if (!role) return [];
  return DATA_SOURCES.filter((s) => s.rolesAllowed.includes(role)).map((s) => ({
    key: s.key,
    label: s.label,
    module: s.module,
    columns: s.columns.map((c) => ({
      key: c.key,
      label: c.label,
      type: c.type,
      aggregatable: !!c.aggregatable,
    })),
    defaultDateColumn: s.defaultDateColumn,
  }));
}
