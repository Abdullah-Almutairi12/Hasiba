ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "sent_to_supplier_at" timestamp;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "sent_to_supplier_email" text;
