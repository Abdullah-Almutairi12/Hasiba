import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Boot-time initialization of the HR & Payroll subsystem.
 *
 * - Creates HR tables idempotently (mirrors lib/db/src/schema/hr.ts).
 * - Seeds the GOSI Payable and Employee Advances accounts under Liabilities.
 * - Seeds default leave types (annual, sick, unpaid, maternity, hajj, bereavement).
 * - Seeds an active GOSI rate row using current Saudi defaults.
 * - Seeds a single default shift (09:00–17:00, Sun–Thu).
 *
 * Safe to run on every boot.
 */
export async function initHr(provisionCompanyId?: number): Promise<void> {
  // 1) Tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS departments (
      id serial PRIMARY KEY,
      name text NOT NULL,
      name_ar text NOT NULL,
      parent_id integer,
      manager_employee_id integer,
      branch_id integer REFERENCES branches(id),
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS positions (
      id serial PRIMARY KEY,
      title text NOT NULL,
      title_ar text NOT NULL,
      department_id integer REFERENCES departments(id),
      level text,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS employees (
      id serial PRIMARY KEY,
      employee_no text NOT NULL UNIQUE,
      name text NOT NULL,
      name_ar text NOT NULL,
      nationality_type text NOT NULL DEFAULT 'saudi',
      nationality text NOT NULL DEFAULT 'SA',
      national_id text,
      iqama_expiry date,
      passport_no text,
      passport_expiry date,
      date_of_birth date,
      gender text,
      marital_status text,
      email text,
      phone text,
      address text,
      emergency_contact_name text,
      emergency_contact_phone text,
      photo_url text,
      branch_id integer REFERENCES branches(id),
      department_id integer REFERENCES departments(id),
      position_id integer REFERENCES positions(id),
      manager_employee_id integer,
      user_id integer REFERENCES users(id),
      bank_name text,
      bank_iban text,
      bank_account_no text,
      hire_date date NOT NULL,
      termination_date date,
      status text NOT NULL DEFAULT 'active',
      notes text,
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS employees_branch_idx ON employees (branch_id);
    CREATE INDEX IF NOT EXISTS employees_dept_idx ON employees (department_id);
    CREATE INDEX IF NOT EXISTS employees_status_idx ON employees (status);

    CREATE TABLE IF NOT EXISTS employee_documents (
      id serial PRIMARY KEY,
      employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      doc_type text NOT NULL,
      title text NOT NULL,
      file_url text NOT NULL,
      expiry_date date,
      uploaded_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS contracts (
      id serial PRIMARY KEY,
      reference text NOT NULL UNIQUE,
      employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      contract_type text NOT NULL,
      start_date date NOT NULL,
      end_date date,
      probation_months integer NOT NULL DEFAULT 3,
      notice_period_days integer NOT NULL DEFAULT 30,
      basic_salary numeric(18,2) NOT NULL,
      housing_allowance numeric(18,2) NOT NULL DEFAULT 0,
      transport_allowance numeric(18,2) NOT NULL DEFAULT 0,
      other_allowances numeric(18,2) NOT NULL DEFAULT 0,
      gosi_category text NOT NULL DEFAULT 'civil',
      gosi_applies boolean NOT NULL DEFAULT true,
      working_hours_per_week integer NOT NULL DEFAULT 48,
      annual_leave_days integer NOT NULL DEFAULT 21,
      status text NOT NULL DEFAULT 'active',
      document_url text,
      notes text,
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS contracts_emp_idx ON contracts (employee_id);

    CREATE TABLE IF NOT EXISTS salary_components (
      id serial PRIMARY KEY,
      contract_id integer NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      name text NOT NULL,
      name_ar text NOT NULL,
      kind text NOT NULL,
      amount numeric(18,2) NOT NULL,
      include_in_gosi boolean NOT NULL DEFAULT false,
      is_active boolean NOT NULL DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS leave_types (
      id serial PRIMARY KEY,
      code text NOT NULL UNIQUE,
      name text NOT NULL,
      name_ar text NOT NULL,
      default_days_per_year integer NOT NULL DEFAULT 0,
      is_paid boolean NOT NULL DEFAULT true,
      accrual_mode text NOT NULL DEFAULT 'granted',
      is_active boolean NOT NULL DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS leave_balances (
      id serial PRIMARY KEY,
      employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      leave_type_id integer NOT NULL REFERENCES leave_types(id),
      year integer NOT NULL,
      entitlement numeric(8,2) NOT NULL DEFAULT 0,
      used numeric(8,2) NOT NULL DEFAULT 0,
      pending numeric(8,2) NOT NULL DEFAULT 0,
      updated_at timestamp NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS leave_balances_unique ON leave_balances (employee_id, leave_type_id, year);

    CREATE TABLE IF NOT EXISTS leave_requests (
      id serial PRIMARY KEY,
      reference text NOT NULL UNIQUE,
      employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      leave_type_id integer NOT NULL REFERENCES leave_types(id),
      start_date date NOT NULL,
      end_date date NOT NULL,
      days numeric(8,2) NOT NULL,
      reason text,
      status text NOT NULL DEFAULT 'pending',
      approved_by integer REFERENCES users(id),
      approved_at timestamp,
      rejection_reason text,
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS leave_requests_emp_idx ON leave_requests (employee_id);
    CREATE INDEX IF NOT EXISTS leave_requests_status_idx ON leave_requests (status);

    CREATE TABLE IF NOT EXISTS shifts (
      id serial PRIMARY KEY,
      name text NOT NULL,
      name_ar text NOT NULL,
      start_time text NOT NULL,
      end_time text NOT NULL,
      break_minutes integer NOT NULL DEFAULT 60,
      working_days text NOT NULL DEFAULT '0,1,2,3,4',
      is_active boolean NOT NULL DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS employee_shifts (
      id serial PRIMARY KEY,
      employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      shift_id integer NOT NULL REFERENCES shifts(id),
      effective_from date NOT NULL,
      effective_to date
    );

    CREATE TABLE IF NOT EXISTS attendance_punches (
      id serial PRIMARY KEY,
      employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      punch_at timestamp NOT NULL,
      direction text NOT NULL,
      source text NOT NULL DEFAULT 'manual',
      device_id text,
      notes text,
      created_by integer REFERENCES users(id),
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS att_punches_emp_idx ON attendance_punches (employee_id, punch_at);

    CREATE TABLE IF NOT EXISTS gosi_settings (
      id serial PRIMARY KEY,
      effective_from date NOT NULL,
      saudi_employee_rate numeric(5,2) NOT NULL DEFAULT 9.75,
      saudi_employer_rate numeric(5,2) NOT NULL DEFAULT 11.75,
      non_saudi_employer_rate numeric(5,2) NOT NULL DEFAULT 2.00,
      salary_ceiling numeric(18,2) NOT NULL DEFAULT 45000,
      is_active boolean NOT NULL DEFAULT true,
      notes text,
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS employee_loans (
      id serial PRIMARY KEY,
      reference text NOT NULL UNIQUE,
      employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      kind text NOT NULL DEFAULT 'loan',
      principal numeric(18,2) NOT NULL,
      monthly_installment numeric(18,2) NOT NULL,
      outstanding numeric(18,2) NOT NULL,
      start_date date NOT NULL,
      status text NOT NULL DEFAULT 'active',
      reason text,
      approved_by integer REFERENCES users(id),
      approved_at timestamp,
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS payroll_periods (
      id serial PRIMARY KEY,
      name text NOT NULL,
      year integer NOT NULL,
      month integer NOT NULL,
      start_date date NOT NULL,
      end_date date NOT NULL,
      pay_date date NOT NULL,
      status text NOT NULL DEFAULT 'open',
      created_at timestamp NOT NULL DEFAULT now()
    );
    -- Custom periods supported (e.g. mid-month bonus run, weekly contractor
    -- run). Uniqueness is on the period name, not (year, month).
    CREATE UNIQUE INDEX IF NOT EXISTS payroll_periods_name_unique ON payroll_periods (name);

    CREATE TABLE IF NOT EXISTS payroll_runs (
      id serial PRIMARY KEY,
      reference text NOT NULL UNIQUE,
      period_id integer NOT NULL REFERENCES payroll_periods(id),
      branch_id integer REFERENCES branches(id),
      status text NOT NULL DEFAULT 'draft',
      total_gross numeric(18,2) NOT NULL DEFAULT 0,
      total_deductions numeric(18,2) NOT NULL DEFAULT 0,
      total_gosi_employee numeric(18,2) NOT NULL DEFAULT 0,
      total_gosi_employer numeric(18,2) NOT NULL DEFAULT 0,
      total_net numeric(18,2) NOT NULL DEFAULT 0,
      employee_count integer NOT NULL DEFAULT 0,
      computed_at timestamp,
      approved_by integer REFERENCES users(id),
      approved_at timestamp,
      posted_journal_id integer,
      posted_at timestamp,
      paid_at timestamp,
      payment_journal_id integer,
      notes text,
      created_by integer REFERENCES users(id),
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS payroll_runs_period_idx ON payroll_runs (period_id);
    ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS payment_journal_id integer;
    ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS gosi_journal_id integer;
    ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS gosi_remitted_at timestamp;

    CREATE TABLE IF NOT EXISTS payroll_lines (
      id serial PRIMARY KEY,
      run_id integer NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
      employee_id integer NOT NULL REFERENCES employees(id),
      contract_id integer REFERENCES contracts(id),
      worked_days numeric(8,2) NOT NULL DEFAULT 30,
      lwp_days numeric(8,2) NOT NULL DEFAULT 0,
      overtime_hours numeric(8,2) NOT NULL DEFAULT 0,
      basic_salary numeric(18,2) NOT NULL DEFAULT 0,
      housing_allowance numeric(18,2) NOT NULL DEFAULT 0,
      transport_allowance numeric(18,2) NOT NULL DEFAULT 0,
      other_allowances numeric(18,2) NOT NULL DEFAULT 0,
      overtime_amount numeric(18,2) NOT NULL DEFAULT 0,
      gross_pay numeric(18,2) NOT NULL DEFAULT 0,
      gosi_base numeric(18,2) NOT NULL DEFAULT 0,
      gosi_employee numeric(18,2) NOT NULL DEFAULT 0,
      gosi_employer numeric(18,2) NOT NULL DEFAULT 0,
      lwp_deduction numeric(18,2) NOT NULL DEFAULT 0,
      loan_deduction numeric(18,2) NOT NULL DEFAULT 0,
      other_deductions numeric(18,2) NOT NULL DEFAULT 0,
      total_deductions numeric(18,2) NOT NULL DEFAULT 0,
      net_pay numeric(18,2) NOT NULL DEFAULT 0,
      notes text
    );
    CREATE UNIQUE INDEX IF NOT EXISTS payroll_lines_run_emp_unique ON payroll_lines (run_id, employee_id);

    CREATE TABLE IF NOT EXISTS payroll_deductions (
      id serial PRIMARY KEY,
      line_id integer NOT NULL REFERENCES payroll_lines(id) ON DELETE CASCADE,
      kind text NOT NULL,
      description text NOT NULL,
      amount numeric(18,2) NOT NULL,
      reference text
    );

    CREATE TABLE IF NOT EXISTS payslips (
      id serial PRIMARY KEY,
      reference text NOT NULL UNIQUE,
      run_id integer NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
      line_id integer NOT NULL REFERENCES payroll_lines(id) ON DELETE CASCADE,
      employee_id integer NOT NULL REFERENCES employees(id),
      file_url text,
      emailed_at timestamp,
      created_at timestamp NOT NULL DEFAULT now()
    );
  `);

  // 2) Seed GL accounts used by payroll posting.
  await pool.query(`
    INSERT INTO accounts (code, name, name_ar, type, parent_id, is_group, system_key)
    SELECT '2160', 'GOSI Payable', 'تأمينات اجتماعية مستحقة', 'liability',
           (SELECT id FROM accounts WHERE code = '2100'), false, 'gosi_payable'
     WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE system_key = 'gosi_payable');

    INSERT INTO accounts (code, name, name_ar, type, parent_id, is_group, system_key)
    SELECT '1160', 'Employee Advances', 'سلف الموظفين', 'asset',
           (SELECT id FROM accounts WHERE code = '1100'), false, 'employee_advances'
     WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE system_key = 'employee_advances');
  `).catch((e) => logger.warn({ err: e }, "HR account seeding skipped"));

  // 3) Default leave types.
  await pool.query(`
    INSERT INTO leave_types (code, name, name_ar, default_days_per_year, is_paid, accrual_mode)
    VALUES
      ('annual',       'Annual Leave',       'إجازة سنوية',     21, true,  'granted'),
      ('sick',         'Sick Leave',         'إجازة مرضية',     30, true,  'granted'),
      ('unpaid',       'Unpaid Leave',       'إجازة بدون راتب',  0, false, 'granted'),
      ('maternity',    'Maternity Leave',    'إجازة أمومة',     70, true,  'granted'),
      ('hajj',         'Hajj Leave',         'إجازة حج',        15, true,  'granted'),
      ('bereavement',  'Bereavement Leave',  'إجازة وفاة',       5, true,  'granted')
    ON CONFLICT (code) DO NOTHING;
  `);

  // 4) Default GOSI rates (current Saudi defaults).
  await pool.query(`
    INSERT INTO gosi_settings (effective_from, saudi_employee_rate, saudi_employer_rate, non_saudi_employer_rate, salary_ceiling, is_active, notes)
    SELECT CURRENT_DATE, 9.75, 11.75, 2.00, 45000, true,
           'الإعدادات الافتراضية وفق المؤسسة العامة للتأمينات الاجتماعية'
     WHERE NOT EXISTS (SELECT 1 FROM gosi_settings);
  `);

  // 5) Default shift.
  if (provisionCompanyId !== undefined) {
    if (!Number.isInteger(provisionCompanyId) || provisionCompanyId <= 0) {
      throw new Error("HR provisioning requires a validated company ID");
    }
    await pool.query(`
    INSERT INTO shifts (company_id, name, name_ar, start_time, end_time, break_minutes, working_days)
    SELECT c.id, 'Standard 8h', 'الدوام الاعتيادي', '09:00', '17:00', 60, '0,1,2,3,4'
      FROM companies c
     WHERE c.id = $1 AND NOT EXISTS (SELECT 1 FROM shifts s WHERE s.company_id = c.id);
  `, [provisionCompanyId]);
  }

  // 6) Expense claims (employee reimbursement requests). The workflow
  //    engine routes these via doc_type=expense_claim. JE posting on
  //    approval is intentionally out of scope (per Task #7 spec, JE is
  //    optional); status flips to approved/rejected and admins post the
  //    JE manually if needed.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS expense_claims (
      id serial PRIMARY KEY,
      reference text NOT NULL UNIQUE,
      employee_id integer NOT NULL REFERENCES employees(id),
      claim_date date NOT NULL,
      currency text NOT NULL DEFAULT 'SAR',
      amount numeric(18,2) NOT NULL,
      category text,
      description text,
      receipt_url text,
      status text NOT NULL DEFAULT 'pending', -- pending | approved | rejected | paid
      approved_by integer REFERENCES users(id),
      approved_at timestamp,
      rejection_reason text,
      created_by integer REFERENCES users(id),
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS expense_claims_emp_idx ON expense_claims (employee_id);
    CREATE INDEX IF NOT EXISTS expense_claims_status_idx ON expense_claims (status);
  `);
}
