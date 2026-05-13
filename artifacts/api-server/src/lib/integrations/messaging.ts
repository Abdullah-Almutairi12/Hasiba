import { db, outboundMessagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getCredential, MissingCredentialError } from "./credentials";
import { recordIntegrationCall } from "./audit";

export type Channel = "whatsapp" | "sms";
export type MessagingProvider = "whatsapp" | "unifonic" | "mobily" | "taqnyat";

export interface SendMessageRequest {
  branchId?: number | null;
  channel: Channel;
  provider: MessagingProvider;
  to: string;
  body: string;
  templateName?: string;
  // When false, the templateName is recorded on the outbound log
  // for traceability but the WhatsApp payload is sent as plain
  // text/media instead of `type: "template"`. Used so that fallback
  // sends (template missing or pending Meta approval) still keep
  // attribution to the originating event template.
  useTemplate?: boolean;
  variables?: Record<string, string>;
  // Optional document attachment (e.g. invoice PDF, payment
  // receipt). When supplied with a WhatsApp provider we send a
  // document message instead of plain text so customers receive
  // the actual invoice file alongside the textual notification.
  mediaUrl?: string;
  mediaFilename?: string;
  mediaCaption?: string;
  // When set together with `templateName`, the media is attached
  // as the template's header component (image or document) so
  // the message is delivered as a real Meta-approved template
  // even with an attachment — required for messages sent outside
  // the 24-hour customer-care window.
  mediaType?: "image" | "document";
}

export interface SendMessageResult {
  id: number;
  status: "queued" | "sent" | "failed";
  providerRef: string | null;
}

interface AdapterOutcome {
  providerRef: string | null;
  ok: boolean;
  error?: string;
  statusCode: number;
}

function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

/**
 * Per-message tariff used to populate `outbound_messages.cost`.
 * Values are SAR per delivered message and reflect published
 * Saudi-market list prices as of 2026-Q1. Operators can override
 * the rate per credential by writing a `costPerMessage` value
 * into the encrypted secret bag — the override always wins.
 *
 * Persisting cost at send time gives finance a clean monthly
 * spend report without having to re-derive it from provider
 * statements (which arrive 30+ days late).
 */
const PROVIDER_COST_PER_MESSAGE_SAR: Record<MessagingProvider, number> = {
  whatsapp: 0.0648, // Meta utility template, KSA, ~USD 0.0173
  unifonic: 0.1,
  taqnyat: 0.09,
  mobily: 0.12,
};

function resolveCost(
  provider: MessagingProvider,
  cred: { secret: Record<string, string> },
  isMedia: boolean,
): number {
  const overrideRaw = cred.secret["costPerMessage"];
  const override = overrideRaw ? Number(overrideRaw) : NaN;
  const base = Number.isFinite(override)
    ? override
    : PROVIDER_COST_PER_MESSAGE_SAR[provider];
  // WhatsApp document/media messages cost the same as a template
  // utility message in 2026 — kept as a hook in case Meta
  // re-introduces a media surcharge.
  return Number((base * (isMedia ? 1 : 1)).toFixed(4));
}

async function sendWhatsApp(req: SendMessageRequest, secret: Record<string, string>): Promise<AdapterOutcome> {
  const phoneNumberId = secret.phoneNumberId;
  const accessToken = secret.accessToken;
  if (!phoneNumberId || !accessToken) throw new MissingCredentialError("whatsapp");
  const t0 = Date.now();
  // Four message shapes: (1) **template + media header** — when
  // both templateName and mediaUrl are set, we send a real Meta
  // template with the media attached as the `header` component
  // (image or document). This is the only mode that delivers
  // outside Meta's 24-hour customer-care window; (2) template —
  // pre-approved business-initiated messages with body variables;
  // (3) document — bare media (only valid inside the 24h window);
  // (4) plain text — agent-initiated freeform replies.
  const bodyComponent = req.variables
    ? [
        {
          type: "body",
          parameters: Object.values(req.variables).map((v) => ({
            type: "text",
            text: v,
          })),
        },
      ]
    : [];
  // Treat the templateName as a "use real Meta template" trigger only
  // when the caller explicitly opts in via `useTemplate`. This lets
  // upstream code persist the attempted template name on the outbound
  // log even when the live message is sent as plain text/media (e.g.
  // because the template hasn't been approved by Meta yet).
  const useApiTemplate = Boolean(req.templateName) && req.useTemplate !== false;
  let payload: Record<string, unknown>;
  if (useApiTemplate && req.mediaUrl) {
    const headerKind = req.mediaType ?? "image";
    payload = {
      messaging_product: "whatsapp",
      to: req.to,
      type: "template",
      template: {
        name: req.templateName,
        language: { code: "ar" },
        components: [
          {
            type: "header",
            parameters: [
              headerKind === "image"
                ? { type: "image", image: { link: req.mediaUrl } }
                : {
                    type: "document",
                    document: {
                      link: req.mediaUrl,
                      filename: req.mediaFilename ?? "invoice.pdf",
                    },
                  },
            ],
          },
          ...bodyComponent,
        ],
      },
    };
  } else if (useApiTemplate) {
    payload = {
      messaging_product: "whatsapp",
      to: req.to,
      type: "template",
      template: {
        name: req.templateName,
        language: { code: "ar" },
        components: bodyComponent,
      },
    };
  } else if (req.mediaUrl) {
    payload = {
      messaging_product: "whatsapp",
      to: req.to,
      type: req.mediaType === "image" ? "image" : "document",
      ...(req.mediaType === "image"
        ? {
            image: {
              link: req.mediaUrl,
              caption:
                req.mediaCaption ??
                renderTemplate(req.body, req.variables ?? {}),
            },
          }
        : {
            document: {
              link: req.mediaUrl,
              filename: req.mediaFilename ?? "invoice.pdf",
              caption:
                req.mediaCaption ??
                renderTemplate(req.body, req.variables ?? {}),
            },
          }),
    };
  } else {
    payload = {
      messaging_product: "whatsapp",
      to: req.to,
      type: "text",
      text: { body: renderTemplate(req.body, req.variables ?? {}) },
    };
  }
  const r = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await r.json().catch(() => ({}))) as {
    messages?: Array<{ id: string }>;
    error?: { message: string };
  };
  await recordIntegrationCall({
    branchId: req.branchId ?? null,
    provider: "whatsapp",
    endpoint: "/messages",
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
    message?: string;
  };
  const ok = r.ok && body.success === "true";
  await recordIntegrationCall({
    branchId: req.branchId ?? null,
    provider: "unifonic",
    endpoint: "/SMS/messages",
    method: "POST",
    statusCode: r.status,
    durationMs: Date.now() - t0,
    success: ok,
    errorMessage: body.message,
  });
  return { ok, providerRef: body.data?.MessageID ?? null, error: body.message, statusCode: r.status };
}

