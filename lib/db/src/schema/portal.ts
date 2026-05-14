import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// =========================================================================
// Portal auth — magic link invitations & portal-scoped sessions
// =========================================================================
//
// A `portal_invitation` is a single-use, time-bound token emailed to a
// counterparty (customer / supplier) or staff member (employee) inviting
// them to access the portal. When redeemed it materialises into a
// `portal_session`, which is the bearer-token session used for every
// portal API call. Portal sessions are STRICTLY separate from staff
// sessions — `requireAuth` (staff) rejects portal tokens and vice versa.

export const PORTAL_KINDS = ["customer", "supplier", "employee"] as const;
export type PortalKind = (typeof PORTAL_KINDS)[number];

export const portalInvitationsTable = pgTable(
  "portal_invitations",
  {
    id: serial("id").primaryKey(),
    portal: text("portal").notNull(), // customer | supplier | employee
    email: text("email").notNull(),
    // Logical principal id (customer.id, supplier.id, or employee.id).
    principalId: integer("principal_id").notNull(),
    tokenHash: text("token_hash").notNull(), // sha256 of opaque magic token
    purpose: text("purpose").notNull().default("magic_link"), // magic_link | otp
    code: text("code"), // 6-digit OTP code (hashed) if purpose=otp
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    tokenIdx: uniqueIndex("portal_invitations_token_idx").on(t.tokenHash),
    emailIdx: index("portal_invitations_email_idx").on(t.email),
  }),
);

export const portalSessionsTable = pgTable(
  "portal_sessions",
  {
    id: serial("id").primaryKey(),
    portal: text("portal").notNull(),
    principalId: integer("principal_id").notNull(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  },
  (t) => ({
    tokenIdx: uniqueIndex("portal_sessions_token_idx").on(t.tokenHash),
    principalIdx: index("portal_sessions_principal_idx").on(t.portal, t.principalId),
  }),
);

export const insertPortalInvitationSchema = createInsertSchema(
  portalInvitationsTable,
).omit({ id: true, createdAt: true, consumedAt: true });
export type PortalInvitation = typeof portalInvitationsTable.$inferSelect;
export type PortalSession = typeof portalSessionsTable.$inferSelect;

// =========================================================================
// Document Management System
// =========================================================================

export const documentFoldersTable = pgTable(
  "document_folders",
  {
    id: serial("id").primaryKey(),
    parentId: integer("parent_id"),
    name: text("name").notNull(),
    // Materialised path "/contracts/2026" for fast prefix search.
    path: text("path").notNull(),
    createdByUserId: integer("created_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    parentIdx: index("document_folders_parent_idx").on(t.parentId),
    pathIdx: uniqueIndex("document_folders_path_idx").on(t.path),
  }),
);

export const documentsTable = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    folderId: integer("folder_id"),
    name: text("name").notNull(),
    // Free-text tag list for search (lowercase, comma-separated).
    tags: text("tags").notNull().default(""),
    // Extracted text (from OCR or upload-time text extraction) used for
    // full-text search. NULL when not yet processed.
    extractedText: text("extracted_text"),
    currentVersion: integer("current_version").notNull().default(1),
    // Latest version object key + mime + size for fast list rendering.
    latestObjectKey: text("latest_object_key"),
    latestMime: text("latest_mime"),
    latestSize: bigint("latest_size", { mode: "number" }),
    createdByUserId: integer("created_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    folderIdx: index("documents_folder_idx").on(t.folderId),
    nameIdx: index("documents_name_idx").on(t.name),
  }),
);

export const documentVersionsTable = pgTable(
  "document_versions",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id").notNull(),
    version: integer("version").notNull(),
    objectKey: text("object_key").notNull(),
    mime: text("mime").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    checksum: text("checksum"),
    note: text("note"),
    uploadedByUserId: integer("uploaded_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    docIdx: index("document_versions_doc_idx").on(t.documentId),
    docVerIdx: uniqueIndex("document_versions_doc_ver_idx").on(t.documentId, t.version),
  }),
);

