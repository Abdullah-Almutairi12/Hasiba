#!/bin/bash
set -euo pipefail
pnpm install --frozen-lockfile
# Applying reviewed source changes must not implicitly mutate the default
# database or authenticate a documentation browser against ordinary data.
# Schema upgrades/backfills belong to an explicitly authorized, separately
# verified operation targeting the intended environment. In particular, the
# meeting demo uses a held synthetic database, not the default DATABASE_URL.
printf '%s\n' \
  'Dependencies reconciled. No database schema push, backfill, or authenticated documentation capture was run.' \
  'Any required database upgrade remains a separate explicit operation; this hook does not certify migration readiness.'
