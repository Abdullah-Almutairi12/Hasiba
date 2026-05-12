import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  numeric,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { branchesTable } from "./branches";
import { invoicesTable } from "./invoices";
import { customersTable } from "./customers";

// =============================================================
// External credentials — encrypted-at-rest connector secrets
// scoped per company (branch_id is the closest tenant key today
// until task #8 — Multi-Company — lands).
// =============================================================
export const externalCredentialsTable = pgTable(
  "external_credentials",
  {
    id: serial("id").primaryKey(),
    branchId: integer("branch_id").references(() => branchesTable.id, {
      onDelete: "cascade",
    }),
    // e.g. "zatca", "moyasar", "tap", "hyperpay", "stcpay", "mada",
    // "paytabs", "smsa", "aramex", "saee", "naqel", "whatsapp",
    // "unifonic", "mobily", "taqnyat".
    provider: text("provider").notNull(),
    // Free-form display label so the user can run two Moyasar
    // accounts side-by-side ("Riyadh till" vs "Jeddah till").
    label: text("label"),
    environment: text("environment").notNull().default("sandbox"), // sandbox | production
    // AES-256-GCM ciphertext (base64). Decrypted only on egress to
    // the third-party provider; never returned via REST.
    secretCiphertext: text("secret_ciphertext").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("external_credentials_branch_provider_label_idx").on(
      t.branchId,
      t.provider,
      t.label,
    ),
    index("external_credentials_provider_idx").on(t.provider),
  ],
);

