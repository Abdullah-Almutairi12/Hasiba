CREATE TABLE "branches" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"city" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"sku" text NOT NULL,
	"category_id" integer NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"cost_price" numeric(10, 2) NOT NULL,
	"stock" numeric(18, 4) DEFAULT '0' NOT NULL,
	"min_stock" integer DEFAULT 5 NOT NULL,
	"unit" text DEFAULT 'piece' NOT NULL,
	"image_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"barcode" text,
	"tracking_mode" text DEFAULT 'none' NOT NULL,
	"costing_method" text DEFAULT 'average' NOT NULL,
	"is_variant_parent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"total_orders" integer DEFAULT 0 NOT NULL,
	"total_spent" numeric(10, 2) DEFAULT '0' NOT NULL,
	"segment" text DEFAULT 'retail' NOT NULL,
	"default_pricelist_id" integer,
	"payment_terms_days" integer DEFAULT 0 NOT NULL,
	"credit_limit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tax_number" text,
	"billing_address" text,
	"shipping_address" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_order_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"method" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"reference" text,
	"payer_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"session_id" integer NOT NULL,
	"customer_id" integer,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal" numeric(10, 2) NOT NULL,
	"tax" numeric(10, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"total" numeric(10, 2) NOT NULL,
	"payment_method" text DEFAULT 'cash' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pos_orders_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
CREATE TABLE "pos_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_number" text NOT NULL,
	"branch_id" integer NOT NULL,
	"cashier_name" text NOT NULL,
	"opening_cash" numeric(10, 2) DEFAULT '0' NOT NULL,
	"total_sales" numeric(10, 2) DEFAULT '0' NOT NULL,
	"orders_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	CONSTRAINT "pos_sessions_session_number_unique" UNIQUE("session_number")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"vat_number" text,
	"email" text,
	"phone" text,
	"address" text,
	"balance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"payment_terms_days" integer DEFAULT 30 NOT NULL,
	"default_currency" text DEFAULT 'SAR' NOT NULL,
	"lead_time_days" integer DEFAULT 7 NOT NULL,
	"default_tax" numeric(5, 2) DEFAULT '15' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_vat_number_unique" UNIQUE("vat_number")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_number" text NOT NULL,
	"supplier_id" integer,
	"supplier_name" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"confidence" real,
	"file_url" text,
	"invoice_date" timestamp,
	"due_date" timestamp,
	"po_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"type" text NOT NULL,
	"parent_id" integer,
	"is_group" boolean DEFAULT false NOT NULL,
	"currency_code" text DEFAULT 'SAR' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"description" text,
	"system_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_code_unique" UNIQUE("code"),
	CONSTRAINT "accounts_system_key_unique" UNIQUE("system_key")
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"bank_name" text NOT NULL,
	"account_number" text NOT NULL,
	"iban" text,
	"currency_code" text DEFAULT 'SAR' NOT NULL,
	"gl_account_id" integer NOT NULL,
	"opening_balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_statement_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"statement_id" integer NOT NULL,
	"tx_date" date NOT NULL,
	"description" text NOT NULL,
	"reference" text,
	"amount" numeric(18, 2) NOT NULL,
	"matched_line_id" integer,
	"reconciled_at" timestamp,
	"reconciled_by" integer
);
--> statement-breakpoint
CREATE TABLE "bank_statements" (
	"id" serial PRIMARY KEY NOT NULL,
	"bank_account_id" integer NOT NULL,
	"statement_date" date NOT NULL,
	"starting_balance" numeric(18, 2) NOT NULL,
	"ending_balance" numeric(18, 2) NOT NULL,
	"file_name" text,
	"imported_by" integer,
	"imported_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "currencies" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"symbol" text NOT NULL,
	"decimals" integer DEFAULT 2 NOT NULL,
	"is_base" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_currency" text NOT NULL,
	"to_currency" text NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	"rate_date" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiscal_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"fiscal_year_id" integer NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp,
	"closed_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiscal_years" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp,
	"closed_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_number" text NOT NULL,
	"entry_date" date NOT NULL,
	"period_id" integer,
	"description" text NOT NULL,
	"reference" text,
	"currency_code" text DEFAULT 'SAR' NOT NULL,
	"exchange_rate" numeric(18, 8) DEFAULT '1' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_ref" text,
	"created_by" integer,
	"posted_by" integer,
	"posted_at" timestamp,
	"reversed_by" integer,
	"reversed_at" timestamp,
	"reversal_of" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_entry_number_unique" UNIQUE("entry_number")
);
--> statement-breakpoint
CREATE TABLE "journal_entry_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_id" integer NOT NULL,
	"line_number" integer NOT NULL,
	"account_id" integer NOT NULL,
	"description" text,
	"debit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"base_debit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"base_credit" numeric(18, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"phone" text,
	"role" text NOT NULL,
	"branch_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"has_2fa" boolean DEFAULT false NOT NULL,
	"avatar_url" text,
	"last_login_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_scrap" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"user_name" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"details" text,
	"ip_address" text,
	"severity" text DEFAULT 'info' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"assignee_id" integer,
	"status" text DEFAULT 'todo' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"due_date" date,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"customer_id" integer,
	"manager_id" integer,
	"status" text DEFAULT 'planning' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"budget" numeric(12, 2) DEFAULT '0' NOT NULL,
	"spent" numeric(12, 2) DEFAULT '0' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"start_date" date,
	"due_date" date,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"budget" numeric(12, 2) DEFAULT '0' NOT NULL,
	"spent" numeric(12, 2) DEFAULT '0' NOT NULL,
	"reach" integer DEFAULT 0 NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"start_date" date,
	"end_date" date,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"phone" text,
	"company" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"campaign_id" integer,
	"owner_id" integer,
	"status" text DEFAULT 'new' NOT NULL,
	"estimated_value" numeric(12, 2) DEFAULT '0' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"type" text DEFAULT 'info' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"created_by_user_id" integer
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flags_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"reply" text,
	"assigned_to_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ai_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'general' NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"accuracy" real,
	"training_size" integer,
	"parameters" jsonb,
	"last_trained_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_models_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "product_variant_attributes" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"values" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"sku" text NOT NULL,
	"barcode" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"price" numeric(10, 2),
	"cost_price" numeric(10, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "reorder_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"min_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"max_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"eoq" numeric(18, 4) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_lots" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"lot_number" text NOT NULL,
	"expiry_date" date,
	"supplier_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_moves" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"variant_id" integer,
	"from_warehouse_id" integer,
	"to_warehouse_id" integer,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"lot_id" integer,
	"serial_id" integer,
	"kind" text NOT NULL,
	"state" text DEFAULT 'done' NOT NULL,
	"source_type" text,
	"source_id" integer,
	"source_ref" text,
	"journal_entry_id" integer,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "stock_quants" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"variant_id" integer,
	"warehouse_id" integer NOT NULL,
	"lot_id" integer,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"avg_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_serials" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"serial_number" text NOT NULL,
	"current_warehouse_id" integer,
	"state" text DEFAULT 'in_stock' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_take_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"stock_take_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"variant_id" integer,
	"lot_id" integer,
	"expected_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"counted_qty" numeric(18, 4),
	"unit_cost" numeric(18, 4) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_takes" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"warehouse_id" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"completed_by" integer,
	"created_by" integer,
	CONSTRAINT "stock_takes_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "blanket_agreement_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"agreement_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"agreed_price" numeric(18, 4) NOT NULL,
	"agreed_qty" numeric(18, 4) NOT NULL,
	"released_qty" numeric(18, 4) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blanket_agreements" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"supplier_id" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"total_committed_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"released_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "blanket_agreements_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "goods_receipt_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"grn_id" integer NOT NULL,
	"po_line_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_cost" numeric(18, 4) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"po_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"received_by" integer,
	"notes" text,
	CONSTRAINT "goods_receipts_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "payment_run_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"invoice_id" integer,
	"amount" numeric(18, 2) NOT NULL,
	"journal_entry_id" integer
);
--> statement-breakpoint
CREATE TABLE "payment_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"payment_date" date NOT NULL,
	"payment_method" text DEFAULT 'bank' NOT NULL,
	"bank_account_id" integer,
	"total_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_by" integer,
	"executed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_runs_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"po_id" integer NOT NULL,
	"product_id" integer,
	"description" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"received_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"billed_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '15' NOT NULL,
	"line_total" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"supplier_id" integer NOT NULL,
	"supplier_name" text NOT NULL,
	"warehouse_id" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"order_date" date NOT NULL,
	"expected_date" date,
	"currency_code" text DEFAULT 'SAR' NOT NULL,
	"exchange_rate" numeric(18, 8) DEFAULT '1' NOT NULL,
	"subtotal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"requisition_id" integer,
	"rfq_id" integer,
	"agreement_id" integer,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "purchase_requisition_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"requisition_id" integer NOT NULL,
	"product_id" integer,
	"description" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"estimated_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"needed_by" date
);
--> statement-breakpoint
CREATE TABLE "purchase_requisitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"requester_id" integer,
	"branch_id" integer,
	"warehouse_id" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"approved_by" integer,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_requisitions_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "rfq_quote_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"rfq_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"product_id" integer,
	"description" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"lead_time_days" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfq_suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"rfq_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"sent_at" timestamp,
	"responded_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "rfqs" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"requisition_id" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"due_date" date,
	"notes" text,
	"awarded_supplier_id" integer,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rfqs_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "commission_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"quota" numeric(18, 2) DEFAULT '0' NOT NULL,
	"bonus_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_note_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"note_id" integer NOT NULL,
	"invoice_line_id" integer,
	"product_id" integer,
	"description" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '15' NOT NULL,
	"line_total" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"invoice_id" integer,
	"customer_id" integer NOT NULL,
	"customer_name" text NOT NULL,
	"note_date" date NOT NULL,
	"reason" text,
	"restock" boolean DEFAULT true NOT NULL,
	"warehouse_id" integer,
	"currency_code" text DEFAULT 'SAR' NOT NULL,
	"subtotal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"journal_entry_id" integer,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "customer_invoice_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"so_line_id" integer,
	"product_id" integer,
	"description" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '15' NOT NULL,
	"line_total" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"so_id" integer,
	"customer_id" integer NOT NULL,
	"customer_name" text NOT NULL,
	"branch_id" integer,
	"sales_rep_id" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date,
	"currency_code" text DEFAULT 'SAR' NOT NULL,
	"subtotal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"amount_paid" numeric(18, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"zatca_qr" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_ref" text,
	"applied_discounts" jsonb,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customer_invoices_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "customer_receipt_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"receipt_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"amount" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"customer_id" integer NOT NULL,
	"customer_name" text NOT NULL,
	"receipt_date" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency_code" text DEFAULT 'SAR' NOT NULL,
	"payment_method" text DEFAULT 'cash' NOT NULL,
	"bank_ref" text,
	"journal_entry_id" integer,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customer_receipts_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "delivery_order_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"do_id" integer NOT NULL,
	"so_line_id" integer NOT NULL,
	"product_id" integer,
	"description" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"so_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"delivery_date" date NOT NULL,
	"notes" text,
	"created_by" integer,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_orders_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "discount_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"kind" text DEFAULT 'percent' NOT NULL,
	"value" numeric(18, 4) DEFAULT '0' NOT NULL,
	"scope" text DEFAULT 'line' NOT NULL,
	"reason_code" text NOT NULL,
	"account_system_key" text DEFAULT 'sales_discount' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"customer_id" integer,
	"customer_name" text,
	"lead_id" integer,
	"sales_rep_id" integer,
	"stage_id" integer NOT NULL,
	"expected_revenue" numeric(18, 2) DEFAULT '0' NOT NULL,
	"probability" integer DEFAULT 0 NOT NULL,
	"expected_close_date" date,
	"closed_at" timestamp,
	"win_loss_reason" text,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_stages" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"probability" integer DEFAULT 0 NOT NULL,
	"is_won" boolean DEFAULT false NOT NULL,
	"is_lost" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricelist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"pricelist_id" integer NOT NULL,
	"product_id" integer,
	"min_quantity" numeric(18, 4) DEFAULT '1' NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"discount_pct" numeric(5, 2)
);
--> statement-breakpoint
CREATE TABLE "pricelists" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"currency_code" text DEFAULT 'SAR' NOT NULL,
	"segment" text,
	"start_date" date,
	"end_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"quotation_id" integer NOT NULL,
	"product_id" integer,
	"description" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '15' NOT NULL,
	"line_total" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"customer_id" integer NOT NULL,
	"customer_name" text NOT NULL,
	"pricelist_id" integer,
	"sales_rep_id" integer,
	"branch_id" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"quote_date" date NOT NULL,
	"valid_until" date,
	"currency_code" text DEFAULT 'SAR' NOT NULL,
	"subtotal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"sent_at" timestamp,
	"accepted_at" timestamp,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"applied_discounts" jsonb,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quotations_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "sales_order_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"so_id" integer NOT NULL,
	"product_id" integer,
	"description" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"delivered_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"invoiced_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '15' NOT NULL,
	"line_total" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"quotation_id" integer,
	"customer_id" integer NOT NULL,
	"customer_name" text NOT NULL,
	"pricelist_id" integer,
	"sales_rep_id" integer,
	"branch_id" integer,
	"warehouse_id" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"order_date" date NOT NULL,
	"expected_date" date,
	"currency_code" text DEFAULT 'SAR' NOT NULL,
	"subtotal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"applied_discounts" jsonb,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sales_orders_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "sales_rep_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"plan_id" integer NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_punches" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"punch_at" timestamp NOT NULL,
	"direction" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"device_id" text,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"employee_id" integer NOT NULL,
	"contract_type" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"probation_months" integer DEFAULT 3 NOT NULL,
	"notice_period_days" integer DEFAULT 30 NOT NULL,
	"basic_salary" numeric(18, 2) NOT NULL,
	"housing_allowance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"transport_allowance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"other_allowances" numeric(18, 2) DEFAULT '0' NOT NULL,
	"gosi_category" text DEFAULT 'civil' NOT NULL,
	"gosi_applies" boolean DEFAULT true NOT NULL,
	"working_hours_per_week" integer DEFAULT 48 NOT NULL,
	"annual_leave_days" integer DEFAULT 21 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"document_url" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"parent_id" integer,
	"manager_employee_id" integer,
	"branch_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"doc_type" text NOT NULL,
	"title" text NOT NULL,
	"file_url" text NOT NULL,
	"expiry_date" date,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_loans" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"employee_id" integer NOT NULL,
	"kind" text DEFAULT 'loan' NOT NULL,
	"principal" numeric(18, 2) NOT NULL,
	"monthly_installment" numeric(18, 2) NOT NULL,
	"outstanding" numeric(18, 2) NOT NULL,
	"start_date" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reason" text,
	"approved_by" integer,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "employee_loans_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "employee_shifts" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_no" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"nationality_type" text DEFAULT 'saudi' NOT NULL,
	"nationality" text DEFAULT 'SA' NOT NULL,
	"national_id" text,
	"iqama_expiry" date,
	"passport_no" text,
	"passport_expiry" date,
	"date_of_birth" date,
	"gender" text,
	"marital_status" text,
	"email" text,
	"phone" text,
	"address" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"photo_url" text,
	"branch_id" integer,
	"department_id" integer,
	"position_id" integer,
	"manager_employee_id" integer,
	"user_id" integer,
	"bank_name" text,
	"bank_iban" text,
	"bank_account_no" text,
	"hire_date" date NOT NULL,
	"termination_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "employees_employee_no_unique" UNIQUE("employee_no")
);
--> statement-breakpoint
CREATE TABLE "gosi_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"effective_from" date NOT NULL,
	"saudi_employee_rate" numeric(5, 2) DEFAULT '9.75' NOT NULL,
	"saudi_employer_rate" numeric(5, 2) DEFAULT '11.75' NOT NULL,
	"non_saudi_employer_rate" numeric(5, 2) DEFAULT '2.00' NOT NULL,
	"salary_ceiling" numeric(18, 2) DEFAULT '45000' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"leave_type_id" integer NOT NULL,
	"year" integer NOT NULL,
	"entitlement" numeric(8, 2) DEFAULT '0' NOT NULL,
	"used" numeric(8, 2) DEFAULT '0' NOT NULL,
	"pending" numeric(8, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"employee_id" integer NOT NULL,
	"leave_type_id" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" numeric(8, 2) NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "leave_requests_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"default_days_per_year" integer DEFAULT 0 NOT NULL,
	"is_paid" boolean DEFAULT true NOT NULL,
	"accrual_mode" text DEFAULT 'granted' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "leave_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "payroll_deductions" (
	"id" serial PRIMARY KEY NOT NULL,
	"line_id" integer NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"reference" text
);
--> statement-breakpoint
CREATE TABLE "payroll_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"contract_id" integer,
	"worked_days" numeric(8, 2) DEFAULT '30' NOT NULL,
	"lwp_days" numeric(8, 2) DEFAULT '0' NOT NULL,
	"overtime_hours" numeric(8, 2) DEFAULT '0' NOT NULL,
	"basic_salary" numeric(18, 2) DEFAULT '0' NOT NULL,
	"housing_allowance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"transport_allowance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"other_allowances" numeric(18, 2) DEFAULT '0' NOT NULL,
	"overtime_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"gross_pay" numeric(18, 2) DEFAULT '0' NOT NULL,
	"gosi_base" numeric(18, 2) DEFAULT '0' NOT NULL,
	"gosi_employee" numeric(18, 2) DEFAULT '0' NOT NULL,
	"gosi_employer" numeric(18, 2) DEFAULT '0' NOT NULL,
	"lwp_deduction" numeric(18, 2) DEFAULT '0' NOT NULL,
	"loan_deduction" numeric(18, 2) DEFAULT '0' NOT NULL,
	"other_deductions" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_deductions" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net_pay" numeric(18, 2) DEFAULT '0' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "payroll_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"pay_date" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"period_id" integer NOT NULL,
	"branch_id" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_gross" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_deductions" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_gosi_employee" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_gosi_employer" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_net" numeric(18, 2) DEFAULT '0' NOT NULL,
	"employee_count" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp,
	"approved_by" integer,
	"approved_at" timestamp,
	"posted_journal_id" integer,
	"posted_at" timestamp,
	"paid_at" timestamp,
	"payment_journal_id" integer,
	"gosi_journal_id" integer,
	"gosi_remitted_at" timestamp,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_runs_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"run_id" integer NOT NULL,
	"line_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"file_url" text,
	"emailed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payslips_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"title_ar" text NOT NULL,
	"department_id" integer,
	"level" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salary_components" (
	"id" serial PRIMARY KEY NOT NULL,
	"contract_id" integer NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"include_in_gosi" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"break_minutes" integer DEFAULT 60 NOT NULL,
	"working_days" text DEFAULT '0,1,2,3,4' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bom_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"bom_id" integer NOT NULL,
	"component_id" integer NOT NULL,
	"quantity_per" numeric(18, 4) NOT NULL,
	"unit" text DEFAULT 'piece' NOT NULL,
	"scrap_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "bom_qc_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"bom_id" integer NOT NULL,
	"operation_id" integer,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"is_mandatory" boolean DEFAULT true NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "boms" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '1' NOT NULL,
	"is_phantom" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"routing_id" integer,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "boms_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "quality_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"operation_id" integer,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"is_mandatory" boolean DEFAULT true NOT NULL,
	"result" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"checked_by" integer,
	"checked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routing_operations" (
	"id" serial PRIMARY KEY NOT NULL,
	"routing_id" integer NOT NULL,
	"sequence" integer DEFAULT 10 NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"work_center_id" integer NOT NULL,
	"duration_minutes" numeric(18, 2) DEFAULT '0' NOT NULL,
	"instructions" text
);
--> statement-breakpoint
CREATE TABLE "routings" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "routings_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "scrap_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"from_warehouse_id" integer NOT NULL,
	"to_warehouse_id" integer,
	"work_order_id" integer,
	"reworked_at" timestamp,
	"reason" text DEFAULT 'other' NOT NULL,
	"notes" text,
	"stock_move_id" integer,
	"journal_entry_id" integer,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scrap_records_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "work_centers" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"capacity_per_day" numeric(18, 4) DEFAULT '8' NOT NULL,
	"hourly_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_centers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "work_order_consumptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"component_id" integer NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"stock_move_id" integer,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_productions" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"stock_move_id" integer,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_reservations" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"component_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"consumed_qty" numeric(18, 4) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"bom_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"quantity_produced" numeric(18, 4) DEFAULT '0' NOT NULL,
	"warehouse_id" integer NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"planned_start" date,
	"planned_end" date,
	"started_at" timestamp,
	"completed_at" timestamp,
	"standard_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_by" integer,
	"completed_by" integer,
	"parent_work_order_id" integer,
	"is_rework" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_orders_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "approval_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"step_sequence" integer NOT NULL,
	"approver_user_id" integer,
	"approver_name" text,
	"action" text NOT NULL,
	"comment" text,
	"acted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_id" integer,
	"doc_type" text NOT NULL,
	"record_id" integer NOT NULL,
	"record_ref" text,
	"branch_id" integer,
	"amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"submitted_by_user_id" integer,
	"submitted_by_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"forced_steps" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "approval_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"doc_type" text NOT NULL,
	"branch_id" integer,
	"min_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"max_amount" numeric(18, 2),
	"mode" text DEFAULT 'sequential' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_id" integer NOT NULL,
	"sequence" integer DEFAULT 1 NOT NULL,
	"approver_role" text NOT NULL,
	"approver_user_id" integer,
	"min_amount" numeric(18, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approver_delegations" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_user_id" integer NOT NULL,
	"to_user_id" integer NOT NULL,
	"from_date" timestamp with time zone NOT NULL,
	"to_date" timestamp with time zone NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger" jsonb NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_id" integer NOT NULL,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"matched_records" integer DEFAULT 0 NOT NULL,
	"actions_executed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "financial_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"action_key" text NOT NULL,
	"max_value" numeric(18, 4),
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_inbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"link" text,
	"payload" jsonb,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer,
	"provider" text NOT NULL,
	"label" text,
	"environment" text DEFAULT 'sandbox' NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer,
	"provider" text NOT NULL,
	"direction" text DEFAULT 'outbound' NOT NULL,
	"endpoint" text NOT NULL,
	"method" text NOT NULL,
	"request_summary" jsonb,
	"response_summary" jsonb,
	"status_code" integer,
	"duration_ms" integer,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer,
	"channel" text NOT NULL,
	"provider" text NOT NULL,
	"to_number" text NOT NULL,
	"template_name" text,
	"body" text NOT NULL,
	"variables" jsonb,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_ref" text,
	"error_message" text,
	"cost" numeric(10, 4),
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_gateways" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer,
	"provider" text NOT NULL,
	"display_name" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"environment" text DEFAULT 'sandbox' NOT NULL,
	"bank_account_key" text DEFAULT 'bank' NOT NULL,
	"clearing_account_key" text DEFAULT 'clearing' NOT NULL,
	"webhook_secret" text,
	"settings" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" serial PRIMARY KEY NOT NULL,
	"gateway_id" integer NOT NULL,
	"invoice_id" integer,
	"customer_id" integer,
	"provider_ref" text,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"checkout_url" text,
	"failure_reason" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" serial PRIMARY KEY NOT NULL,
	"carrier_id" integer NOT NULL,
	"delivery_order_ref" text,
	"customer_id" integer,
	"awb_number" text,
	"label_url" text,
	"status" text DEFAULT 'created' NOT NULL,
	"tracking_history" jsonb,
	"weight_kg" numeric(8, 3),
	"pieces" integer DEFAULT 1 NOT NULL,
	"cod" numeric(14, 2),
	"from_address" jsonb,
	"to_address" jsonb NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipping_carriers" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer,
	"provider" text NOT NULL,
	"display_name" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"environment" text DEFAULT 'sandbox' NOT NULL,
	"account_number" text,
	"settings" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer,
	"name" text NOT NULL,
	"language_code" text DEFAULT 'ar' NOT NULL,
	"category" text DEFAULT 'UTILITY' NOT NULL,
	"body_template" text NOT NULL,
	"variable_hints" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zatca_certificates" (
	"id" serial PRIMARY KEY NOT NULL,
	"branch_id" integer,
	"environment" text DEFAULT 'sandbox' NOT NULL,
	"csr_pem" text NOT NULL,
	"csid" text,
	"pcsid" text,
	"certificate_pem" text,
	"private_key_ciphertext" text,
	"status" text DEFAULT 'pending_csr' NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zatca_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"invoice_type" text DEFAULT 'simplified' NOT NULL,
	"uuid" text NOT NULL,
	"pih" text,
	"invoice_hash" text,
	"xml_payload" text NOT NULL,
	"signature_base64" text,
	"qr_tlv_base64" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"clearance_status" text,
	"zatca_response" jsonb,
	"rejection_reason" text,
	"submitted_at" timestamp,
	"cleared_at" timestamp,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_order_payments" ADD CONSTRAINT "pos_order_payments_order_id_pos_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."pos_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_session_id_pos_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."pos_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_gl_account_id_accounts_id_fk" FOREIGN KEY ("gl_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_statement_id_bank_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."bank_statements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_matched_line_id_journal_entry_lines_id_fk" FOREIGN KEY ("matched_line_id") REFERENCES "public"."journal_entry_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_reconciled_by_users_id_fk" FOREIGN KEY ("reconciled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_from_currency_currencies_code_fk" FOREIGN KEY ("from_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_to_currency_currencies_code_fk" FOREIGN KEY ("to_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_period_id_fiscal_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_attributes" ADD CONSTRAINT "product_variant_attributes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_rules" ADD CONSTRAINT "reorder_rules_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_rules" ADD CONSTRAINT "reorder_rules_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_from_warehouse_id_warehouses_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_serial_id_stock_serials_id_fk" FOREIGN KEY ("serial_id") REFERENCES "public"."stock_serials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_quants" ADD CONSTRAINT "stock_quants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_quants" ADD CONSTRAINT "stock_quants_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_quants" ADD CONSTRAINT "stock_quants_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_serials" ADD CONSTRAINT "stock_serials_current_warehouse_id_warehouses_id_fk" FOREIGN KEY ("current_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_take_lines" ADD CONSTRAINT "stock_take_lines_stock_take_id_stock_takes_id_fk" FOREIGN KEY ("stock_take_id") REFERENCES "public"."stock_takes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_take_lines" ADD CONSTRAINT "stock_take_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_take_lines" ADD CONSTRAINT "stock_take_lines_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takes" ADD CONSTRAINT "stock_takes_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takes" ADD CONSTRAINT "stock_takes_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takes" ADD CONSTRAINT "stock_takes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blanket_agreement_items" ADD CONSTRAINT "blanket_agreement_items_agreement_id_blanket_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."blanket_agreements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blanket_agreement_items" ADD CONSTRAINT "blanket_agreement_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blanket_agreements" ADD CONSTRAINT "blanket_agreements_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_grn_id_goods_receipts_id_fk" FOREIGN KEY ("grn_id") REFERENCES "public"."goods_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_po_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_run_lines" ADD CONSTRAINT "payment_run_lines_run_id_payment_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payment_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_run_lines" ADD CONSTRAINT "payment_run_lines_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_run_lines" ADD CONSTRAINT "payment_run_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_runs" ADD CONSTRAINT "payment_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_requisition_id_purchase_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."purchase_requisitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_requisition_id_purchase_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."purchase_requisitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_quote_lines" ADD CONSTRAINT "rfq_quote_lines_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_quote_lines" ADD CONSTRAINT "rfq_quote_lines_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_quote_lines" ADD CONSTRAINT "rfq_quote_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_suppliers" ADD CONSTRAINT "rfq_suppliers_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_suppliers" ADD CONSTRAINT "rfq_suppliers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_requisition_id_purchase_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."purchase_requisitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_awarded_supplier_id_suppliers_id_fk" FOREIGN KEY ("awarded_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_note_id_credit_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."credit_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_invoice_line_id_customer_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."customer_invoice_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_customer_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."customer_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoice_lines" ADD CONSTRAINT "customer_invoice_lines_invoice_id_customer_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."customer_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoice_lines" ADD CONSTRAINT "customer_invoice_lines_so_line_id_sales_order_lines_id_fk" FOREIGN KEY ("so_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoice_lines" ADD CONSTRAINT "customer_invoice_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_so_id_sales_orders_id_fk" FOREIGN KEY ("so_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_sales_rep_id_users_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_receipt_allocations" ADD CONSTRAINT "customer_receipt_allocations_receipt_id_customer_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."customer_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_receipt_allocations" ADD CONSTRAINT "customer_receipt_allocations_invoice_id_customer_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."customer_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_order_lines" ADD CONSTRAINT "delivery_order_lines_do_id_delivery_orders_id_fk" FOREIGN KEY ("do_id") REFERENCES "public"."delivery_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_order_lines" ADD CONSTRAINT "delivery_order_lines_so_line_id_sales_order_lines_id_fk" FOREIGN KEY ("so_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_order_lines" ADD CONSTRAINT "delivery_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_so_id_sales_orders_id_fk" FOREIGN KEY ("so_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_orders" ADD CONSTRAINT "delivery_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_sales_rep_id_users_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_stage_id_opportunity_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."opportunity_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricelist_items" ADD CONSTRAINT "pricelist_items_pricelist_id_pricelists_id_fk" FOREIGN KEY ("pricelist_id") REFERENCES "public"."pricelists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricelist_items" ADD CONSTRAINT "pricelist_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_pricelist_id_pricelists_id_fk" FOREIGN KEY ("pricelist_id") REFERENCES "public"."pricelists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_sales_rep_id_users_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_so_id_sales_orders_id_fk" FOREIGN KEY ("so_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_pricelist_id_pricelists_id_fk" FOREIGN KEY ("pricelist_id") REFERENCES "public"."pricelists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_sales_rep_id_users_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_rep_assignments" ADD CONSTRAINT "sales_rep_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_rep_assignments" ADD CONSTRAINT "sales_rep_assignments_plan_id_commission_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."commission_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_deductions" ADD CONSTRAINT "payroll_deductions_line_id_payroll_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."payroll_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_line_id_payroll_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."payroll_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_components" ADD CONSTRAINT "salary_components_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_bom_id_boms_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."boms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_component_id_products_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_qc_templates" ADD CONSTRAINT "bom_qc_templates_bom_id_boms_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."boms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_qc_templates" ADD CONSTRAINT "bom_qc_templates_operation_id_routing_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."routing_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boms" ADD CONSTRAINT "boms_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boms" ADD CONSTRAINT "boms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_operation_id_routing_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."routing_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_operations" ADD CONSTRAINT "routing_operations_routing_id_routings_id_fk" FOREIGN KEY ("routing_id") REFERENCES "public"."routings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_operations" ADD CONSTRAINT "routing_operations_work_center_id_work_centers_id_fk" FOREIGN KEY ("work_center_id") REFERENCES "public"."work_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrap_records" ADD CONSTRAINT "scrap_records_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrap_records" ADD CONSTRAINT "scrap_records_from_warehouse_id_warehouses_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrap_records" ADD CONSTRAINT "scrap_records_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrap_records" ADD CONSTRAINT "scrap_records_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrap_records" ADD CONSTRAINT "scrap_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_consumptions" ADD CONSTRAINT "work_order_consumptions_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_consumptions" ADD CONSTRAINT "work_order_consumptions_component_id_products_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_productions" ADD CONSTRAINT "work_order_productions_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_reservations" ADD CONSTRAINT "work_order_reservations_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_reservations" ADD CONSTRAINT "work_order_reservations_component_id_products_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_reservations" ADD CONSTRAINT "work_order_reservations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_bom_id_boms_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."boms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_rule_id_approval_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."approval_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_rule_id_approval_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."approval_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_credentials" ADD CONSTRAINT "external_credentials_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_calls" ADD CONSTRAINT "integration_calls_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_gateways" ADD CONSTRAINT "payment_gateways_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_gateway_id_payment_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."payment_gateways"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_carrier_id_shipping_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."shipping_carriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_carriers" ADD CONSTRAINT "shipping_carriers_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zatca_certificates" ADD CONSTRAINT "zatca_certificates_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zatca_invoices" ADD CONSTRAINT "zatca_invoices_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_parent_idx" ON "accounts" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "accounts_type_idx" ON "accounts" USING btree ("type");--> statement-breakpoint
CREATE INDEX "bsl_stmt_idx" ON "bank_statement_lines" USING btree ("statement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_rates_unique" ON "exchange_rates" USING btree ("from_currency","to_currency","rate_date");--> statement-breakpoint
CREATE INDEX "fiscal_periods_year_idx" ON "fiscal_periods" USING btree ("fiscal_year_id");--> statement-breakpoint
CREATE INDEX "journal_entries_date_idx" ON "journal_entries" USING btree ("entry_date");--> statement-breakpoint
CREATE INDEX "journal_entries_status_idx" ON "journal_entries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "journal_entries_period_idx" ON "journal_entries" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "journal_entries_source_idx" ON "journal_entries" USING btree ("source","source_ref");--> statement-breakpoint
CREATE INDEX "jel_entry_idx" ON "journal_entry_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "jel_account_idx" ON "journal_entry_lines" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "product_variant_attrs_product_idx" ON "product_variant_attributes" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_variants_product_idx" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_variants_barcode_idx" ON "product_variants" USING btree ("barcode");--> statement-breakpoint
CREATE UNIQUE INDEX "reorder_rules_unique" ON "reorder_rules" USING btree ("product_id","warehouse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_lots_unique" ON "stock_lots" USING btree ("product_id","lot_number");--> statement-breakpoint
CREATE INDEX "stock_lots_expiry_idx" ON "stock_lots" USING btree ("expiry_date");--> statement-breakpoint
CREATE INDEX "stock_moves_product_idx" ON "stock_moves" USING btree ("product_id","occurred_at");--> statement-breakpoint
CREATE INDEX "stock_moves_from_idx" ON "stock_moves" USING btree ("from_warehouse_id");--> statement-breakpoint
CREATE INDEX "stock_moves_to_idx" ON "stock_moves" USING btree ("to_warehouse_id");--> statement-breakpoint
CREATE INDEX "stock_moves_kind_idx" ON "stock_moves" USING btree ("kind","state");--> statement-breakpoint
CREATE INDEX "stock_moves_source_idx" ON "stock_moves" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_quants_unique" ON "stock_quants" USING btree ("product_id","warehouse_id","variant_id","lot_id");--> statement-breakpoint
CREATE INDEX "stock_quants_warehouse_idx" ON "stock_quants" USING btree ("warehouse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_serials_unique" ON "stock_serials" USING btree ("product_id","serial_number");--> statement-breakpoint
CREATE INDEX "stock_take_lines_take_idx" ON "stock_take_lines" USING btree ("stock_take_id");--> statement-breakpoint
CREATE INDEX "customer_invoices_customer_idx" ON "customer_invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_invoices_status_idx" ON "customer_invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "customer_invoices_due_idx" ON "customer_invoices" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "cra_receipt_idx" ON "customer_receipt_allocations" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "cra_invoice_idx" ON "customer_receipt_allocations" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "opportunities_stage_idx" ON "opportunities" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "opportunities_rep_idx" ON "opportunities" USING btree ("sales_rep_id");--> statement-breakpoint
CREATE INDEX "pricelist_items_list_idx" ON "pricelist_items" USING btree ("pricelist_id");--> statement-breakpoint
CREATE INDEX "pricelist_items_product_idx" ON "pricelist_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "att_punches_emp_idx" ON "attendance_punches" USING btree ("employee_id","punch_at");--> statement-breakpoint
CREATE INDEX "employees_branch_idx" ON "employees" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "employees_dept_idx" ON "employees" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "employees_status_idx" ON "employees" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_balances_unique" ON "leave_balances" USING btree ("employee_id","leave_type_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_lines_run_emp_unique" ON "payroll_lines" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_periods_name_unique" ON "payroll_periods" USING btree ("name");--> statement-breakpoint
CREATE INDEX "bom_lines_bom_idx" ON "bom_lines" USING btree ("bom_id");--> statement-breakpoint
CREATE INDEX "bom_qc_templates_bom_idx" ON "bom_qc_templates" USING btree ("bom_id");--> statement-breakpoint
CREATE INDEX "boms_product_idx" ON "boms" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "quality_checks_wo_idx" ON "quality_checks" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "routing_ops_routing_idx" ON "routing_operations" USING btree ("routing_id","sequence");--> statement-breakpoint
CREATE INDEX "scrap_records_product_idx" ON "scrap_records" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "scrap_records_wo_idx" ON "scrap_records" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "wo_consumptions_wo_idx" ON "work_order_consumptions" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "wo_productions_wo_idx" ON "work_order_productions" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "wo_reservations_wo_idx" ON "work_order_reservations" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "work_orders_state_idx" ON "work_orders" USING btree ("state");--> statement-breakpoint
CREATE INDEX "work_orders_product_idx" ON "work_orders" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "approval_actions_req_idx" ON "approval_actions" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "approval_requests_status_idx" ON "approval_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "approval_requests_doc_idx" ON "approval_requests" USING btree ("doc_type","record_id");--> statement-breakpoint
CREATE INDEX "approval_rules_doc_idx" ON "approval_rules" USING btree ("doc_type","is_active");--> statement-breakpoint
CREATE INDEX "approval_steps_rule_idx" ON "approval_steps" USING btree ("rule_id","sequence");--> statement-breakpoint
CREATE INDEX "approver_delegations_from_idx" ON "approver_delegations" USING btree ("from_user_id","from_date","to_date");--> statement-breakpoint
CREATE INDEX "automation_runs_rule_idx" ON "automation_runs" USING btree ("rule_id","triggered_at");--> statement-breakpoint
CREATE INDEX "financial_limits_key_idx" ON "financial_limits" USING btree ("role","action_key");--> statement-breakpoint
CREATE INDEX "notification_inbox_user_idx" ON "notification_inbox" USING btree ("user_id","is_read","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "external_credentials_branch_provider_label_idx" ON "external_credentials" USING btree ("branch_id","provider","label");--> statement-breakpoint
CREATE INDEX "external_credentials_provider_idx" ON "external_credentials" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "integration_calls_provider_created_idx" ON "integration_calls" USING btree ("provider","created_at");--> statement-breakpoint
CREATE INDEX "integration_calls_success_idx" ON "integration_calls" USING btree ("success");--> statement-breakpoint
CREATE INDEX "outbound_messages_channel_status_idx" ON "outbound_messages" USING btree ("channel","status");--> statement-breakpoint
CREATE INDEX "outbound_messages_to_idx" ON "outbound_messages" USING btree ("to_number");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_gateways_branch_provider_idx" ON "payment_gateways" USING btree ("branch_id","provider");--> statement-breakpoint
CREATE INDEX "payment_intents_status_idx" ON "payment_intents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_intents_provider_ref_idx" ON "payment_intents" USING btree ("provider_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_awb_idx" ON "shipments" USING btree ("awb_number");--> statement-breakpoint
CREATE INDEX "shipments_status_idx" ON "shipments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "shipping_carriers_branch_provider_idx" ON "shipping_carriers" USING btree ("branch_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_templates_branch_name_lang_idx" ON "whatsapp_templates" USING btree ("branch_id","name","language_code");--> statement-breakpoint
CREATE UNIQUE INDEX "zatca_invoices_invoice_id_idx" ON "zatca_invoices" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "zatca_invoices_status_idx" ON "zatca_invoices" USING btree ("status");