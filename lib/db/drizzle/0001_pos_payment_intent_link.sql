ALTER TABLE "payment_intents" ADD COLUMN IF NOT EXISTS "pos_order_id" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_intents_pos_order_id_idx" ON "payment_intents" USING btree ("pos_order_id");
