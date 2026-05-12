import { db, outboundMessagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getCredential, MissingCredentialError } from "./credentials";
import { recordIntegrationCall } from "./audit";

export type Channel = "whatsapp" | "sms";
export type MessagingProvider =
  | "whatsapp" // Meta Cloud API
  | "unifonic"
  | "mobily"
  | "taqnyat";

export class MessagingNotImplementedError extends Error {
  readonly statusCode = 501;
  constructor(provider: string) {
    super(`Messaging provider "${provider}" has no live adapter wired yet.`);
    this.name = "MessagingNotImplementedError";
  }
}

export interface SendMessageRequest {
  branchId?: number | null;
  channel: Channel;
  provider: MessagingProvider;
  to: string;
  body: string;
  templateName?: string;
  variables?: Record<string, string>;
}

export interface SendMessageResult {
  id: number;
  status: "queued" | "sent" | "failed";
  providerRef: string | null;
}

function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

interface AdapterOutcome {
  providerRef: string | null;
  ok: boolean;
  error?: string;
  statusCode: number;
}

async function sendWhatsApp(req: SendMessageRequest, secret: Record<string, string>): Promise<AdapterOutcome> {
  const phoneNumberId = secret.phoneNumberId;
  const accessToken = secret.accessToken;
  if (!phoneNumberId || !accessToken) throw new MissingCredentialError("whatsapp");
  const t0 = Date.now();
  const r = await fetch(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        req.templateName
          ? {
              messaging_product: "whatsapp",
              to: req.to,
              type: "template",
              template: {
                name: req.templateName,
                language: { code: "ar" },
                components: req.variables
                  ? [
                      {
                        type: "body",
                        parameters: Object.values(req.variables).map((v) => ({
                          type: "text",
                          text: v,
                        })),
                      },
                    ]
                  : [],
              },
            }
          : {
              messaging_product: "whatsapp",
              to: req.to,
              type: "text",
              text: { body: renderTemplate(req.body, req.variables ?? {}) },
            },
      ),
    },
  );
  const body = (await r.json().catch(() => ({}))) as {
    messages?: Array<{ id: string }>;
    error?: { message: string };
  };
  await recordIntegrationCall({
    branchId: req.branchId ?? null,
    provider: "whatsapp",
    endpoint: `/messages`,
    method: "POST",
    statusCode: r.status,
    durationMs: Date.now() - t0,
    success: r.ok,
    errorMessage: r.ok ? null : body.error?.message ?? `HTTP ${r.status}`,
  });
  return {
    ok: r.ok,
    providerRef: body.messages?.[0]?.id ?? null,
    error: body.error?.message,
    statusCode: r.status,
  };
}

async function sendUnifonic(req: SendMessageRequest, secret: Record<string, string>): Promise<AdapterOutcome> {
  const appSid = secret.appSid;
  if (!appSid) throw new MissingCredentialError("unifonic");
  const senderId = secret.senderId ?? "Hasiba";
  const t0 = Date.now();
  const params = new URLSearchParams({
    AppSid: appSid,
    Recipient: req.to,
    Body: renderTemplate(req.body, req.variables ?? {}),
    SenderID: senderId,
  });
  const r = await fetch(
    `https://el.cloud.unifonic.com/rest/SMS/messages?${params.toString()}`,
    { method: "POST" },
  );
  const body = (await r.json().catch(() => ({}))) as {
    success?: string;
    data?: { MessageID?: string };
    errorCode?: string;
    message?: string;
  };
  await recordIntegrationCall({
    branchId: req.branchId ?? null,
    provider: "unifonic",
    endpoint: "/SMS/messages",
    method: "POST",
    statusCode: r.status,
    durationMs: Date.now() - t0,
    success: r.ok && body.success === "true",
    errorMessage: body.message,
  });
  return {
    ok: r.ok && body.success === "true",
    providerRef: body.data?.MessageID ?? null,
    error: body.message,
    statusCode: r.status,
  };
}

async function sendTaqnyat(req: SendMessageRequest, secret: Record<string, string>): Promise<AdapterOutcome> {
  const apiKey = secret.apiKey;
  if (!apiKey) throw new MissingCredentialError("taqnyat");
  const sender = secret.sender ?? "Hasiba";
  const t0 = Date.now();
  const r = await fetch("https://api.taqnyat.sa/v1/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipients: [req.to],
      body: renderTemplate(req.body, req.variables ?? {}),
      sender,
    }),
  });
  const body = (await r.json().catch(() => ({}))) as {
    statusCode?: number;
    messageId?: string;
    message?: string;
  };
  const ok = r.ok && (body.statusCode === 200 || body.statusCode === undefined);
  await recordIntegrationCall({
    branchId: req.branchId ?? null,
    provider: "taqnyat",
    endpoint: "/v1/messages",
    method: "POST",
    statusCode: r.status,
    durationMs: Date.now() - t0,
    success: ok,
    errorMessage: ok ? null : body.message ?? `HTTP ${r.status}`,
  });
  return {
    ok,
    providerRef: body.messageId ?? null,
    error: body.message,
    statusCode: r.status,
  };
}

export async function sendMessage(req: SendMessageRequest): Promise<SendMessageResult> {
  // Persist as queued first so an adapter crash leaves a trace.
  const [queued] = await db
    .insert(outboundMessagesTable)
    .values({
      branchId: req.branchId ?? null,
      channel: req.channel,
      provider: req.provider,
      toNumber: req.to,
      templateName: req.templateName ?? null,
      body: renderTemplate(req.body, req.variables ?? {}),
      variables: req.variables ?? null,
      status: "queued",
    })
    .returning({ id: outboundMessagesTable.id });

  const cred = await getCredential<Record<string, string>>(req.provider, {
    branchId: req.branchId ?? null,
  });
  if (!cred) throw new MissingCredentialError(req.provider);

  let outcome: AdapterOutcome;
  try {
    if (req.provider === "whatsapp") outcome = await sendWhatsApp(req, cred.secret);
    else if (req.provider === "unifonic") outcome = await sendUnifonic(req, cred.secret);
    else if (req.provider === "taqnyat") outcome = await sendTaqnyat(req, cred.secret);
    else if (req.provider === "mobily") {
      // Mobily B2B SMS uses a non-public partner contract; we don't
      // ship a stub that pretends to succeed. Caller gets 501.
      throw new MessagingNotImplementedError("mobily");
    } else {
      throw new MessagingNotImplementedError(req.provider);
    }
  } catch (e) {
    if (e instanceof MessagingNotImplementedError) {
      await db
        .update(outboundMessagesTable)
        .set({ status: "failed", errorMessage: e.message })
        .where(eq(outboundMessagesTable.id, queued!.id));
      throw e;
    }
    outcome = {
      ok: false,
      providerRef: null,
      error: e instanceof Error ? e.message : String(e),
      statusCode: 500,
    };
  }

  const finalStatus = outcome.ok ? "sent" : "failed";
  await db
    .update(outboundMessagesTable)
    .set({
      status: finalStatus,
      providerRef: outcome.providerRef,
      errorMessage: outcome.error ?? null,
      sentAt: outcome.ok ? new Date() : null,
    })
    .where(eq(outboundMessagesTable.id, queued!.id));

  return {
    id: queued!.id,
    status: finalStatus,
    providerRef: outcome.providerRef,
  };
}
