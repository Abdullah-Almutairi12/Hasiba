import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Boot-time initialization of the accounting subsystem.
 *
 * - Renames the legacy `journal_entries` table (single debit/credit string
 *   columns) to `journal_entries_legacy` so that the new normalized
 *   journal_entries header table can take its place.
 * - Creates all accounting tables idempotently (CREATE TABLE IF NOT EXISTS)
 *   matching the Drizzle schema in lib/db/src/schema/accounting.ts.
 * - Seeds default currencies (SAR base, USD, EUR), a default chart of
 *   accounts, and the current fiscal year / monthly periods.
 *
 * All steps are idempotent and safe to run on every server boot.
 */
export async function initAccounting(): Promise<void> {
  // 1) Migrate legacy journal_entries table out of the way if present.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'journal_entries' AND column_name = 'debit_account'
      ) THEN
        ALTER TABLE journal_entries RENAME TO journal_entries_legacy;
      END IF;
    END$$;
  `);

  // 2) Create all accounting tables idempotently.
  // Ensure unique constraint on fiscal_years.name even on already-created tables
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_years_name_key'
      ) AND EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'fiscal_years'
      ) THEN
        BEGIN
          ALTER TABLE fiscal_years ADD CONSTRAINT fiscal_years_name_key UNIQUE (name);
        EXCEPTION WHEN duplicate_table OR unique_violation THEN NULL;
        END;
      END IF;
    END $$;
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS currencies (
      code text PRIMARY KEY,
      name text NOT NULL,
      name_ar text NOT NULL,
      symbol text NOT NULL,
      decimals integer NOT NULL DEFAULT 2,
      is_base boolean NOT NULL DEFAULT false,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS exchange_rates (
      id serial PRIMARY KEY,
      from_currency text NOT NULL REFERENCES currencies(code),
      to_currency text NOT NULL REFERENCES currencies(code),
      rate numeric(18,8) NOT NULL,
      rate_date date NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS exchange_rates_unique
      ON exchange_rates (from_currency, to_currency, rate_date);

    CREATE TABLE IF NOT EXISTS accounts (
      id serial PRIMARY KEY,
      code text NOT NULL UNIQUE,
      name text NOT NULL,
      name_ar text NOT NULL,
      type text NOT NULL,
      parent_id integer,
      is_group boolean NOT NULL DEFAULT false,
      currency_code text NOT NULL DEFAULT 'SAR' REFERENCES currencies(code),
      is_active boolean NOT NULL DEFAULT true,
      description text,
      system_key text UNIQUE,
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS accounts_parent_idx ON accounts (parent_id);
    CREATE INDEX IF NOT EXISTS accounts_type_idx ON accounts (type);

    CREATE TABLE IF NOT EXISTS fiscal_years (
      id serial PRIMARY KEY,
      name text NOT NULL UNIQUE,
      start_date date NOT NULL,
      end_date date NOT NULL,
      status text NOT NULL DEFAULT 'open',
      closed_at timestamp,
      closed_by integer REFERENCES users(id),
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS fiscal_periods (
      id serial PRIMARY KEY,
      fiscal_year_id integer NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
      name text NOT NULL,
      start_date date NOT NULL,
      end_date date NOT NULL,
      status text NOT NULL DEFAULT 'open',
      closed_at timestamp,
      closed_by integer REFERENCES users(id),
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS fiscal_periods_year_idx ON fiscal_periods (fiscal_year_id);

    CREATE TABLE IF NOT EXISTS journal_entries (
      id serial PRIMARY KEY,
      entry_number text NOT NULL UNIQUE,
      entry_date date NOT NULL,
      period_id integer REFERENCES fiscal_periods(id),
      description text NOT NULL,
      reference text,
      currency_code text NOT NULL DEFAULT 'SAR' REFERENCES currencies(code),
      exchange_rate numeric(18,8) NOT NULL DEFAULT 1,
      status text NOT NULL DEFAULT 'draft',
      source text NOT NULL DEFAULT 'manual',
      source_ref text,
      created_by integer REFERENCES users(id),
      posted_by integer REFERENCES users(id),
      posted_at timestamp,
      reversed_by integer REFERENCES users(id),
      reversed_at timestamp,
      reversal_of integer,
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS journal_entries_date_idx ON journal_entries (entry_date);
    CREATE INDEX IF NOT EXISTS journal_entries_status_idx ON journal_entries (status);
    CREATE INDEX IF NOT EXISTS journal_entries_period_idx ON journal_entries (period_id);
    CREATE INDEX IF NOT EXISTS journal_entries_source_idx ON journal_entries (source, source_ref);

    CREATE TABLE IF NOT EXISTS journal_entry_lines (
      id serial PRIMARY KEY,
      entry_id integer NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
      line_number integer NOT NULL,
      account_id integer NOT NULL REFERENCES accounts(id),
      description text,
      debit numeric(18,2) NOT NULL DEFAULT 0,
      credit numeric(18,2) NOT NULL DEFAULT 0,
      base_debit numeric(18,2) NOT NULL DEFAULT 0,
      base_credit numeric(18,2) NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS jel_entry_idx ON journal_entry_lines (entry_id);
    CREATE INDEX IF NOT EXISTS jel_account_idx ON journal_entry_lines (account_id);

    CREATE TABLE IF NOT EXISTS bank_accounts (
      id serial PRIMARY KEY,
      name text NOT NULL,
      bank_name text NOT NULL,
      account_number text NOT NULL,
      iban text,
      currency_code text NOT NULL DEFAULT 'SAR' REFERENCES currencies(code),
      gl_account_id integer NOT NULL REFERENCES accounts(id),
      opening_balance numeric(18,2) NOT NULL DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS bank_statements (
      id serial PRIMARY KEY,
      bank_account_id integer NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
      statement_date date NOT NULL,
      starting_balance numeric(18,2) NOT NULL,
      ending_balance numeric(18,2) NOT NULL,
      file_name text,
      imported_by integer REFERENCES users(id),
      imported_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS bank_statement_lines (
      id serial PRIMARY KEY,
      statement_id integer NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
      tx_date date NOT NULL,
      description text NOT NULL,
      reference text,
      amount numeric(18,2) NOT NULL,
      matched_line_id integer REFERENCES journal_entry_lines(id),
      reconciled_at timestamp,
      reconciled_by integer REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS bsl_stmt_idx ON bank_statement_lines (statement_id);
  `);

  // 3) Seed default currencies.
  await pool.query(`
    INSERT INTO currencies (code, name, name_ar, symbol, decimals, is_base) VALUES
      ('SAR', 'Saudi Riyal',  'ريال سعودي', '﷼', 2, true),
      ('USD', 'US Dollar',    'دولار أمريكي', '$', 2, false),
      ('EUR', 'Euro',         'يورو',        '€', 2, false),
      ('AED', 'UAE Dirham',   'درهم إماراتي', 'د.إ', 2, false)
    ON CONFLICT (code) DO NOTHING;
  `);

  // 4) Seed default chart of accounts (Saudi-style 4-digit codes).
  // Hierarchical: groups have is_group=true and no postings.
  type SeedAcc = {
    code: string;
    name: string;
    nameAr: string;
    type: string;
    parent?: string;
    isGroup?: boolean;
    systemKey?: string;
  };
  const coa: SeedAcc[] = [
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
  ];

  // Insert in order so parents exist before children.
  for (const a of coa) {
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

  // 5) Seed current fiscal year and monthly periods.
  const year = new Date().getFullYear();
  await pool.query(
    `INSERT INTO fiscal_years (name, start_date, end_date)
     VALUES ($1, $2, $3)
     ON CONFLICT (name) DO NOTHING`,
    [String(year), `${year}-01-01`, `${year}-12-31`],
  );
  const { rows: fyRows } = await pool.query(
    `SELECT id FROM fiscal_years WHERE name = $1`,
    [String(year)],
  );
  const fyId = fyRows[0]?.id;
  if (fyId) {
    const { rows: pCount } = await pool.query(
      `SELECT count(*)::int AS n FROM fiscal_periods WHERE fiscal_year_id = $1`,
      [fyId],
    );
    if (pCount[0].n === 0) {
      const monthsAr = [
        "يناير",
        "فبراير",
        "مارس",
        "أبريل",
        "مايو",
        "يونيو",
        "يوليو",
        "أغسطس",
        "سبتمبر",
        "أكتوبر",
        "نوفمبر",
        "ديسمبر",
      ];
      for (let m = 0; m < 12; m++) {
        const start = new Date(Date.UTC(year, m, 1));
        const end = new Date(Date.UTC(year, m + 1, 0));
        const startStr = start.toISOString().slice(0, 10);
        const endStr = end.toISOString().slice(0, 10);
        await pool.query(
          `INSERT INTO fiscal_periods (fiscal_year_id, name, start_date, end_date)
           VALUES ($1, $2, $3, $4)`,
          [fyId, `${monthsAr[m]} ${year}`, startStr, endStr],
        );
      }
    }
  }

  logger.info("Accounting subsystem initialized");
}
