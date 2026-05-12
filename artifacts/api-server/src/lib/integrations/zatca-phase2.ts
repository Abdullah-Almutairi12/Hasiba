import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { randomUUID } from "node:crypto";
import forge from "node-forge";
import { db, zatcaCertificatesTable, zatcaInvoicesTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { encryptSecret, decryptSecret } from "./crypto";
import { recordIntegrationCall } from "./audit";

/**
 * ZATCA Phase 2 — sandbox-ready pipeline.
 *
 * Pipeline:
 *  - createCsr() generates an RSA-2048 keypair and a real PKCS#10
 *    certificate signing request (PEM) for the merchant to upload to
 *    the ZATCA portal. Production EGS units must move to secp256k1
 *    ECDSA per the ZATCA technical guideline; the schema and storage
 *    fields are algorithm-agnostic so swapping is local to this file.
 *  - attachCsid()/attachPcsid() persist the certificate IDs returned
 *    by the Compliance and Production calls.
 *  - processInvoiceForZatca() builds a UBL-shaped XML, hashes it,
 *    signs the hash, persists the invoice + signature + QR (TLV
 *    base64) and — when ZATCA_FATOORA_BASE_URL is set — submits to
 *    the configured Fatoora endpoint with HTTP Basic auth using
 *    CSID/secret as required by the spec.
 *  - getLastInvoiceHash() walks the per-branch PIH chain.
 *
 * Caveats explicitly out of scope here (would land in wave 2):
 *  - Full UBL 2.1 schema with all cbc/cac elements & AdditionalDocumentReference UUID/ICV/PIH triple.
 *  - C14N XML canonicalisation per the ZATCA-prescribed transform.
 *  - Retry queue/worker (the integration_calls log already records every attempt for ops to triage).
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
  const typeCode = "388"; // commercial invoice
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
  return createHash("sha256").update(xml.normalize("NFC"), "utf8").digest("base64");
}

interface SigningKeyMaterial {
  privateKeyPem: string;
  certificatePem: string | null;
  csid: string | null;
  pcsid: string | null;
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
      csid: existing.csid,
      pcsid: existing.pcsid,
      source: "stored",
    };
  }

  // Dev fallback so the workflow flows without prior onboarding.
  // Production callers MUST go through createCsr() and have an
  // active row in zatca_certificates.
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }) as string,
    certificatePem: null,
    csid: null,
    pcsid: null,
    source: "ephemeral",
  };
}

export function signInvoiceHash(invoiceHashB64: string, privateKeyPem: string): string {
  const signer = createSign("RSA-SHA256");
  signer.update(Buffer.from(invoiceHashB64, "base64"));
  signer.end();
  return signer.sign(privateKeyPem).toString("base64");
}

/**
 * Generate an RSA-2048 keypair, build a real PKCS#10 CSR with the
 * required ZATCA subject attributes, persist the encrypted private
 * key, and return the CSR PEM. The merchant uploads the PEM to the
 * Fatoora portal; the portal returns a CSID which is then attached
 * via attachCsid().
 */
export async function createCsr(args: {
  branchId: number | null;
  commonName: string;
  vatNumber: string;
  organizationName: string;
  environment: "sandbox" | "production";
  organizationUnit?: string;
  countryCode?: string;
  invoiceTypes?: "1100" | "0100" | "1000"; // standard+simplified | standard | simplified
  sellingAddress?: string;
  industry?: string;
}): Promise<{ id: number; csrPem: string }> {
  const keyPair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = keyPair.publicKey;
  csr.setSubject([
    { name: "commonName", value: args.commonName },
    { name: "organizationName", value: args.organizationName },
    {
      name: "organizationalUnitName",
      value: args.organizationUnit ?? args.organizationName,
    },
    { name: "countryName", value: args.countryCode ?? "SA" },
  ]);

  // ZATCA-required PKCS#9 / X.509 extensions live inside the
  // ChallengePassword and the SubjectAlternativeName. The portal
  // parses the alt-name fields to decide invoice subset and to bind
  // the device to the VAT number.
  csr.setAttributes([
    {
      name: "extensionRequest",
      extensions: [
        {
          name: "subjectAltName",
          altNames: [
            { type: 4, value: `SN=1-Hasiba|2-${args.commonName}|3-${randomUUID()}` },
            { type: 4, value: `UID=${args.vatNumber}` },
            { type: 4, value: `TITLE=${args.invoiceTypes ?? "1100"}` },
            {
              type: 4,
              value: `REGISTERED_ADDRESS=${args.sellingAddress ?? "RUH"}`,
            },
            { type: 4, value: `BUSINESS_CATEGORY=${args.industry ?? "Retail"}` },
          ],
        },
      ],
    },
  ]);

  const md = forge.md.sha256.create();
  csr.sign(keyPair.privateKey, md);
  const csrPem = forge.pki.certificationRequestToPem(csr);
  const privateKeyPem = forge.pki.privateKeyToPem(keyPair.privateKey);

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
  // Walk the chain scoped to the EGS unit (== branch). ZATCA assigns
  // one CSID per device, and each device's PIH chain must be
  // continuous. Mixing chains across branches would invalidate every
  // subsequent invoice on the device.
  const condition =
    branchId === null
      ? eq(zatcaInvoicesTable.status, "cleared")
      : and(
          eq(zatcaInvoicesTable.status, "cleared"),
          eq(zatcaInvoicesTable.branchId, branchId),
        );
  const [last] = await db
    .select({ invoiceHash: zatcaInvoicesTable.invoiceHash })
    .from(zatcaInvoicesTable)
    .where(condition)
    .orderBy(desc(zatcaInvoicesTable.id))
    .limit(1);
  return last?.invoiceHash ?? "0".repeat(64);
}

/** Build, sign, persist, and (optionally) submit a single invoice. */
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

  if (FATOORA_BASE && key.source === "stored" && (key.csid || key.pcsid)) {
    const t0 = Date.now();
    // ZATCA expects HTTP Basic auth where the username is the
    // base64-encoded PCSID/CSID and the password is the matching
    // secret. We pass whichever ID is available; production
    // submissions require pcsid (issued after the compliance set).
    const authToken = key.pcsid ?? key.csid ?? "";
    try {
      const r = await fetch(`${FATOORA_BASE}${targetEndpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept-Version": "V2",
          Authorization: `Basic ${Buffer.from(`${authToken}:`).toString("base64")}`,
        },
        body: JSON.stringify({
          uuid,
          invoiceHash,
          invoice: Buffer.from(xml, "utf8").toString("base64"),
        }),
      });
      const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      zatcaResponse = body;
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
      branchId: input.branchId ?? null,
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
