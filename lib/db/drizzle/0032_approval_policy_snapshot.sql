-- Preserve previous requests and decisions. NULL is explicitly unverified,
-- not a reconstructed claim about which policy was reviewed historically.
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS policy_snapshot jsonb;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS review_invalidated_at timestamptz;

-- Legacy duplicates are preserved for review; all newly bound pending
-- requests are unique within their company/document scope.
CREATE UNIQUE INDEX IF NOT EXISTS approval_requests_bound_pending_unique
  ON approval_requests(company_id, doc_type, record_id)
  WHERE status = 'pending' AND policy_snapshot IS NOT NULL;
