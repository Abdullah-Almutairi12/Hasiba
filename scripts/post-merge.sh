#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db run push-force
# Multi-Company Phase 1: seed default company + backfill company_id on
# every existing row. Runs AFTER drizzle push so the columns/FKs are
# already in place. The script is idempotent and safe to re-run.
pnpm --filter @workspace/scripts run backfill-multi-company

# Refresh user-manual screenshots from the live ERP. The capture
# script never throws — missing Playwright or missing credentials
# just print a warning and skip — so post-merge stays green.
pnpm --filter @workspace/scripts run capture-docs-screenshots || true
