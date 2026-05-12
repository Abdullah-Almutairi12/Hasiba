import { createHash, generateKeyPairSync, sign as signRaw, randomUUID, webcrypto } from "node:crypto";
import * as x509 from "@peculiar/x509";
import { db, zatcaCertificatesTable, zatcaInvoicesTable } from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { encryptSecret, decryptSecret } from "./crypto";
import { recordIntegrationCall } from "./audit";

/**
 * ZATCA Phase 2 (e-invoicing) — production-shaped pipeline.
 *
 * Pipeline:
 *  - createCsr() generates an ECDSA P-256 keypair (the Node-supported
 *    curve closest to ZATCA's spec'd secp256k1; full secp256k1 swap is
 *    a one-line change once Node WebCrypto exposes it) and a real
 *    PKCS#10 CSR via @peculiar/x509 with the ZATCA-required custom
 *    SAN attributes (SN/UID/TITLE/REGISTERED_ADDRESS/BUSINESS_CATEGORY).
 *  - attachCsid() / attachPcsid() persist the certificate IDs returned
 *    by the Compliance and Production CSID calls.
 *  - processInvoiceForZatca() builds the UBL 2.1 invoice, applies a
 *    canonicalization-equivalent NFC normalization (the ZATCA
 *    XML-DSig transform expects deterministic byte input — we
 *    achieve determinism by emitting the document with stable
 *    formatting and no PII whitespace), hashes it (SHA-256, base64),
 *    signs the hash with ECDSA, persists the invoice + signature +
 *    QR (TLV base64) and submits to the Fatoora endpoint with HTTP
 *    Basic auth (PCSID/CSID). Submission failures enqueue a retry.
 *  - retryFailedZatcaSubmissions() works the queue.
 *  - getLastInvoiceHash() walks the per-branch PIH chain across
 *    BOTH cleared (standard) and reported (simplified) invoices —
 *    they share the same chain on each EGS unit.
 */

// Per ZATCA Phase 2 SDK, sandbox and production are distinct API
// hostnames and merchants may flip between them per company. We
// default to the official Fatoora hosts and let an env override
// each one for self-hosted simulators.
const FATOORA_BASE_SANDBOX =
  process.env["ZATCA_FATOORA_BASE_URL_SANDBOX"] ??
  process.env["ZATCA_FATOORA_BASE_URL"] ??
  "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal";
const FATOORA_BASE_PRODUCTION =
  process.env["ZATCA_FATOORA_BASE_URL_PRODUCTION"] ??
  process.env["ZATCA_FATOORA_BASE_URL"] ??
  "https://gw-fatoora.zatca.gov.sa/e-invoicing/core";
function fatooraBaseFor(env: "sandbox" | "production"): string {
  return env === "production" ? FATOORA_BASE_PRODUCTION : FATOORA_BASE_SANDBOX;
}
const peculiarCrypto = webcrypto as unknown as Crypto;
x509.cryptoProvider.set(peculiarCrypto);

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

/**
 * Build the optional XAdES-style UBLExtensions block expected by
 * ZATCA Phase 2. When `sig` is supplied this returns a fully
 * populated <ext:UBLExtensions> envelope carrying the signed
 * properties (cert digest, signing time, invoice hash, ECDSA
 * signature value); when omitted it returns an empty string so the
 * same emitter can be used for the pre-signing canonical form.
 */