// =============================================================
// ZATCA Phase 2 (Fatoora) — onboarding artefacts and submissions
// =============================================================
export const zatcaCertificatesTable = pgTable("zatca_certificates", {
  id: serial("id").primaryKey(),
  branchId: integer("branch_id").references(() => branchesTable.id, {
    onDelete: "cascade",
  }),
  environment: text("environment").notNull().default("sandbox"),
  // CSR submitted to ZATCA portal (PEM). Kept for audit & re-issue.
  csrPem: text("csr_pem").notNull(),
  // Compliance Cryptographic Stamp ID (returned after CSR upload).
  csid: text("csid"),
  // Production CSID (returned after compliance call set passes).
  pcsid: text("pcsid"),
  certificatePem: text("certificate_pem"),
  // Encrypted ECDSA private key used to sign each invoice.
  privateKeyCiphertext: text("private_key_ciphertext"),
  // Last-known status: pending_csr | compliance | active | revoked
  status: text("status").notNull().default("pending_csr"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const zatcaInvoicesTable = pgTable(
  "zatca_invoices",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoicesTable.id, { onDelete: "cascade" }),
    // Branch the invoice was issued from. The PIH chain MUST be
    // walked per branch (one EGS per branch), so this column is
    // the scope key — null only for the very first invoice during
    // bootstrap.
    branchId: integer("branch_id").references(() => branchesTable.id, {
      onDelete: "set null",
    }),
    // standard => clearance, simplified => reporting
    invoiceType: text("invoice_type").notNull().default("simplified"),
    uuid: text("uuid").notNull(),
    // Previous-Invoice-Hash chain (base64 SHA-256). Empty string for
    // the first invoice; ZATCA validates this chain server-side.
    pih: text("pih"),
    invoiceHash: text("invoice_hash"),
    xmlPayload: text("xml_payload").notNull(),
    signatureBase64: text("signature_base64"),
    qrTlvBase64: text("qr_tlv_base64"),
    // pending | cleared | reported | rejected | retrying
    status: text("status").notNull().default("pending"),
    clearanceStatus: text("clearance_status"),
    zatcaResponse: jsonb("zatca_response"),
    rejectionReason: text("rejection_reason"),
    submittedAt: timestamp("submitted_at"),
    clearedAt: timestamp("cleared_at"),
    retryCount: integer("retry_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("zatca_invoices_invoice_id_idx").on(t.invoiceId),
    index("zatca_invoices_status_idx").on(t.status),
    index("zatca_invoices_branch_idx").on(t.branchId),
  ],
);

// =============================================================
// Payment gateways — registered providers + intents/receipts
// =============================================================
export const paymentGatewaysTable = pgTable(
  "payment_gateways",
  {
    id: serial("id").primaryKey(),
    branchId: integer("branch_id").references(() => branchesTable.id, {
      onDelete: "cascade",
    }),
    // mada | stcpay | tap | hyperpay | moyasar | paytabs
    provider: text("provider").notNull(),
    displayName: text("display_name").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    environment: text("environment").notNull().default("sandbox"),
    // GL accounts the receipt will post against.
    bankAccountKey: text("bank_account_key").notNull().default("bank"),
    clearingAccountKey: text("clearing_account_key").notNull().default("clearing"),
    // Public webhook secret used to verify provider callbacks.
    webhookSecret: text("webhook_secret"),
    settings: jsonb("settings"), // provider-specific config (currency, MCC, etc.)
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_gateways_branch_provider_idx").on(t.branchId, t.provider),
  ],
);

export const paymentIntentsTable = pgTable(
  "payment_intents",
  {
    id: serial("id").primaryKey(),
    gatewayId: integer("gateway_id")
      .notNull()
      .references(() => paymentGatewaysTable.id),
    // Cross-reference to the source document the customer is paying.
    invoiceId: integer("invoice_id").references(() => invoicesTable.id),
    customerId: integer("customer_id").references(() => customersTable.id),
    // Provider-side ID for reconciliation (e.g. moyasar payment id).
    providerRef: text("provider_ref"),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("SAR"),
    // pending | authorized | captured | failed | refunded
    status: text("status").notNull().default("pending"),
    checkoutUrl: text("checkout_url"),
    failureReason: text("failure_reason"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("payment_intents_status_idx").on(t.status),
    index("payment_intents_provider_ref_idx").on(t.providerRef),
  ],
);

// =============================================================
// Shipping carriers — registered carriers + shipments
// =============================================================
export const shippingCarriersTable = pgTable(
  "shipping_carriers",
  {
    id: serial("id").primaryKey(),
    branchId: integer("branch_id").references(() => branchesTable.id, {
      onDelete: "cascade",
    }),
    // smsa | aramex | saee | naqel
    provider: text("provider").notNull(),
    displayName: text("display_name").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    environment: text("environment").notNull().default("sandbox"),
    accountNumber: text("account_number"),
    settings: jsonb("settings"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("shipping_carriers_branch_provider_idx").on(t.branchId, t.provider),
  ],
);

export const shipmentsTable = pgTable(
  "shipments",
  {
    id: serial("id").primaryKey(),
    carrierId: integer("carrier_id")
      .notNull()
      .references(() => shippingCarriersTable.id),
    // Reference to the delivery order (loose link until DO module lands)
    deliveryOrderRef: text("delivery_order_ref"),
    customerId: integer("customer_id").references(() => customersTable.id),
    awbNumber: text("awb_number"),
    labelUrl: text("label_url"),
    // created | in_transit | delivered | returned | cancelled
    status: text("status").notNull().default("created"),
    trackingHistory: jsonb("tracking_history"),
    weightKg: numeric("weight_kg", { precision: 8, scale: 3 }),
    pieces: integer("pieces").notNull().default(1),
    cod: numeric("cod", { precision: 14, scale: 2 }),
    fromAddress: jsonb("from_address"),
    toAddress: jsonb("to_address").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("shipments_awb_idx").on(t.awbNumber),
    index("shipments_status_idx").on(t.status),
  ],
);

// =============================================================
// WhatsApp templates + outbound message log (covers WhatsApp/SMS)
// =============================================================
export const whatsappTemplatesTable = pgTable(
  "whatsapp_templates",
  {
    id: serial("id").primaryKey(),
    branchId: integer("branch_id").references(() => branchesTable.id, {
      onDelete: "cascade",
    }),
    // Template name as registered with Meta.
    name: text("name").notNull(),
    languageCode: text("language_code").notNull().default("ar"),
    category: text("category").notNull().default("UTILITY"), // UTILITY | MARKETING | AUTHENTICATION
    bodyTemplate: text("body_template").notNull(),
    variableHints: jsonb("variable_hints"), // [{name, example}]
    // pending | approved | rejected | paused
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("whatsapp_templates_branch_name_lang_idx").on(
      t.branchId,
      t.name,
      t.languageCode,
    ),
  ],
);

export const outboundMessagesTable = pgTable(
  "outbound_messages",
  {
    id: serial("id").primaryKey(),
    branchId: integer("branch_id").references(() => branchesTable.id),
    // whatsapp | sms
    channel: text("channel").notNull(),
    provider: text("provider").notNull(),
    toNumber: text("to_number").notNull(),
    templateName: text("template_name"),
    body: text("body").notNull(),
    variables: jsonb("variables"),
    // queued | sent | delivered | failed
    status: text("status").notNull().default("queued"),
    providerRef: text("provider_ref"),
    errorMessage: text("error_message"),
    cost: numeric("cost", { precision: 10, scale: 4 }),
    sentAt: timestamp("sent_at"),
    deliveredAt: timestamp("delivered_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("outbound_messages_channel_status_idx").on(t.channel, t.status),
    index("outbound_messages_to_idx").on(t.toNumber),
  ],
);

// =============================================================
// Audit trail of every outbound third-party API call.
// =============================================================
export const integrationCallsTable = pgTable(
  "integration_calls",
  {
    id: serial("id").primaryKey(),
    branchId: integer("branch_id").references(() => branchesTable.id),
    provider: text("provider").notNull(),
    direction: text("direction").notNull().default("outbound"), // outbound | inbound
    endpoint: text("endpoint").notNull(),
    method: text("method").notNull(),
    requestSummary: jsonb("request_summary"),
    responseSummary: jsonb("response_summary"),
    statusCode: integer("status_code"),
    durationMs: integer("duration_ms"),
    success: boolean("success").notNull().default(true),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("integration_calls_provider_created_idx").on(t.provider, t.createdAt),
    index("integration_calls_success_idx").on(t.success),
  ],
);
