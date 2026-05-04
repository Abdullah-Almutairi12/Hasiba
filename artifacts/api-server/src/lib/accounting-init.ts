import { pool } from "@workspace/db";
import { logger } from "./logger";

type PgPool = typeof pool;

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
  // Renaming the table in PostgreSQL does NOT rename its owned sequence,
  // primary-key constraint, or indexes. If we just rename, the next
  // `CREATE TABLE journal_entries (id serial PRIMARY KEY, ...)` will collide
  // on `journal_entries_id_seq` and `journal_entries_pkey`. So we rename
  // every owned object alongside the table, all inside a single block.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'journal_entries' AND column_name = 'debit_account'
      ) THEN
        ALTER TABLE journal_entries RENAME TO journal_entries_legacy;
        BEGIN
          ALTER SEQUENCE journal_entries_id_seq RENAME TO journal_entries_legacy_id_seq;
        EXCEPTION WHEN undefined_object THEN NULL; END;
        BEGIN
          ALTER INDEX journal_entries_pkey RENAME TO journal_entries_legacy_pkey;
        EXCEPTION WHEN undefined_object THEN NULL; END;
        -- Rename any other auto-generated indexes/constraints starting with
        -- the old table name so the new table can be created cleanly.
        DECLARE
          r record;
        BEGIN
          FOR r IN
            SELECT indexname FROM pg_indexes
             WHERE tablename = 'journal_entries_legacy'
               AND indexname LIKE 'journal\\_entries\\_%' ESCAPE '\\'
               AND indexname NOT LIKE 'journal\\_entries\\_legacy\\_%' ESCAPE '\\'
          LOOP
            EXECUTE format(
              'ALTER INDEX %I RENAME TO %I',
              r.indexname,
              replace(r.indexname, 'journal_entries_', 'journal_entries_legacy_')
            );
          END LOOP;
          FOR r IN
            SELECT conname FROM pg_constraint
             WHERE conrelid = 'journal_entries_legacy'::regclass
               AND conname LIKE 'journal\\_entries\\_%' ESCAPE '\\'
               AND conname NOT LIKE 'journal\\_entries\\_legacy\\_%' ESCAPE '\\'
          LOOP
            EXECUTE format(
              'ALTER TABLE journal_entries_legacy RENAME CONSTRAINT %I TO %I',
              r.conname,
              replace(r.conname, 'journal_entries_', 'journal_entries_legacy_')
            );
          END LOOP;
        END;
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
  // Ensure UNIQUE(name) exists before relying on ON CONFLICT (legacy DBs may
  // lack it from the original drizzle schema).
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_years_name_uniq'
      ) THEN
        -- Drop any duplicate fiscal_years rows by name, keeping the lowest id.
        DELETE FROM fiscal_years a
          USING fiscal_years b
         WHERE a.name = b.name AND a.id > b.id;
        ALTER TABLE fiscal_years ADD CONSTRAINT fiscal_years_name_uniq UNIQUE (name);
      END IF;
    END $$;
  `).catch((e) => logger.warn({ err: e }, "fiscal_years UNIQUE install skipped"));
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

  // 6a) Seed a default bank account row tied to the seeded `bank` GL account
  // so the Bank Reconciliation tab is usable on a fresh install.
  await pool.query(`
    INSERT INTO bank_accounts (name, bank_name, account_number, iban, currency_code, gl_account_id)
    SELECT 'الحساب البنكي الرئيسي', 'البنك الأهلي السعودي', '0000000000', 'SA0000000000000000000000', 'SAR', a.id
      FROM accounts a
     WHERE a.system_key = 'bank'
       AND NOT EXISTS (SELECT 1 FROM bank_accounts)
     LIMIT 1
  `).catch((e) => logger.warn({ err: e }, "Default bank account seed skipped"));

  // 6b) Enforce one-to-one reconciliation: a single GL line cannot be
  // matched against multiple bank statement lines. Partial unique index so
  // multiple NULLs are still allowed.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS bank_statement_lines_matched_unique
      ON bank_statement_lines (matched_line_id)
      WHERE matched_line_id IS NOT NULL
  `).catch((e) => logger.warn({ err: e }, "matched_line_id unique index skipped"));

  // 6) Migrate legacy journal entries (free-text debit/credit/amount rows)
  // into balanced new headers + 2-line entries, posted, source='legacy'.
  await migrateLegacyJournalEntries(pool);

  // 7) Database-level integrity guards.
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'journal_entries_status_chk'
      ) THEN
        ALTER TABLE journal_entries
          ADD CONSTRAINT journal_entries_status_chk
          CHECK (status IN ('draft','posted','reversed'));
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_periods_status_chk'
      ) THEN
        ALTER TABLE fiscal_periods
          ADD CONSTRAINT fiscal_periods_status_chk
          CHECK (status IN ('open','closed','locked'));
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'accounts_type_chk'
      ) THEN
        ALTER TABLE accounts
          ADD CONSTRAINT accounts_type_chk
          CHECK (type IN ('asset','liability','equity','revenue','expense'));
      END IF;
    END $$;
  `).catch((e) => logger.warn({ err: e }, "Constraint install skipped"));

  // Trigger: prevent journal_entry_lines from referencing a group account.
  await pool.query(`
    CREATE OR REPLACE FUNCTION reject_postings_to_group_accounts()
    RETURNS trigger AS $$
    DECLARE is_grp boolean;
    BEGIN
      SELECT is_group INTO is_grp FROM accounts WHERE id = NEW.account_id;
      IF is_grp THEN
        RAISE EXCEPTION 'لا يمكن الترحيل على حساب مجموعة (account_id=%)', NEW.account_id;
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS jel_no_group_post ON journal_entry_lines;
    CREATE TRIGGER jel_no_group_post
      BEFORE INSERT OR UPDATE ON journal_entry_lines
      FOR EACH ROW EXECUTE FUNCTION reject_postings_to_group_accounts();
  `).catch((e) => logger.warn({ err: e }, "Group-account trigger skipped"));

  // Heal per-year journal entry sequences after data restores or imports.
  // Drizzle/db restores reseed the underlying tables but not the
  // `journal_entries_seq_<year>` sequences we use to mint entry numbers
  // (JE-YYYY-NNNNN). If the sequence's last_value is below the highest
  // existing entry number for that year, the very next post will collide
  // on the unique entry_number index and 500 the user. We bump each
  // year's sequence to max(existing) + 1 so the next mint is always free.
  await healJournalEntrySequences().catch((e) =>
    logger.warn({ err: e }, "Journal entry sequence heal skipped"),
  );

  logger.info("Accounting subsystem initialized");
}

/**
 * Scan journal_entries.entry_number for every year present and bring the
 * matching `journal_entries_seq_<year>` sequence up to max(seq) so the
 * next nextval() can never collide on the unique entry_number constraint.
 *
 * Idempotent: a sequence that is already ahead is left untouched (setval
 * with `is_called=true` to value=max means the *next* nextval returns
 * max+1, exactly matching nextEntryNumber's expectation).
 */
async function healJournalEntrySequences(): Promise<void> {
  const { rows } = await pool.query(
    `
    SELECT year, MAX(seq) AS max_seq
      FROM (
        SELECT substring(entry_number FROM '^JE-(\\d{4})-')::int AS year,
               substring(entry_number FROM '^JE-\\d{4}-(\\d+)$')::bigint AS seq
          FROM journal_entries
         WHERE entry_number ~ '^JE-\\d{4}-\\d+$'
      ) t
     GROUP BY year
    `,
  );

  for (const r of rows as Array<{ year: number; max_seq: string | number }>) {
    const seqName = `journal_entries_seq_${r.year}`;
    const maxSeq = Number(r.max_seq);
    if (!Number.isFinite(maxSeq) || maxSeq < 1) continue;

    await pool.query(
      `CREATE SEQUENCE IF NOT EXISTS ${seqName} MINVALUE 1 START 1`,
    );
    // Only bump if the sequence is behind the highest existing value.
    // Compare current last_value (or start_value if untouched) against max.
    const { rows: cur } = await pool.query(
      `SELECT last_value, is_called FROM ${seqName}`,
    );
    const lastValue = Number(cur[0]?.last_value ?? 0);
    const isCalled = Boolean(cur[0]?.is_called);
    const effective = isCalled ? lastValue : 0;
    if (effective < maxSeq) {
      await pool.query(`SELECT setval('${seqName}', $1, true)`, [maxSeq]);
      logger.info(
        { year: r.year, seqName, from: effective, to: maxSeq },
        "Healed journal entry sequence",
      );
    }
  }
}

// Find or create an account row whose Arabic name matches `nameAr`.
// Used by legacy migration since old data only carried Arabic names.
async function findOrCreateAccountByNameAr(
  pool: PgPool,
  nameAr: string,
  fallbackType: "asset" | "liability" | "equity" | "revenue" | "expense" = "asset",
): Promise<number> {
  const { rows } = await pool.query(
    `SELECT id FROM accounts WHERE name_ar = $1 LIMIT 1`,
    [nameAr],
  );
  if (rows[0]) return rows[0].id;

  const { rows: maxRows } = await pool.query(
    `SELECT max(code) AS m FROM accounts WHERE code LIKE '9%'`,
  );
  const nextCode = String(Number(maxRows[0]?.m ?? 9000) + 1);
  const { rows: ins } = await pool.query(
    `INSERT INTO accounts (code, name, name_ar, type, currency_code, description)
     VALUES ($1, $2, $3, $4, 'SAR', 'تم إنشاؤه من بيانات قديمة')
     RETURNING id`,
    [nextCode, nameAr, nameAr, fallbackType],
  );
  return ins[0].id;
}

async function migrateLegacyJournalEntries(pool: PgPool): Promise<void> {
  // Skip if legacy table absent.
  const { rows: tbl } = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'journal_entries_legacy'`,
  );
  if (tbl.length === 0) return;

  // Skip if anything from a previous migration run is already present.
  const { rows: already } = await pool.query(
    `SELECT 1 FROM journal_entries WHERE source = 'legacy_migration' LIMIT 1`,
  );
  if (already.length > 0) return;

  const { rows: legacy } = await pool.query(
    `SELECT id, description, debit_account, credit_account, amount,
            date, reference, is_automatic
       FROM journal_entries_legacy ORDER BY id`,
  );
  if (legacy.length === 0) return;

  // Heuristic type mapping for stub accounts created from Arabic names.
  const typeFromName = (
    n: string,
  ): "asset" | "liability" | "equity" | "revenue" | "expense" => {
    if (/(إيراد|مبيعات|دخل)/.test(n)) return "revenue";
    if (/(مصاري|مصروف|تكلفة|تكاليف|أجور|رواتب|كهرباء)/.test(n)) return "expense";
    if (/(دائن|ذمم دائنة|قرض|التزام|ضريبة|مستحق)/.test(n)) return "liability";
    if (/(رأس مال|حقوق)/.test(n)) return "equity";
    return "asset";
  };

  let migrated = 0;
  for (const r of legacy) {
    const debitAccountId = await findOrCreateAccountByNameAr(
      pool,
      String(r.debit_account).trim(),
      typeFromName(String(r.debit_account)),
    );
    const creditAccountId = await findOrCreateAccountByNameAr(
      pool,
      String(r.credit_account).trim(),
      typeFromName(String(r.credit_account)),
    );

    const entryDate = new Date(r.date).toISOString().slice(0, 10);
    const year = new Date(r.date).getUTCFullYear();
    const { rows: pRow } = await pool.query(
      `SELECT id FROM fiscal_periods
        WHERE start_date <= $1 AND end_date >= $1 LIMIT 1`,
      [entryDate],
    );
    const periodId = pRow[0]?.id ?? null;
    const entryNumber = `LEG-${year}-${String(r.id).padStart(5, "0")}`;
    const amount = String(r.amount);

    const { rows: header } = await pool.query(
      `INSERT INTO journal_entries
         (entry_number, entry_date, period_id, description, reference,
          currency_code, exchange_rate, status, source, source_ref,
          posted_at)
       VALUES ($1, $2, $3, $4, $5, 'SAR', 1, 'posted', 'legacy_migration', $6, now())
       ON CONFLICT (entry_number) DO NOTHING
       RETURNING id`,
      [entryNumber, entryDate, periodId, r.description, r.reference ?? null, String(r.id)],
    );
    const entryId = header[0]?.id;
    if (!entryId) continue;

    await pool.query(
      `INSERT INTO journal_entry_lines
         (entry_id, line_number, account_id, debit, credit,
          base_debit, base_credit, description)
       VALUES
         ($1, 1, $2, $3, 0, $3, 0, $5),
         ($1, 2, $4, 0, $3, 0, $3, $5)`,
      [entryId, debitAccountId, amount, creditAccountId, r.description],
    );
    migrated++;
  }
  logger.info({ migrated }, "Migrated legacy journal entries");
}