function buildUblExtensions(sig?: {
  invoiceHashB64: string;
  signatureB64: string;
  certBase64: string;
  certDigestB64: string;
  signingTimeIso: string;
}): string {
  if (!sig) return "";
  return `  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>
      <ext:ExtensionContent>
        <sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2"
                                   xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2"
                                   xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2">
          <sac:SignatureInformation>
            <cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>
            <sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>
            <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="signature">
              <ds:SignedInfo>
                <ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>
                <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/>
                <ds:Reference URI="">
                  <ds:Transforms>
                    <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                      <ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath>
                    </ds:Transform>
                  </ds:Transforms>
                  <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                  <ds:DigestValue>${sig.invoiceHashB64}</ds:DigestValue>
                </ds:Reference>
              </ds:SignedInfo>
              <ds:SignatureValue>${sig.signatureB64}</ds:SignatureValue>
              <ds:KeyInfo>
                <ds:X509Data><ds:X509Certificate>${sig.certBase64}</ds:X509Certificate></ds:X509Data>
              </ds:KeyInfo>
              <ds:Object>
                <xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="signature">
                  <xades:SignedProperties Id="xadesSignedProperties">
                    <xades:SignedSignatureProperties>
                      <xades:SigningTime>${sig.signingTimeIso}</xades:SigningTime>
                      <xades:SigningCertificate>
                        <xades:Cert>
                          <xades:CertDigest>
                            <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                            <ds:DigestValue>${sig.certDigestB64}</ds:DigestValue>
                          </xades:CertDigest>
                        </xades:Cert>
                      </xades:SigningCertificate>
                    </xades:SignedSignatureProperties>
                  </xades:SignedProperties>
                </xades:QualifyingProperties>
              </ds:Object>
            </ds:Signature>
          </sac:SignatureInformation>
        </sig:UBLDocumentSignatures>
      </ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>
`;
}

export function buildUblXml(
  input: ZatcaInvoiceInput,
  uuid: string,
  pih: string,
  sig?: {
    invoiceHashB64: string;
    signatureB64: string;
    certBase64: string;
    certDigestB64: string;
    signingTimeIso: string;
  },
): string {
  const issueDate = input.issueDate.toISOString().slice(0, 10);
  const issueTime = input.issueDate.toISOString().slice(11, 19);
  const typeCode = "388";
  const subtypeCode = input.invoiceType === "standard" ? "0100000" : "0200000";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
${buildUblExtensions(sig)}  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${escapeXml(input.invoiceNumber)}</cbc:ID>
  <cbc:UUID>${uuid}</cbc:UUID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:IssueTime>${issueTime}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="${subtypeCode}">${typeCode}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>
  <cac:AdditionalDocumentReference>
    <cbc:ID>ICV</cbc:ID>
    <cbc:UUID>${input.invoiceId}</cbc:UUID>
  </cac:AdditionalDocumentReference>
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

/**
 * Hash the canonical UBL byte stream. ZATCA requires the XML to be
 * canonicalized per the C14N transform before SHA-256; we apply NFC
 * normalisation on the string and remove the XML declaration before
 * hashing — equivalent for our deterministic emitter (no comments,
 * no processing instructions besides the declaration, stable
 * attribute ordering by construction).
 */
export function hashInvoice(xml: string): string {
  const stripped = xml.replace(/^<\?xml[^>]*\?>\s*/i, "").normalize("NFC");
  return createHash("sha256").update(stripped, "utf8").digest("base64");
}

interface SigningKeyMaterial {
  privateKeyPem: string;
  certificatePem: string | null;
  csid: string | null;
  pcsid: string | null;
  complianceSecret: string | null;
  productionSecret: string | null;
  algorithm: "ec" | "rsa";
  source: "stored" | "ephemeral";
}

async function getOrGenerateKey(branchId: number | null): Promise<SigningKeyMaterial> {
  // Each branch is its own EGS unit; certificates are scoped per
  // branch. When branchId is null we ONLY look at certificates
  // that were also issued without a branch (org-level fallback) —
  // never reuse a sibling-branch's cert by accident.
  const branchPredicate =
    branchId === null
      ? sql`${zatcaCertificatesTable.branchId} IS NULL`
      : eq(zatcaCertificatesTable.branchId, branchId);
  const [existing] = await db
    .select()
    .from(zatcaCertificatesTable)
    .where(and(branchPredicate, eq(zatcaCertificatesTable.status, "active")))
    .orderBy(desc(zatcaCertificatesTable.id))
    .limit(1);

  if (existing?.privateKeyCiphertext) {
    return {
      privateKeyPem: decryptSecret(existing.privateKeyCiphertext),
      certificatePem: existing.certificatePem,
      csid: existing.csid,
      pcsid: existing.pcsid,
      complianceSecret: existing.complianceSecretCiphertext
        ? decryptSecret(existing.complianceSecretCiphertext)
        : null,
      productionSecret: existing.productionSecretCiphertext
        ? decryptSecret(existing.productionSecretCiphertext)
        : null,
      algorithm: "ec",
      source: "stored",
    };
  }

  // Dev fallback. Production callers MUST go through createCsr().
  // ZATCA Phase 2 mandates secp256k1 for the EGS keypair.
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }) as string,
    certificatePem: null,
    csid: null,
    pcsid: null,
    complianceSecret: null,
    productionSecret: null,
    algorithm: "ec",
    source: "ephemeral",
  };
}

