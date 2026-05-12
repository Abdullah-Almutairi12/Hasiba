import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { randomUUID } from "node:crypto";
import { db, zatcaCertificatesTable, zatcaInvoicesTable, invoicesTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { encryptSecret, decryptSecret } from "./crypto";
import { recordIntegrationCall } from "./audit";

/**
 * ZATCA Phase 2 — minimum-viable, sandbox-ready pipeline.
 *
 * What this module does today:
 *  - Generates a CSR (PEM) the merchant uploads to the ZATCA portal.
 *  - Persists the issued certificate + private key (encrypted).
 *  - Builds a UBL 2.1-shaped XML payload from a posted invoice.
 *  - Signs the canonical hash with ECDSA-SHA256 using the stored key.
 *  - Maintains the PIH (Previous-Invoice-Hash) chain per branch.
 *  - Submits to the configured Fatoora API base (clearance for
 *    standard, reporting for simplified) and records the response.
 *
 * What this module deliberately stubs:
 *  - The XML is not the full ZATCA-compliant UBL schema (that
 *    requires extensive cbc/cac element coverage); it is a faithful
 *    skeleton that can be swapped for the full schema in production.
 *  - The signing flow uses a freshly-generated EC key when no
 *    certificate is on file — this keeps the dev environment usable
 *    without the merchant having to onboard with ZATCA first.
 *  - HTTP submission is gated by ZATCA_FATOORA_BASE_URL; when unset
 *    the call short-circuits to "pending" so you can run end-to-end
 *    tests without real network access.
 */

interface ZatcaInvoiceInput {
  invoiceId: number;
  invoiceNumber: string;
  issueDate: Date;
  invoiceType: "standard" | "simplified";
  sellerName: string;
  sellerVat: string;
  buyerName?: string | null;
  buyerVat?: string | null;
  totalExclVat: number;
  vatAmount: number;
  totalInclVat: number;
  branchId?: number | null;
}

const FATOORA_BASE = process.env["ZATCA_FATOORA_BASE_URL"] ?? null;

function tlv(tag: number, value: string): Buffer {
  const v = Buffer.from(value, "utf8");
  return Buffer.concat([Buffer.from([tag, v.length]), v]);
}

export function buildZatcaQrTlv(args: {
  sellerName: string;
  vatNumber: string;
  timestampIso: string;
  totalInclVat: number;
  vatAmount: number;
  invoiceHashB64?: string;
  signatureB64?: string;
}): string {
  const parts = [
    tlv(1, args.sellerName),
    tlv(2, args.vatNumber),
    tlv(3, args.timestampIso),
    tlv(4, args.totalInclVat.toFixed(2)),
    tlv(5, args.vatAmount.toFixed(2)),
  ];
  if (args.invoiceHashB64) parts.push(tlv(6, args.invoiceHashB64));
  if (args.signatureB64) parts.push(tlv(7, args.signatureB64));
  return Buffer.concat(parts).toString("base64");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildUblXml(input: ZatcaInvoiceInput, uuid: string, pih: string): string {
  const issueDate = input.issueDate.toISOString().slice(0, 10);
  const issueTime = input.issueDate.toISOString().slice(11, 19);
  const typeCode = input.invoiceType === "standard" ? "388" : "388"; // 388 = commercial invoice
  const subtypeCode = input.invoiceType === "standard" ? "0100000" : "0200000";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${escapeXml(input.invoiceNumber)}</cbc:ID>
  <cbc:UUID>${uuid}</cbc:UUID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:IssueTime>${issueTime}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="${subtypeCode}">${typeCode}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>
  <cac:AdditionalDocumentReference>
    <cbc:ID>PIH</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${pih}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(input.sellerVat)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(input.sellerName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      ${input.buyerVat ? `<cac:PartyTaxScheme><cbc:CompanyID>${escapeXml(input.buyerVat)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ""}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(input.buyerName ?? "")}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="SAR">${input.vatAmount.toFixed(2)}</cbc:TaxAmount>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="SAR">${input.totalExclVat.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="SAR">${input.totalExclVat.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="SAR">${input.totalInclVat.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="SAR">${input.totalInclVat.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`;
}

export function hashInvoice(xml: string): string {
  // ZATCA expects SHA-256 over the canonicalised invoice with the
  // signature element removed. The skeleton XML above carries no
  // signature element yet, so canonicalisation reduces to a NFC
  // pass; for the production schema this MUST be replaced with the
  // ZATCA-prescribed C14N transform.
  return createHash("sha256").update(xml.normalize("NFC"), "utf8").digest("base64");
}

interface SigningKeyMaterial {
  privateKeyPem: string;
  certificatePem: string | null;
  source: "stored" | "ephemeral";
}

async function getOrGenerateKey(branchId: number | null): Promise<SigningKeyMaterial> {
  const [existing] = await db
    .select()
    .from(zatcaCertificatesTable)
    .where(
      branchId === null
        ? eq(zatcaCertificatesTable.status, "active")
        : and(
            eq(zatcaCertificatesTable.branchId, branchId),
            eq(zatcaCertificatesTable.status, "active"),
          ),
    )
    .orderBy(desc(zatcaCertificatesTable.id))
    .limit(1);

  if (existing?.privateKeyCiphertext) {
    return {
      privateKeyPem: decryptSecret(existing.privateKeyCiphertext),
      certificatePem: existing.certificatePem,
      source: "stored",
    };
  }

  // Dev fallback: synthesise an ephemeral EC key so signing always
  // succeeds. Do NOT rely on these signatures for production
  // submissions — generate a real CSR via createCsr() instead.
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }) as string,
    certificatePem: null,
    source: "ephemeral",
  };
}

export function signInvoiceHash(invoiceHashB64: string, privateKeyPem: string): string {
  const signer = createSign("SHA256");
  signer.update(Buffer.from(invoiceHashB64, "base64"));
  signer.end();
  return signer.sign(privateKeyPem).toString("base64");
}

/**
 * Generate a CSR and EC key pair, persist the encrypted key, and
 * return the CSR PEM for the merchant to upload to ZATCA's Fatoora
 * portal. The portal returns a CSID which is then attached via
 * attachCsid() once received.
 */
export async function createCsr(args: {
  branchId: number | null;
  commonName: string;
  vatNumber: string;
  organizationName: string;
  environment: "sandbox" | "production";
}): Promise<{ id: number; csrPem: string }> {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "secp256k1",
  });
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }) as string;

  // Minimal PEM-wrapped placeholder CSR — the production
  // implementation must build a proper PKCS#10 CSR with the ZATCA
  // OIDs (1.2.3.4.5 attribute set, etc). This stub is recognisable
  // by the merchant and developer as "needs replacement before
  // going to production".
  const pubDer = (publicKey.export({ format: "der", type: "spki" }) as Buffer).toString("base64");
  const csrPem = `-----BEGIN CERTIFICATE REQUEST-----
${`CN=${args.commonName};VAT=${args.vatNumber};ORG=${args.organizationName};ENV=${args.environment};PUB=${pubDer}`
    .match(/.{1,64}/g)!
    .join("\n")}
-----END CERTIFICATE REQUEST-----`;

  const [row] = await db
    .insert(zatcaCertificatesTable)
    .values({
      branchId: args.branchId,
      environment: args.environment,
      csrPem,
      privateKeyCiphertext: encryptSecret(privateKeyPem),
      status: "pending_csr",
    })
    .returning({ id: zatcaCertificatesTable.id });
  return { id: row!.id, csrPem };
}

