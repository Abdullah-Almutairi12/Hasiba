import { pool } from "@workspace/db";

/**
 * Default chart-of-accounts template shared by the boot-time accounting
 * seeder and the per-company provisioning flow (Multi-Company Phase 3).
 *
 * NOTE: the `accounts` table currently has a global unique `code` and no
 * `company_id` column. Until accounts become tenant-scoped, this seeder is
 * effectively idempotent across companies — the first company "wins" the
 * chart and subsequent calls are a no-op. A future schema migration will
 * make accounts company-scoped; this helper is the single source of truth
 * for the default tree so that migration only has to touch one file.
 */
export type DefaultCoaEntry = {
  code: string;
  name: string;
  nameAr: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  parent?: string;
  isGroup?: boolean;
  systemKey?: string;
};

export const DEFAULT_COA: readonly DefaultCoaEntry[] = [
  // Assets
  { code: "1000", name: "Assets", nameAr: "الأصول", type: "asset", isGroup: true },
  { code: "1100", name: "Current Assets", nameAr: "الأصول المتداولة", type: "asset", parent: "1000", isGroup: true },
  { code: "1110", name: "Cash on Hand", nameAr: "النقدية في الصندوق", type: "asset", parent: "1100", systemKey: "cash" },
  { code: "1120", name: "Bank", nameAr: "البنك", type: "asset", parent: "1100", systemKey: "bank" },
  { code: "1130", name: "Accounts Receivable", nameAr: "الذمم المدينة (العملاء)", type: "asset", parent: "1100", systemKey: "ar" },
  { code: "1140", name: "VAT Input (Recoverable)", nameAr: "ضريبة القيمة المضافة - مدخلات", type: "asset", parent: "1100", systemKey: "vat_input" },
  { code: "1210", name: "Inventory", nameAr: "المخزون", type: "asset", parent: "1100", systemKey: "inventory" },
  { code: "1500", name: "Fixed Assets", nameAr: "الأصول الثابتة", type: "asset", parent: "1000", isGroup: true },
  { code: "1510", name: "Equipment", nameAr: "المعدات", type: "asset", parent: "1500" },
  { code: "1520", name: "Furniture", nameAr: "الأثاث", type: "asset", parent: "1500" },

  // Liabilities
  { code: "2000", name: "Liabilities", nameAr: "الخصوم", type: "liability", isGroup: true },
  { code: "2100", name: "Current Liabilities", nameAr: "الخصوم المتداولة", type: "liability", parent: "2000", isGroup: true },
  { code: "2110", name: "Accounts Payable", nameAr: "الذمم الدائنة (الموردون)", type: "liability", parent: "2100", systemKey: "ap" },
  { code: "2120", name: "VAT Output (Payable)", nameAr: "ضريبة القيمة المضافة - مخرجات", type: "liability", parent: "2100", systemKey: "vat_output" },
  { code: "2130", name: "VAT Payable to ZATCA", nameAr: "ضريبة مستحقة لهيئة الزكاة", type: "liability", parent: "2100", systemKey: "vat_payable" },
  { code: "2140", name: "Salaries Payable", nameAr: "رواتب مستحقة", type: "liability", parent: "2100", systemKey: "salaries_payable" },

  // Equity
  { code: "3000", name: "Equity", nameAr: "حقوق الملكية", type: "equity", isGroup: true },
  { code: "3110", name: "Capital", nameAr: "رأس المال", type: "equity", parent: "3000", systemKey: "capital" },
  { code: "3120", name: "Retained Earnings", nameAr: "الأرباح المحتجزة", type: "equity", parent: "3000", systemKey: "retained_earnings" },
  { code: "3130", name: "Current Year Earnings", nameAr: "أرباح السنة الحالية", type: "equity", parent: "3000", systemKey: "current_earnings" },

  // Revenue
  { code: "4000", name: "Revenue", nameAr: "الإيرادات", type: "revenue", isGroup: true },
  { code: "4110", name: "Sales Revenue", nameAr: "إيرادات المبيعات", type: "revenue", parent: "4000", systemKey: "sales_revenue" },
  { code: "4120", name: "Service Revenue", nameAr: "إيرادات الخدمات", type: "revenue", parent: "4000", systemKey: "service_revenue" },
  { code: "4910", name: "Other Income", nameAr: "إيرادات أخرى", type: "revenue", parent: "4000", systemKey: "other_income" },
  { code: "4920", name: "FX Gain", nameAr: "أرباح فروقات عملة", type: "revenue", parent: "4000", systemKey: "fx_gain" },

  // Expenses
  { code: "5000", name: "Expenses", nameAr: "المصروفات", type: "expense", isGroup: true },
  { code: "5110", name: "Cost of Goods Sold", nameAr: "تكلفة البضاعة المباعة", type: "expense", parent: "5000", systemKey: "cogs" },
  { code: "5210", name: "Salaries Expense", nameAr: "مصاريف رواتب", type: "expense", parent: "5000", systemKey: "salaries_expense" },
  { code: "5220", name: "Rent Expense", nameAr: "مصاريف إيجار", type: "expense", parent: "5000", systemKey: "rent_expense" },
  { code: "5230", name: "Utilities Expense", nameAr: "مصاريف خدمات", type: "expense", parent: "5000", systemKey: "utilities_expense" },
  { code: "5240", name: "Marketing Expense", nameAr: "مصاريف تسويق", type: "expense", parent: "5000", systemKey: "marketing_expense" },
  { code: "5910", name: "FX Loss", nameAr: "خسائر فروقات عملة", type: "expense", parent: "5000", systemKey: "fx_loss" },
  { code: "5990", name: "Other Expenses", nameAr: "مصاريف أخرى", type: "expense", parent: "5000", systemKey: "other_expense" },
] as const;

/**
 * Insert the default chart of accounts. Safe to call for every new company
 * — `ON CONFLICT (code) DO NOTHING` makes the call a no-op once the global
 * chart has been seeded.
 */
export async function seedDefaultChartOfAccounts(): Promise<void> {
  for (const a of DEFAULT_COA) {
    await pool.query(
      `INSERT INTO accounts (code, name, name_ar, type, parent_id, is_group, system_key)
       VALUES ($1, $2, $3, $4, (SELECT id FROM accounts WHERE code = $5), $6, $7)
       ON CONFLICT (code) DO NOTHING`,
      [
        a.code,
        a.name,
        a.nameAr,
        a.type,
        a.parent ?? null,
        a.isGroup ?? false,
        a.systemKey ?? null,
      ],
    );
  }
}