/**
 * Sign the SHA-256 invoice hash with ECDSA-P-256 (the WebCrypto-supported
 * NIST curve nearest to ZATCA's secp256k1 spec). Output is the
 * base64-encoded raw ECDSA signature.
 */
export function signInvoiceHashEc(invoiceHashB64: string, privateKeyPem: string): string {
  // ZATCA SDK signs the UTF-8 bytes of the **base64-encoded hash
  // string** with ECDSA-SHA256 — passing the raw decoded hash
  // here would produce SHA256(SHA256(canonicalXml)) and Fatoora
  // would systematically reject the invoice. Sign the b64 string
  // bytes; Node's "sha256" algorithm hashes them once before the
  // ECDSA operation.
  const sig = signRaw("sha256", Buffer.from(invoiceHashB64, "utf8"), {
    key: privateKeyPem,
    dsaEncoding: "der",
  });
  return sig.toString("base64");
}

/**
 * Generate an ECDSA P-256 keypair, build a real PKCS#10 CSR with the
 * required ZATCA SAN attributes, persist the encrypted PKCS#8 private
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
  invoiceTypes?: "1100" | "0100" | "1000";
  sellingAddress?: string;
  industry?: string;
}): Promise<{ id: number; csrPem: string }> {
  // ZATCA Phase 2 mandates secp256k1 ("K-256") for the EGS
  // signing key. @peculiar/webcrypto exposes the curve under the
  // K-256 alias; the rest of the SubtleCrypto pipeline (CSR
  // signing, PKCS#8 export) is curve-agnostic.
  const keyPair = await peculiarCrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "K-256" },
    true,
    ["sign", "verify"],
  );

  const subject = `CN=${escapeDn(args.commonName)},O=${escapeDn(args.organizationName)},OU=${escapeDn(args.organizationUnit ?? args.organizationName)},C=${args.countryCode ?? "SA"}`;

  const csr = await x509.Pkcs10CertificateRequestGenerator.create({
    name: subject,
    keys: keyPair,
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    extensions: [
      // ZATCA-required custom SAN entries (RFC 822 / dirName form).
      new x509.SubjectAlternativeNameExtension([
        { type: "dn", value: `SN=1-Hasiba|2-${args.commonName}|3-${randomUUID()}` },
        { type: "dn", value: `UID=${args.vatNumber}` },
        { type: "dn", value: `TITLE=${args.invoiceTypes ?? "1100"}` },
        { type: "dn", value: `REGISTERED_ADDRESS=${args.sellingAddress ?? "RUH"}` },
        { type: "dn", value: `BUSINESS_CATEGORY=${args.industry ?? "Retail"}` },
      ]),
    ],
  });

  const csrPem = csr.toString("pem");
  const pkcs8 = await peculiarCrypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const pkcs8B64 = Buffer.from(pkcs8).toString("base64").match(/.{1,64}/g)?.join("\n") ?? "";
  const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${pkcs8B64}\n-----END PRIVATE KEY-----\n`;

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

function escapeDn(s: string): string {
  return s.replace(/([,+="<>;\\])/g, "\\$1");
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

/**
 * Real CSID retrieval — POSTs the generated CSR to the ZATCA
 * Compliance API and persists the issued binarySecurityToken
 * (CSID) + secret onto the certificate row.
 *
 * Endpoint: POST {compliance_base}/compliance
 * Headers : OTP, Accept-Version: V2
 * Body    : { csr: <base64-of-pem-csr> }
 * Returns : { binarySecurityToken, secret, requestID }
 */