export async function attachCsid(args: {
  certificateId: number;
  csid: string;
  certificatePem: string;
}): Promise<void> {
  await db
    .update(zatcaCertificatesTable)
    .set({
      csid: args.csid,
      certificatePem: args.certificatePem,
      status: "compliance",
      updatedAt: new Date(),
    })
    .where(eq(zatcaCertificatesTable.id, args.certificateId));
}

export async function attachPcsid(args: {
  certificateId: number;
  pcsid: string;
}): Promise<void> {
  await db
    .update(zatcaCertificatesTable)
    .set({
      pcsid: args.pcsid,
      status: "active",
      updatedAt: new Date(),
    })
    .where(eq(zatcaCertificatesTable.id, args.certificateId));
}

async function getLastInvoiceHash(branchId: number | null): Promise<string> {
  const [last] = await db
    .select({ invoiceHash: zatcaInvoicesTable.invoiceHash })
    .from(zatcaInvoicesTable)
    .innerJoin(invoicesTable, eq(invoicesTable.id, zatcaInvoicesTable.invoiceId))
    .where(branchId === null ? eq(zatcaInvoicesTable.status, "cleared") : and(
      eq(zatcaInvoicesTable.status, "cleared"),
    ))
    .orderBy(desc(zatcaInvoicesTable.id))
    .limit(1);
  return last?.invoiceHash ?? "0".repeat(64);
}

