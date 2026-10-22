import type { Pool } from "pg";

export const issueDescriptions = {
  MULTIPLE_REVERSALS: "أكثر من قيد مقابل لنفس reversal_of؛ قد يتكرر أثر العكس في GL.",
  METADATA_WITHOUT_REVERSAL: "بيانات عكس على الأصل دون قيد مقابل؛ قد يبقى أثر الأصل في GL.",
  REVERSAL_WITHOUT_TIMESTAMP: "قيد مقابل موجود دون reversed_at على الأصل.",
  ACTOR_WITHOUT_TIMESTAMP: "reversed_by موجود دون reversed_at.",
  ACTOR_MISMATCH: "مستخدم عكس الأصل لا يطابق posted_by لقيده المقابل.",
  CROSS_COMPANY_REVERSAL: "ارتباط عكس بين شركتين؛ لا يجوز اعتبار المبالغ متعادلة عبر الشركات.",
  MISSING_ORIGINAL: "reversal_of يشير إلى أصل غير موجود؛ يبقى أثر المقابل المرحّل دون أصل.",
  NON_POSTED_ORIGINAL: "الأصل ليس مرحّلاً؛ GL لا يحتسبه لتعويض القيد المقابل.",
  NON_POSTED_REVERSAL: "قيد مقابل غير مرحّل؛ وجود الرابط لا يثبت زوال أثر الأصل في GL.",
  SELF_REVERSAL: "القيد يشير إلى نفسه كأصل للعكس.",
} as const;

type IssueCode = keyof typeof issueDescriptions;
interface EntryEvidence {
  id: number;
  company_id: number;
  entry_number: string;
  status: string;
  reversal_of: number | null;
  reversed_at: string | null;
  reversed_by: number | null;
  posted_by: number | null;
  base_debit: string;
  base_credit: string;
}
export interface ReversalFinding {
  reversal_of: number;
  company_id: number | null;
  original: EntryEvidence | null;
  reversals: EntryEvidence[];
  issue_codes: IssueCode[];
  // These are actual posted contributions, not an estimate of a repair.
  gl_posted_net_by_company_account: {
    company_id: number;
    account_id: number;
    base_debit: string;
    base_credit: string;
    net_base_debit: string;
  }[];
}