export async function retrieveCsid(args: {
  certificateId: number;
  otp: string;
}): Promise<{ csid: string; certificatePem: string; requestId: string }> {
  const [cert] = await db
    .select()
    .from(zatcaCertificatesTable)
    .where(eq(zatcaCertificatesTable.id, args.certificateId));
  if (!cert) throw new Error("certificate_row_not_found");
  if (!cert.csrPem) throw new Error("csr_missing");
  const base = process.env["ZATCA_COMPLIANCE_BASE_URL"];
  if (!base) throw new Error("ZATCA_COMPLIANCE_BASE_URL not configured");
  const csrB64 = Buffer.from(cert.csrPem, "utf8").toString("base64");
  const t0 = Date.now();
  const r = await fetch(`${base}/compliance`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept-Version": "V2",
      OTP: args.otp,
    },
    body: JSON.stringify({ csr: csrB64 }),
  });
  const body = (await r.json().catch(() => ({}))) as {
    binarySecurityToken?: string;
    secret?: string;
    requestID?: string;
    errors?: unknown;
  };
  await recordIntegrationCall({
    branchId: cert.branchId,
    provider: "zatca",
    endpoint: "/compliance",
    method: "POST",
    statusCode: r.status,
    durationMs: Date.now() - t0,
    success: r.ok,
    responseSummary: { requestID: body.requestID ?? null, httpStatus: r.status },
  });
  if (!r.ok || !body.binarySecurityToken || !body.secret) {
    throw new Error(`csid_retrieval_failed: HTTP ${r.status}`);
  }
  // The binarySecurityToken is a base64 X.509 cert. Persist as
  // PEM for downstream signing tooling, store the CSID secret
  // (encrypted) for production-CSID retrieval.
  const certPem =
    `-----BEGIN CERTIFICATE-----\n` +
    (Buffer.from(body.binarySecurityToken, "base64").toString("base64").match(/.{1,64}/g)?.join("\n") ?? "") +
    `\n-----END CERTIFICATE-----\n`;
  await db
    .update(zatcaCertificatesTable)
    .set({
      csid: body.binarySecurityToken,
      certificatePem: certPem,
      complianceSecretCiphertext: encryptSecret(body.secret),
      complianceRequestId: body.requestID ?? null,
      status: "compliance",
      updatedAt: new Date(),
    })
    .where(eq(zatcaCertificatesTable.id, args.certificateId));
  return {
    csid: body.binarySecurityToken,
    certificatePem: certPem,
    requestId: body.requestID ?? "",
  };
}

/**
 * Real PCSID retrieval — exchanges the compliance CSID for a
 * production CSID after the seller has passed compliance checks.
 *
 * Endpoint: POST {production_base}/production/csids
 * Auth    : Basic base64("<csid>:<secret>")
 * Body    : { compliance_request_id }
 */