async function sendTaqnyat(req: SendMessageRequest, secret: Record<string, string>): Promise<AdapterOutcome> {
  const apiKey = secret.apiKey;
  if (!apiKey) throw new MissingCredentialError("taqnyat");
  const sender = secret.sender ?? "Hasiba";
  const t0 = Date.now();
  const r = await fetch("https://api.taqnyat.sa/v1/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
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
  return { ok, providerRef: body.messageId ?? null, error: body.message, statusCode: r.status };
}

/**
 * Mobily corporate SMS — uses the legacy form-encoded msgSend.php
 * endpoint (the same one their dashboard exports as the "API"
 * tab). Returns a numeric status code in the body; 1 = OK.
 */
async function sendMobily(req: SendMessageRequest, secret: Record<string, string>): Promise<AdapterOutcome> {
  const username = secret.username;
  const password = secret.password;
  const sender = secret.sender ?? "Hasiba";
  if (!username || !password) throw new MissingCredentialError("mobily");
  const t0 = Date.now();
  const params = new URLSearchParams({
    mobile: username,
    password,
    sender,
    numbers: req.to,
    msg: renderTemplate(req.body, req.variables ?? {}),
    applicationType: "68",
    domainName: "www.mobily.ws",
  });
  const r = await fetch(`https://www.mobily.ws/api/msgSend.php?${params.toString()}`);
  const text = await r.text().catch(() => "");
  // Mobily returns "1" on success, anything else = error code.
  const ok = r.ok && text.trim() === "1";
  await recordIntegrationCall({
    branchId: req.branchId ?? null,
    provider: "mobily",
    endpoint: "/api/msgSend.php",
    method: "GET",
    statusCode: r.status,
    durationMs: Date.now() - t0,
    success: ok,
    errorMessage: ok ? null : `mobily code=${text.trim() || r.status}`,
  });
  return {
    ok,
    providerRef: ok ? `mobily-${Date.now()}` : null,
    error: ok ? undefined : `mobily code=${text.trim() || r.status}`,
    statusCode: r.status,
  };
}

export async function sendMessage(req: SendMessageRequest): Promise<SendMessageResult> {
  // Persist as queued first so a crash leaves a trace.
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
  if (!cred) {
    await db
      .update(outboundMessagesTable)
      .set({ status: "failed", errorMessage: "missing_credential" })
      .where(eq(outboundMessagesTable.id, queued!.id));
    throw new MissingCredentialError(req.provider);
  }

  let outcome: AdapterOutcome;
  try {
    if (req.provider === "whatsapp") outcome = await sendWhatsApp(req, cred.secret);
    else if (req.provider === "unifonic") outcome = await sendUnifonic(req, cred.secret);
    else if (req.provider === "taqnyat") outcome = await sendTaqnyat(req, cred.secret);
    else if (req.provider === "mobily") outcome = await sendMobily(req, cred.secret);
    else throw new Error(`Unsupported messaging provider: ${req.provider}`);
  } catch (e) {
    outcome = {
      ok: false,
      providerRef: null,
      error: e instanceof Error ? e.message : String(e),
      statusCode: 500,
    };
  }

  const finalStatus = outcome.ok ? "sent" : "failed";
  // Persist per-message cost on success so finance can roll it up
  // monthly without scraping provider statements. The tariff is
  // resolved per provider with an optional per-credential
  // override stored alongside the secret bag.
  const cost = outcome.ok
    ? resolveCost(req.provider, cred, Boolean(req.mediaUrl))
    : null;
  await db
    .update(outboundMessagesTable)
    .set({
      status: finalStatus,
      providerRef: outcome.providerRef,
      errorMessage: outcome.error ?? null,
      sentAt: outcome.ok ? new Date() : null,
      cost: cost !== null ? cost.toFixed(4) : null,
    })
    .where(eq(outboundMessagesTable.id, queued!.id));

  return { id: queued!.id, status: finalStatus, providerRef: outcome.providerRef };
}