// No company filter: filtering children before checking links would hide
// historical cross-tenant reversals. Fixed, schema-qualified SQL only.
const auditSql = `
WITH targets AS (
  SELECT reversal_of AS id FROM public.journal_entries WHERE reversal_of IS NOT NULL
  UNION
  SELECT id FROM public.journal_entries
  WHERE reversed_at IS NOT NULL OR reversed_by IS NOT NULL
), groups AS (
  SELECT t.id, o.company_id, o.status, o.reversed_at, o.reversed_by,
    count(r.id)::int AS reversal_count,
    coalesce(bool_or(r.company_id IS DISTINCT FROM o.company_id)
      FILTER (WHERE r.id IS NOT NULL AND o.id IS NOT NULL), false) AS cross_company,
    coalesce(bool_or(r.status <> 'posted') FILTER (WHERE r.id IS NOT NULL), false) AS non_posted,
    coalesce(bool_or(r.posted_by IS DISTINCT FROM o.reversed_by)
      FILTER (WHERE r.id IS NOT NULL), false) AS actor_mismatch,
    coalesce(bool_or(r.id = t.id), false) AS self_reversal,
    o.id IS NULL AS missing_original
  FROM targets t
  LEFT JOIN public.journal_entries o ON o.id = t.id
  LEFT JOIN public.journal_entries r ON r.reversal_of = t.id
  GROUP BY t.id, o.id
), issues AS (
  SELECT *, array_remove(ARRAY[
    CASE WHEN reversal_count > 1 THEN 'MULTIPLE_REVERSALS' END,
    CASE WHEN reversal_count = 0 AND (reversed_at IS NOT NULL OR reversed_by IS NOT NULL)
      THEN 'METADATA_WITHOUT_REVERSAL' END,
    CASE WHEN NOT missing_original AND reversal_count > 0 AND reversed_at IS NULL
      THEN 'REVERSAL_WITHOUT_TIMESTAMP' END,
    CASE WHEN reversed_by IS NOT NULL AND reversed_at IS NULL THEN 'ACTOR_WITHOUT_TIMESTAMP' END,
    CASE WHEN reversal_count = 1 AND reversed_at IS NOT NULL AND actor_mismatch
      THEN 'ACTOR_MISMATCH' END,
    CASE WHEN cross_company THEN 'CROSS_COMPANY_REVERSAL' END,
    CASE WHEN missing_original THEN 'MISSING_ORIGINAL' END,
    CASE WHEN status <> 'posted' AND reversal_count > 0 THEN 'NON_POSTED_ORIGINAL' END,
    CASE WHEN non_posted THEN 'NON_POSTED_REVERSAL' END,
    CASE WHEN self_reversal THEN 'SELF_REVERSAL' END
  ], NULL) AS issue_codes
  FROM groups
), flagged AS (
  SELECT * FROM issues WHERE cardinality(issue_codes) > 0
), members AS (
  SELECT f.id AS target_id, e.id AS entry_id
  FROM flagged f JOIN public.journal_entries e ON e.id = f.id OR e.reversal_of = f.id
), evidence AS (
  SELECT e.id, jsonb_build_object(
    'id', e.id, 'company_id', e.company_id, 'entry_number', e.entry_number,
    'status', e.status, 'reversal_of', e.reversal_of,
    'reversed_at', e.reversed_at, 'reversed_by', e.reversed_by, 'posted_by', e.posted_by,
    'base_debit', coalesce(sum(l.base_debit), 0)::text,
    'base_credit', coalesce(sum(l.base_credit), 0)::text
  ) AS data
  FROM public.journal_entries e
  LEFT JOIN public.journal_entry_lines l ON l.entry_id = e.id
  WHERE e.id IN (SELECT entry_id FROM members)
  GROUP BY e.id
), gl AS (
  SELECT m.target_id, e.company_id, l.account_id,
    sum(l.base_debit)::text AS base_debit, sum(l.base_credit)::text AS base_credit,
    sum(l.base_debit - l.base_credit)::text AS net_base_debit
  FROM members m
  JOIN public.journal_entries e ON e.id = m.entry_id AND e.status = 'posted'
  JOIN public.journal_entry_lines l ON l.entry_id = e.id
  GROUP BY m.target_id, e.company_id, l.account_id
)
SELECT f.id AS reversal_of, f.company_id, o.data AS original, f.issue_codes,
  coalesce((
    SELECT jsonb_agg(ev.data ORDER BY e.id)
    FROM public.journal_entries e JOIN evidence ev ON ev.id = e.id
    WHERE e.reversal_of = f.id
  ), '[]'::jsonb) AS reversals,
  coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'company_id', gl.company_id, 'account_id', gl.account_id,
      'base_debit', gl.base_debit, 'base_credit', gl.base_credit,
      'net_base_debit', gl.net_base_debit
    ) ORDER BY gl.company_id, gl.account_id) FROM gl WHERE gl.target_id = f.id
  ), '[]'::jsonb) AS gl_posted_net_by_company_account
FROM flagged f LEFT JOIN evidence o ON o.id = f.id
ORDER BY f.company_id NULLS LAST, f.id
`;

/** Own one consistent snapshot; PostgreSQL itself prohibits financial writes. */
export async function auditJournalReversals(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const { rows } = await client.query<ReversalFinding>(auditSql);
    await client.query("ROLLBACK");
    return {
      read_only: true,
      finding_count: rows.length,
      issue_descriptions: issueDescriptions,
      gl_note: "GL يشمل status=posted فقط. المبالغ نصوص دقيقة بالعملة الأساسية لكل شركة وحساب، وتشمل الأصل والمقابلات المباشرة فقط. الصفر لا يثبت سلامة البيانات؛ النتائج ليست قيود إصلاح ولا تجمع بين الشركات أو بين المجموعات المتداخلة.",
      findings: rows,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
