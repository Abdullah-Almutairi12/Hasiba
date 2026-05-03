// ZATCA Phase 1 (Fatoorah) compact QR. TLV-encoded, base64 string.
// Tags: 1=seller name, 2=VAT number, 3=ISO timestamp, 4=total incl. VAT, 5=VAT amount.

const SELLER_NAME = process.env["ZATCA_SELLER_NAME"] ?? "حاسبة AI";
const VAT_NUMBER = process.env["ZATCA_VAT_NUMBER"] ?? "300000000000003";

function tlv(tag: number, value: string): Buffer {
  const valueBuf = Buffer.from(value, "utf8");
  return Buffer.concat([Buffer.from([tag, valueBuf.length]), valueBuf]);
}

export function buildZatcaQrBase64(params: {
  timestamp: string | Date;
  totalWithVat: number;
  vatAmount: number;
  sellerName?: string;
  vatNumber?: string;
}): string {
  const ts = typeof params.timestamp === "string" ? params.timestamp : params.timestamp.toISOString();
  const buf = Buffer.concat([
    tlv(1, params.sellerName ?? SELLER_NAME),
    tlv(2, params.vatNumber ?? VAT_NUMBER),
    tlv(3, ts),
    tlv(4, params.totalWithVat.toFixed(2)),
    tlv(5, params.vatAmount.toFixed(2)),
  ]);
  return buf.toString("base64");
}
