#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Multi-Company Phase 1: provision companies tables + companyId columns
# via raw SQL before drizzle push, so push sees no new work for them.
pnpm --filter @workspace/scripts run backfill-multi-company
pnpm --filter db run push-force
