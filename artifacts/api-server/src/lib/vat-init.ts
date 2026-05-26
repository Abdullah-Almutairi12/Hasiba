import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Boot-time idempotent migration for the ZATCA SMB compliance suite.
 * Adds the VAT registration status + threshold-alert timestamp columns
 * to `companies`. Existing tenants default to `registered` so behaviour
 * does not change. New tenants pick their status during onboarding.
 */
export async function initVatRegistration(): Promise<void> {
  await pool.query(`
    ALTER TABLE companies
      ADD COLUMN IF NOT EXISTS vat_registration_status text NOT NULL DEFAULT 'registered',
      ADD COLUMN IF NOT EXISTS vat_registration_date timestamp,
      ADD COLUMN IF NOT EXISTS vat_threshold_80_alerted_at timestamp,
      ADD COLUMN IF NOT EXISTS vat_threshold_100_alerted_at timestamp;
  `);
  logger.info("VAT registration columns ready on companies");
}