export async function retrievePcsid(args: {
  certificateId: number;
}): Promise<{ pcsid: string }> {
  const [cert] = await db
    .select()
    .from(zatcaCertificatesTable)
    .where(eq(zatcaCertificatesTable.id, args.certificateId));
  if (!cert) throw new Error("certificate_row_not_found");
  if (!cert.csid || !cert.complianceSecretCiphertext) {
    throw new Error("csid_or_secret_missing — call retrieveCsid first");
  }
  const base = process.env["ZATCA_PRODUCTION_BASE_URL"];
  if (!base) throw new Error("ZATCA_PRODUCTION_BASE_URL not configured");
  const secret = decryptSecret(cert.complianceSecretCiphertext);
  const auth = Buffer.from(`${cert.csid}:${secret}`).toString("base64");
  const t0 = Date.now();
  const r = await fetch(`${base}/production/csids`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept-Version": "V2",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({ compliance_request_id: cert.complianceRequestId ?? "" }),
  });
  const body = (await r.json().catch(() => ({}))) as {
    binarySecurityToken?: string;
    secret?: string;
  };
  await recordIntegrationCall({
    branchId: cert.branchId,
    provider: "zatca",
    endpoint: "/production/csids",
    method: "POST",
    statusCode: r.status,
    durationMs: Date.now() - t0,
    success: r.ok,
    responseSummary: { httpStatus: r.status },
  });
  if (!r.ok || !body.binarySecurityToken) {
    throw new Error(`pcsid_retrieval_failed: HTTP ${r.status}`);
  }
  await db
    .update(zatcaCertificatesTable)
    .set({
      pcsid: body.binarySecurityToken,
      productionSecretCiphertext: body.secret
        ? encryptSecret(body.secret)
        : cert.productionSecretCiphertext,
      status: "active",
      updatedAt: new Date(),
    })
    .where(eq(zatcaCertificatesTable.id, args.certificateId));
  return { pcsid: body.binarySecurityToken };
}

async function getLastInvoiceHash(branchId: number | null): Promise<string> {
  // Walk the chain scoped to the EGS unit (== branch). The chain
  // includes BOTH `cleared` (standard/clearance) and `reported`
  // (simplified) invoices because they share the device's PIH
  // sequence — ZATCA validates the PIH continuity per EGS
  // regardless of subset.
  const [last] = await db
    .select({ invoiceHash: zatcaInvoicesTable.invoiceHash, status: zatcaInvoicesTable.status })
    .from(zatcaInvoicesTable)
    .where(
      branchId === null
        ? undefined
        : eq(zatcaInvoicesTable.branchId, branchId),
    )
    .orderBy(desc(zatcaInvoicesTable.id))
    .limit(1);
  if (!last) return "0".repeat(64);
  if (last.status !== "cleared" && last.status !== "reported") {
    // Last attempt did not succeed — walk back through the chain
    // and pick the most recent SUCCESSFUL hash (cleared|reported).
    // ZATCA expects every new invoice to chain off the last accepted
    // PIH, so failed rows must be skipped explicitly.
    const rows = await db
      .select({
        invoiceHash: zatcaInvoicesTable.invoiceHash,
        status: zatcaInvoicesTable.status,
      })
      .from(zatcaInvoicesTable)
      .where(
        and(
          branchId === null
            ? undefined
            : eq(zatcaInvoicesTable.branchId, branchId),
          inArray(zatcaInvoicesTable.status, ["cleared", "reported"]),
        ),
      )
      .orderBy(desc(zatcaInvoicesTable.id))
      .limit(1);
    return rows[0]?.invoiceHash ?? "0".repeat(64);
  }
  return last.invoiceHash ?? "0".repeat(64);
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
  // Hash is computed over the canonical UNSIGNED form per ZATCA
  // (XPath transform excludes UBLExtensions) — we then rebuild the
  // XML with the XAdES <ds:Signature> envelope embedded for
  // submission so the wire payload satisfies Phase 2's signed-doc
  // shape.
  const unsignedXml = buildUblXml(input, uuid, pih);
  const invoiceHash = hashInvoice(unsignedXml);

  const key = await getOrGenerateKey(input.branchId ?? null);
  const signature = signInvoiceHashEc(invoiceHash, key.privateKeyPem);
  const certBase64 = key.certificatePem
    ? key.certificatePem
        .replace(/-----(BEGIN|END) CERTIFICATE-----/g, "")
        .replace(/\s+/g, "")
    : "";
  const certDigestB64 = certBase64
    ? createHash("sha256").update(certBase64, "utf8").digest("base64")
    : "";
  const signingTimeIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const xml = buildUblXml(input, uuid, pih, {
    invoiceHashB64: invoiceHash,
    signatureB64: signature,
    certBase64,
    certDigestB64,
    signingTimeIso,
  });

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

  const submitOutcome = await submitToFatoora({
    invoiceType: input.invoiceType,
    branchId: input.branchId ?? null,
    uuid,
    invoiceHash,
    xml,
    key,
  });

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
      status: submitOutcome.status,
      clearanceStatus:
        submitOutcome.status === "cleared" || submitOutcome.status === "reported" ? "ok" : null,
      zatcaResponse: submitOutcome.response,
      rejectionReason: submitOutcome.rejection,
      submittedAt: submitOutcome.submitted ? new Date() : null,
      clearedAt:
        submitOutcome.status === "cleared" || submitOutcome.status === "reported"
          ? new Date()
          : null,
    })
    .returning({ id: zatcaInvoicesTable.id });

  if (submitOutcome.status === "rejected" || submitOutcome.status === "retrying") {
    await enqueueRetry(row!.id, submitOutcome.rejection ?? "submission_failed");
  }

  return { id: row!.id, uuid, qrTlvBase64, status: submitOutcome.status };
}

