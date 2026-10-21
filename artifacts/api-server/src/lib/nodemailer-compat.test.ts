import { describe, expect, it } from "vitest";
import nodemailer from "nodemailer";

describe("Nodemailer upgrade compatibility", () => {
  it("composes Arabic mail, recipient envelopes and PDF attachments without SMTP", async () => {
    const transport = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      newline: "unix",
    });
    const info = await transport.sendMail({
      from: "ERP <no-reply@example.com>",
      to: "customer@example.com",
      cc: "accounts@example.com",
      bcc: "archive@example.com",
      subject: "فاتورة المبيعات",
      text: "مرفق الفاتورة الضريبية",
      attachments: [{
        filename: "invoice.pdf",
        content: Buffer.from("%PDF-1.4\n"),
        contentType: "application/pdf",
      }],
    });

    expect(info.messageId).toBeTruthy();
    expect(info.envelope.from).toBe("no-reply@example.com");
    expect(info.envelope.to).toEqual([
      "customer@example.com",
      "accounts@example.com",
      "archive@example.com",
    ]);
    const message = info.message.toString();
    expect(message).toContain("Content-Type: multipart/mixed;");
    expect(message).toContain("Content-Type: application/pdf;");
    expect(message).toContain('filename=invoice.pdf');
    expect(message).toContain("Subject: =?UTF-8?");
  });
});