// ACLs scoped to a folder. role = "owner|manager|accountant|..." OR
// a portal role ("portal_customer", "portal_supplier", "portal_employee").
// access: "read" | "write".
export const documentAclsTable = pgTable(
  "document_acls",
  {
    id: serial("id").primaryKey(),
    folderId: integer("folder_id").notNull(),
    role: text("role").notNull(),
    access: text("access").notNull().default("read"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    folderRoleIdx: uniqueIndex("document_acls_folder_role_idx").on(t.folderId, t.role, t.access),
  }),
);

// Polymorphic record attachments — link a document to any business record
// (invoice, contract, payslip, project, ...).
export const documentAttachmentsTable = pgTable(
  "document_attachments",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id").notNull(),
    entityType: text("entity_type").notNull(), // "invoice" | "po" | "quotation" | "payslip" | ...
    entityId: integer("entity_id").notNull(),
    createdByUserId: integer("created_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    entityIdx: index("document_attachments_entity_idx").on(t.entityType, t.entityId),
    docIdx: index("document_attachments_doc_idx").on(t.documentId),
  }),
);

// =========================================================================
// E-signature
// =========================================================================

export const signatureRequestsTable = pgTable(
  "signature_requests",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id").notNull(),
    documentVersion: integer("document_version").notNull(),
    title: text("title").notNull(),
    message: text("message"),
    status: text("status").notNull().default("pending"), // pending | completed | cancelled | declined
    // Serial order: signers must sign in order asc. When all signed, status -> completed.
    orderedSigning: boolean("ordered_signing").notNull().default(true),
    // Object key of the produced signed PDF (filled when status=completed).
    signedObjectKey: text("signed_object_key"),
    createdByUserId: integer("created_by_user_id"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("signature_requests_status_idx").on(t.status),
    docIdx: index("signature_requests_doc_idx").on(t.documentId),
  }),
);

export const signatureSignersTable = pgTable(
  "signature_signers",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id").notNull(),
    seq: integer("seq").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    status: text("status").notNull().default("pending"), // pending | signed | declined
    signedAt: timestamp("signed_at"),
    signedIp: text("signed_ip"),
    signatureImage: text("signature_image"), // data: URL or object key
    declineReason: text("decline_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    tokenIdx: uniqueIndex("signature_signers_token_idx").on(t.tokenHash),
    reqSeqIdx: uniqueIndex("signature_signers_req_seq_idx").on(t.requestId, t.seq),
  }),
);

export const signatureAuditTable = pgTable(
  "signature_audit",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id").notNull(),
    signerId: integer("signer_id"),
    event: text("event").notNull(), // viewed | signed | declined | sent | completed | cancelled
    ip: text("ip"),
    userAgent: text("user_agent"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    reqIdx: index("signature_audit_req_idx").on(t.requestId),
  }),
);

export type DocumentRow = typeof documentsTable.$inferSelect;
export type DocumentFolderRow = typeof documentFoldersTable.$inferSelect;
export type DocumentVersionRow = typeof documentVersionsTable.$inferSelect;
export type DocumentAclRow = typeof documentAclsTable.$inferSelect;
export type DocumentAttachmentRow = typeof documentAttachmentsTable.$inferSelect;
export type SignatureRequestRow = typeof signatureRequestsTable.$inferSelect;
export type SignatureSignerRow = typeof signatureSignersTable.$inferSelect;
export type SignatureAuditRow = typeof signatureAuditTable.$inferSelect;

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  currentVersion: true,
});
export const insertDocumentFolderSchema = createInsertSchema(documentFoldersTable).omit({
  id: true,
  createdAt: true,
  path: true,
});
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type InsertDocumentFolder = z.infer<typeof insertDocumentFolderSchema>;