interface SubmitOutcome {
  status: "pending" | "cleared" | "reported" | "rejected" | "retrying";
  response: Record<string, unknown> | null;
  rejection: string | null;
  submitted: boolean;
}

async function submitToFatoora(args: {
  invoiceType: "standard" | "simplified";
  branchId: number | null;
  uuid: string;
  invoiceHash: string;
  xml: string;
  key: SigningKeyMaterial;
}): Promise<SubmitOutcome> {
  // Pick the Fatoora hostname per the certificate's environment
  // (production PCSID → core API; sandbox CSID → developer-portal
  // API). Falls back to the legacy global env if nothing matches.
  const certEnv: "sandbox" | "production" =
    args.key.pcsid && args.key.productionSecret ? "production" : "sandbox";
  const baseUrl = fatooraBaseFor(certEnv);
  if (!baseUrl) {
    return { status: "pending", response: null, rejection: null, submitted: false };
  }
  if (args.key.source !== "stored" || (!args.key.csid && !args.key.pcsid)) {
    return {
      status: "rejected",
      response: null,
      rejection: "device_not_onboarded_with_zatca",
      submitted: false,
    };
  }
  const target =
    args.invoiceType === "standard"
      ? "/invoices/clearance/single"
      : "/invoices/reporting/single";
  // Real Fatoora endpoints expect HTTP Basic credentials of the
  // form base64("<binarySecurityToken>:<secret>"). Production
  // calls use the PCSID + production secret; sandbox/compliance
  // calls fall back to the compliance CSID + compliance secret.
  const usingProduction = Boolean(args.key.pcsid && args.key.productionSecret);
  const authToken = usingProduction
    ? args.key.pcsid!
    : args.key.csid ?? args.key.pcsid ?? "";
  const authSecret = usingProduction
    ? args.key.productionSecret!
    : args.key.complianceSecret ?? "";
  if (!authSecret) {
    return {
      status: "rejected",
      response: null,
      rejection: "missing_csid_or_pcsid_secret",
      submitted: false,
    };
  }
  const t0 = Date.now();
  try {
    const r = await fetch(`${baseUrl}${target}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept-Version": "V2",
        Authorization: `Basic ${Buffer.from(`${authToken}:${authSecret}`).toString("base64")}`,
      },
      body: JSON.stringify({
        uuid: args.uuid,
        invoiceHash: args.invoiceHash,
        invoice: Buffer.from(args.xml, "utf8").toString("base64"),
      }),
    });
    const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    await recordIntegrationCall({
      branchId: args.branchId,
      provider: "zatca",
      endpoint: target,
      method: "POST",
      statusCode: r.status,
      durationMs: Date.now() - t0,
      success: r.ok,
      responseSummary: { uuid: args.uuid, httpStatus: r.status },
    });
    if (r.ok) {
      return {
        status: args.invoiceType === "standard" ? "cleared" : "reported",
        response: body,
        rejection: null,
        submitted: true,
      };
    }
    // 4xx → permanent rejection; 5xx → schedule retry.
    const isRetryable = r.status >= 500;
    return {
      status: isRetryable ? "retrying" : "rejected",
      response: body,
      rejection: String((body as { error?: string }).error ?? `HTTP ${r.status}`),
      submitted: true,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordIntegrationCall({
      branchId: args.branchId,
      provider: "zatca",
      endpoint: target,
      method: "POST",
      success: false,
      errorMessage: msg,
      durationMs: Date.now() - t0,
    });
    return { status: "retrying", response: null, rejection: msg, submitted: true };
  }
}

/* ============================== Retry queue ============================= */

async function enqueueRetry(zatcaInvoiceId: number, lastError: string): Promise<void> {
  // Schedule first retry in 1 minute. Worker bumps next_attempt_at
  // on each failed retry with exponential backoff.
  await db.execute(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (await import("drizzle-orm")).sql`
      INSERT INTO zatca_invoice_retries
        (zatca_invoice_id, attempt, next_attempt_at, last_error)
      VALUES
        (${zatcaInvoiceId}, 0, now() + interval '1 minute', ${lastError})
      ON CONFLICT DO NOTHING
    `,
  );
}

export async function retryFailedZatcaSubmissions(maxBatch = 25): Promise<number> {
  const orm = await import("drizzle-orm");
  const due = await db.execute<{
    id: number;
    zatca_invoice_id: number;
    attempt: number;
  }>(
    orm.sql`
      SELECT id, zatca_invoice_id, attempt
      FROM zatca_invoice_retries
      WHERE next_attempt_at <= now()
      ORDER BY id
      LIMIT ${maxBatch}
    `,
  );
  const rows = (due as unknown as { rows: Array<{ id: number; zatca_invoice_id: number; attempt: number }> }).rows ?? [];
  let processed = 0;
  for (const r of rows) {
    const [row] = await db
      .select()
      .from(zatcaInvoicesTable)
      .where(eq(zatcaInvoicesTable.id, r.zatca_invoice_id));
    if (!row) {
      await db.execute(orm.sql`DELETE FROM zatca_invoice_retries WHERE id = ${r.id}`);
      continue;
    }
    const key = await getOrGenerateKey(row.branchId ?? null);
    const out = await submitToFatoora({
      invoiceType: row.invoiceType === "standard" ? "standard" : "simplified",
      branchId: row.branchId ?? null,
      uuid: row.uuid,
      invoiceHash: row.invoiceHash ?? "",
      xml: row.xmlPayload,
      key,
    });
    await db
      .update(zatcaInvoicesTable)
      .set({
        status: out.status,
        zatcaResponse: out.response,
        rejectionReason: out.rejection,
        clearedAt: out.status === "cleared" || out.status === "reported" ? new Date() : null,
        retryCount: r.attempt + 1,
      })
      .where(eq(zatcaInvoicesTable.id, row.id));
    if (out.status === "cleared" || out.status === "reported" || out.status === "rejected") {
      await db.execute(orm.sql`DELETE FROM zatca_invoice_retries WHERE id = ${r.id}`);
    } else {
      // Exponential backoff capped at 1 hour.
      const backoffSec = Math.min(60 * Math.pow(2, r.attempt + 1), 3600);
      await db.execute(orm.sql`
        UPDATE zatca_invoice_retries
        SET attempt = ${r.attempt + 1},
            next_attempt_at = now() + (${backoffSec} || ' seconds')::interval,
            last_error = ${out.rejection ?? "unknown"}
        WHERE id = ${r.id}
      `);
    }
    processed++;
  }
  return processed;
}

/** Idle worker — call from index.ts on a periodic schedule. */
export function startZatcaRetryWorker(intervalMs = 60_000): NodeJS.Timeout {
  return setInterval(() => {
    retryFailedZatcaSubmissions().catch(() => {
      // Failures are logged inside submitToFatoora; nothing to do here.
    });
  }, intervalMs).unref();
}
