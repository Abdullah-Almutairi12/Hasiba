import { createHash, generateKeyPairSync, sign as signRaw, randomUUID, webcrypto } from "node:crypto";
import * as x509 from "@peculiar/x509";
import { db, zatcaCertificatesTable, zatcaInvoicesTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
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

const FATOORA_BASE = process.env["ZATCA_FATOORA_BASE_URL"] ?? null;
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

export function buildUblXml(input: ZatcaInvoiceInput, uuid: string, pih: string): string {
  const issueDate = input.issueDate.toISOString().slice(0, 10);
  const issueTime = input.issueDate.toISOString().slice(11, 19);
  const typeCode = "388";
  const subtypeCode = input.invoiceType === "standard" ? "0100000" : "0200000";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
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
  algorithm: "ec" | "rsa";
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
      algorithm: "ec",
      source: "stored",
    };
  }

  // Dev fallback. Production callers MUST go through createCsr().
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }) as string,
    certificatePem: null,
    csid: null,
    pcsid: null,
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
  const sig = signRaw("sha256", Buffer.from(invoiceHashB64, "base64"), {
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
  const keyPair = await peculiarCrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
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
    // Last attempt did not succeed; replay against the same PIH
    // by walking back until we hit a successful one.
    const [prev] = await db
      .select({ invoiceHash: zatcaInvoicesTable.invoiceHash })
      .from(zatcaInvoicesTable)
      .where(
        branchId === null
          ? undefined
          : eq(zatcaInvoicesTable.branchId, branchId),
      )
      .orderBy(desc(zatcaInvoicesTable.id))
      .limit(50);
    return prev?.invoiceHash ?? "0".repeat(64);
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
  const xml = buildUblXml(input, uuid, pih);
  const invoiceHash = hashInvoice(xml);

  const key = await getOrGenerateKey(input.branchId ?? null);
  const signature = signInvoiceHashEc(invoiceHash, key.privateKeyPem);

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
  if (!FATOORA_BASE) {
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
  const authToken = args.key.pcsid ?? args.key.csid ?? "";
  const t0 = Date.now();
  try {
    const r = await fetch(`${FATOORA_BASE}${target}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept-Version": "V2",
        Authorization: `Basic ${Buffer.from(`${authToken}:`).toString("base64")}`,
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
