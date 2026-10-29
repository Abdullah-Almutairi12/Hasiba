import {randomUUID} from "node:crypto";
import type request from "supertest";
import assert from "node:assert/strict";

/** Test adapter for the new native review contract, not a calculation mock.
 * Existing cost/return regressions retain every financial assertion. */
export async function reviewedSalesInvoice(agent:request.Agent,body:Record<string,unknown>){
  const preview=await agent.post("/api/sales/invoices/tax-preview").send(body);
  assert.equal(preview.status,200,JSON.stringify(preview.body));
  return agent.post("/api/sales/invoices").set("Idempotency-Key",randomUUID()).send({...body,
    taxPreviewToken:preview.body.previewToken,taxContextToken:preview.body.context.token});
}
