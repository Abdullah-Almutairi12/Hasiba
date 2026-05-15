CREATE TABLE IF NOT EXISTS "company_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_en" text,
	"name_ar" text,
	"vat_number" text,
	"address" text,
	"phone" text,
	"email" text,
	"logo_object_key" text,
	"bank_name" text,
	"bank_iban" text,
	"terms_en" text,
	"terms_ar" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "company_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