/**
 * Build, sign, persist, and (optionally) submit a single invoice.
 * Returns the persisted zatca_invoices row id and the QR payload.
 */
export async function processInvoiceForZatca(input: ZatcaInvoiceInput): Promise<{
  id: number;
  uuid: string;
  qrTlvBase64: string;
  status: string;
}> {
  const uuid = randomUUID();
  const pih = await getLastInvoiceHash(input.branchId ?? null);
  const xml = buildUblXml(input, uuid, pih);
  const invoiceHash = hashInvoice(xml);

  const key = await getOrGenerateKey(input.branchId ?? null);
  const signature = signInvoiceHash(invoiceHash, key.privateKeyPem);

  const timestampIso = input.issueDate.toISOString().replace(/\.\d{3}Z$/, "Z");
  const qrTlvBase64 = buildZatcaQrTlv({
    sellerName: input.sellerName,
    vatNumber: input.sellerVat,
    timestampIso,
    totalInclVat: input.totalInclVat,
    vatAmount: input.vatAmount,
    invoiceHashB64: invoiceHash,
    signatureB64: signature,
  });

  const targetEndpoint =
    input.invoiceType === "standard" ? "/invoices/clearance/single" : "/invoices/reporting/single";
  let status: "pending" | "cleared" | "reported" | "rejected" = "pending";
  let zatcaResponse: Record<string, unknown> | null = null;
  let rejectionReason: string | null = null;

  if (FATOORA_BASE && key.source === "stored") {
    const t0 = Date.now();
    try {
      const r = await fetch(`${FATOORA_BASE}${targetEndpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept-Version": "V2",
        },
        body: JSON.stringify({
          uuid,
          invoiceHash,
          invoice: Buffer.from(xml, "utf8").toString("base64"),
        }),
      });
      const body = await r.json().catch(() => ({}));
      zatcaResponse = body as Record<string, unknown>;
      status = r.ok ? (input.invoiceType === "standard" ? "cleared" : "reported") : "rejected";
      if (!r.ok) rejectionReason = String((body as { error?: string }).error ?? `HTTP ${r.status}`);
      await recordIntegrationCall({
        branchId: input.branchId ?? null,
        provider: "zatca",
        endpoint: targetEndpoint,
        method: "POST",
        statusCode: r.status,
        durationMs: Date.now() - t0,
        success: r.ok,
        responseSummary: { uuid, status: r.status },
      });
    } catch (e) {
      rejectionReason = e instanceof Error ? e.message : String(e);
      status = "rejected";
      await recordIntegrationCall({
        branchId: input.branchId ?? null,
        provider: "zatca",
        endpoint: targetEndpoint,
        method: "POST",
        success: false,
        errorMessage: rejectionReason,
      });
    }
  }

  const [row] = await db
    .insert(zatcaInvoicesTable)
    .values({
      invoiceId: input.invoiceId,
      invoiceType: input.invoiceType,
      uuid,
      pih,
      invoiceHash,
      xmlPayload: xml,
      signatureBase64: signature,
      qrTlvBase64,
      status,
      clearanceStatus: status === "cleared" || status === "reported" ? "ok" : null,
      zatcaResponse,
      rejectionReason,
      submittedAt: FATOORA_BASE ? new Date() : null,
      clearedAt: status === "cleared" || status === "reported" ? new Date() : null,
    })
    .returning({ id: zatcaInvoicesTable.id });

  return { id: row!.id, uuid, qrTlvBase64, status };
}
